"""Behavioral tests for fail-fast embed retry and ingest skip handling.

Run from knowledge-base/scripts:

    python -m _test_clients.test_embed_resilience
"""

import contextlib
import io
import os
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(HERE)
if PARENT not in sys.path:
    sys.path.insert(0, PARENT)

import mmrag


FAILURES = []


def _check(label, cond, detail=""):
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}: {detail}")
        FAILURES.append(label)


class _Embedding:
    values = [0.1, 0.2, 0.3]


class _EmbedResponse:
    embeddings = [_Embedding()]


class _EmbedModels:
    def __init__(self, script):
        self.script = list(script)
        self.index = 0
        self.configs = []
        self.contents = []

    def embed_content(self, model=None, contents=None, config=None):
        self.index += 1
        self.configs.append(config)
        self.contents.append(contents)
        action = self.script.pop(0)
        if action == "ok":
            return _EmbedResponse()
        if action == "timeout":
            raise TimeoutError("simulated slow embed timeout")
        if action == "503":
            from google.genai.errors import APIError

            class _InjectedAPIError(APIError):
                def __init__(self):
                    Exception.__init__(self, "embed busy")
                    self.code = 503
                    self.status = "UNAVAILABLE"
                    self.message = "embed busy"

            raise _InjectedAPIError()
        raise AssertionError(f"unknown script action: {action}")


class _EmbedClient:
    def __init__(self, script):
        self.models = _EmbedModels(script)


class _Collection:
    def __init__(self):
        self.upserts = []

    def get(self, ids=None):
        return {"ids": []}

    def upsert(self, **kwargs):
        self.upserts.append(kwargs)


class _NoopTracker:
    def __init__(self, operation="unknown"):
        self.operation = operation

    def persist(self):
        pass

    def summary_line(self):
        return "Tokens: 0 embedding, 0 gen-input, 0 gen-output | Cost: $0.0000"


@contextlib.contextmanager
def _patched(obj, name, value):
    original = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, original)


def test_timeout_exhausts_fast_with_pinned_timeout():
    print("\n[test 1/3] timeout exhaustion is fail-fast")
    from google.genai import types  # prewarm SDK import outside the timed path

    _ = types.HttpOptions(timeout=1)
    client = _EmbedClient(["timeout", "timeout", "timeout"])
    config = {"embedding_retry_backoffs": (0, 0, 0)}
    started = time.monotonic()
    raised = None
    try:
        mmrag.embed_content(client, config, "bad text")
    except Exception as e:
        raised = e
    elapsed = time.monotonic() - started

    _check("raises EmbedUnavailableError", isinstance(raised, mmrag.EmbedUnavailableError))
    _check("consumed 3 attempts", client.models.index == 3, detail=f"got {client.models.index}")
    timeouts = [c.http_options.timeout for c in client.models.configs]
    _check("timeout is pinned below 2 minutes", all(t and t < 120000 for t in timeouts), detail=f"got {timeouts}")
    _check("simulated timeout path does not block", elapsed < 2, detail=f"elapsed {elapsed:.3f}s")


def test_transient_embed_retries_then_succeeds():
    print("\n[test 2/3] transient embed error retries then succeeds")
    client = _EmbedClient(["503", "ok"])
    result = mmrag.embed_content(
        client,
        {"embedding_retry_backoffs": (0, 0, 0)},
        "good text",
    )
    _check("returns embedding values", result == [0.1, 0.2, 0.3], detail=f"got {result}")
    _check("consumed 2 attempts", client.models.index == 2, detail=f"got {client.models.index}")


def test_ingest_skips_degraded_file_and_continues():
    print("\n[test 3/3] ingest skips degraded embed file and continues")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        bad = root / "bad.md"
        good = root / "good.md"
        bad.write_text("bad text", encoding="utf-8")
        good.write_text("good text", encoding="utf-8")

        collection = _Collection()
        config = {
            "text_chunk_size": 1000,
            "text_chunk_overlap": 0,
            "embedding_retry_backoffs": (0, 0, 0),
        }
        args = SimpleNamespace(paths=[str(bad), str(good)], collection="test", force=True)

        def fake_embed_content(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            if content == "bad text":
                raise mmrag.EmbedUnavailableError("embed unavailable after 3 attempts: timeout")
            return [0.1, 0.2, 0.3]

        out = io.StringIO()
        with _patched(mmrag, "load_config", lambda: config), \
             _patched(mmrag, "get_api_key", lambda cfg: "fake-key"), \
             _patched(mmrag, "get_genai_client", lambda api_key: object()), \
             _patched(mmrag, "get_chroma_collection", lambda name: collection), \
             _patched(mmrag, "embed_content", fake_embed_content), \
             _patched(mmrag, "UsageTracker", _NoopTracker), \
             contextlib.redirect_stdout(out):
            mmrag.cmd_ingest(args)

        output = out.getvalue()
        _check("warning names degraded embed skip", "WARNING: embedder degraded; skipped file" in output)
        _check("summary reports skipped degraded", "Skipped degraded: 1 (embedder unavailable)" in output)
        _check("continues and ingests good file", "Done! Ingested 1 new chunk(s)" in output)
        _check("collection received one upsert", len(collection.upserts) == 1, detail=f"got {len(collection.upserts)}")
        if collection.upserts:
            _check("good document was upserted", collection.upserts[0]["documents"] == ["good text"])
        else:
            _check("good document was upserted", False, detail="no upserts")


if __name__ == "__main__":
    test_timeout_exhausts_fast_with_pinned_timeout()
    test_transient_embed_retries_then_succeeds()
    test_ingest_skips_degraded_file_and_continues()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL PASS (3 scenarios)")
    sys.exit(0)
