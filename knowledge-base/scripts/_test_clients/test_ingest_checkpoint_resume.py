"""Behavioral tests for checkpoint-resume ingest budget handling.

Run from knowledge-base/scripts:

    python -m _test_clients.test_ingest_checkpoint_resume
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


class _Collection:
    def __init__(self, source_lookup_delay_s=0.0):
        self.rows = {}
        self.deleted = []
        self.source_lookup_delay_s = source_lookup_delay_s

    def get(self, ids=None, where=None, include=None):
        if ids is not None:
            found = [doc_id for doc_id in ids if doc_id in self.rows]
            return {
                "ids": found,
                "metadatas": [self.rows[doc_id]["metadata"] for doc_id in found],
            }
        if where and self.source_lookup_delay_s:
            time.sleep(self.source_lookup_delay_s)
        selected = list(self.rows.items())
        if where and "source" in where:
            selected = [
                (doc_id, row)
                for doc_id, row in selected
                if row["metadata"].get("source") == where["source"]
            ]
        return {
            "ids": [doc_id for doc_id, _row in selected],
            "metadatas": [row["metadata"] for _doc_id, row in selected],
            "documents": [row["document"] for _doc_id, row in selected],
            "embeddings": [row["embedding"] for _doc_id, row in selected],
        }

    def upsert(self, ids=None, embeddings=None, documents=None, metadatas=None):
        for i, doc_id in enumerate(ids or []):
            self.rows[doc_id] = {
                "embedding": embeddings[i],
                "document": documents[i],
                "metadata": metadatas[i],
            }

    def delete(self, ids=None):
        for doc_id in ids or []:
            self.deleted.append(doc_id)
            self.rows.pop(doc_id, None)


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


def _fake_chunk_text(text, chunk_size=None, overlap=None):
    return [line.strip() for line in text.splitlines() if line.strip()]


def _run_cmd_ingest(path, collection, embed_func, budget_ms=1):
    args = SimpleNamespace(paths=[str(path)], collection="test", force=False)
    stdout = io.StringIO()
    stderr = io.StringIO()
    exit_code = 0
    with _patched(mmrag, "load_config", lambda: {"text_chunk_size": 1000, "text_chunk_overlap": 0}), \
         _patched(mmrag, "get_api_key", lambda cfg: "fake-key"), \
         _patched(mmrag, "get_genai_client", lambda api_key: object()), \
         _patched(mmrag, "get_chroma_collection", lambda name: collection), \
         _patched(mmrag, "chunk_text", _fake_chunk_text), \
         _patched(mmrag, "embed_content", embed_func), \
         _patched(mmrag, "UsageTracker", _NoopTracker), \
         _patched(mmrag, "resolve_ingest_budget_ms", lambda: budget_ms), \
         contextlib.redirect_stdout(stdout), \
         contextlib.redirect_stderr(stderr):
        original_force = mmrag.args_force
        try:
            mmrag.cmd_ingest(args)
        except SystemExit as e:
            exit_code = e.code
        finally:
            mmrag.args_force = original_force
    return exit_code, stdout.getvalue(), stderr.getvalue()


def test_budget_exceeded_emits_partial_and_persists_upserted_chunk():
    print("\n[test 1/5] budget stop emits partial and keeps durable upsert")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "memory.md"
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        collection = _Collection()
        embed_calls = []

        def slow_embed(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            embed_calls.append(content)
            time.sleep(0.002)
            return [float(len(embed_calls))]

        code, out, err = _run_cmd_ingest(path, collection, slow_embed, budget_ms=1)

        _check("exits with partial code", code == mmrag.INGEST_PARTIAL_EXIT_CODE, detail=f"got {code}")
        _check("prints partial marker", "INGEST_PARTIAL done=1 total=2 remaining=1" in out, detail=out)
        _check("prints phase timing", "PHASE_TIMING " in err, detail=err)
        _check("first chunk persisted", mmrag.content_chunk_id(path, "alpha") in collection.rows)
        _check("second chunk not yet persisted", mmrag.content_chunk_id(path, "beta") not in collection.rows)


def test_second_run_after_partial_resumes_and_completes():
    print("\n[test 2/5] second run resumes from durable chunks")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "memory.md"
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        collection = _Collection()
        embed_calls = []

        def slow_embed(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            embed_calls.append(content)
            time.sleep(0.002)
            return [float(len(embed_calls))]

        first_code, first_out, _first_err = _run_cmd_ingest(path, collection, slow_embed, budget_ms=1)
        embed_calls.clear()

        def fast_embed(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            embed_calls.append(content)
            return [float(len(embed_calls) + 10)]

        second_code, second_out, _second_err = _run_cmd_ingest(path, collection, fast_embed, budget_ms=10_000)

        _check("first run is partial", first_code == mmrag.INGEST_PARTIAL_EXIT_CODE, detail=first_out)
        _check("second run exits clean", second_code == 0, detail=f"got {second_code}")
        _check("second run embeds only remaining chunk", embed_calls == ["beta"], detail=f"got {embed_calls}")
        _check("second run reports one new chunk", "Done! Ingested 1 new chunk(s)" in second_out, detail=second_out)
        expected_ids = {mmrag.content_chunk_id(path, "alpha"), mmrag.content_chunk_id(path, "beta")}
        _check("all chunks now persisted", expected_ids <= set(collection.rows.keys()))


def test_tiny_budget_after_slow_setup_still_makes_forward_progress():
    print("\n[test 3/5] slow setup plus tiny budget still upserts one new chunk")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "memory.md"
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        collection = _Collection(source_lookup_delay_s=0.003)
        embed_calls = []

        def embed(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            embed_calls.append(content)
            return [float(len(embed_calls))]

        first_code, first_out, _first_err = _run_cmd_ingest(path, collection, embed, budget_ms=1)
        first_ids = set(collection.rows.keys())
        embed_calls.clear()
        collection.source_lookup_delay_s = 0.0
        second_code, second_out, _second_err = _run_cmd_ingest(path, collection, embed, budget_ms=10_000)

        _check("first run exits partial", first_code == mmrag.INGEST_PARTIAL_EXIT_CODE, detail=first_out)
        _check("first run reports forward progress", "INGEST_PARTIAL done=1 total=2 remaining=1" in first_out, detail=first_out)
        _check("first run persisted at least one new chunk", len(first_ids) >= 1, detail=f"got {first_ids}")
        _check("second run exits clean", second_code == 0, detail=f"got {second_code}")
        _check("second run completes remaining work", "Done! Ingested 1 new chunk(s)" in second_out, detail=second_out)
        expected_ids = {mmrag.content_chunk_id(path, "alpha"), mmrag.content_chunk_id(path, "beta")}
        _check("all chunks persisted after resume", expected_ids <= set(collection.rows.keys()))


def test_complete_small_file_unchanged_exits_zero():
    print("\n[test 4/5] unchanged small file remains clean exit zero")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "memory.md"
        path.write_text("alpha\n", encoding="utf-8")
        collection = _Collection()
        embed_calls = []

        def embed(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            embed_calls.append(content)
            return [float(len(embed_calls))]

        first_code, _first_out, _first_err = _run_cmd_ingest(path, collection, embed, budget_ms=10_000)
        embed_calls.clear()
        second_code, second_out, second_err = _run_cmd_ingest(path, collection, embed, budget_ms=10_000)

        _check("initial ingest exits zero", first_code == 0, detail=f"got {first_code}")
        _check("unchanged ingest exits zero", second_code == 0, detail=f"got {second_code}")
        _check("unchanged ingest reports zero new chunks", "Done! Ingested 0 new chunk(s)" in second_out, detail=second_out)
        _check("unchanged ingest makes zero embed calls", embed_calls == [], detail=f"got {embed_calls}")
        _check("timing still emitted", "PHASE_TIMING " in second_err, detail=second_err)


def test_hard_embed_unavailable_path_unchanged():
    print("\n[test 5/5] hard embed degradation remains skipped-file behavior")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "memory.md"
        path.write_text("bad text\n", encoding="utf-8")
        collection = _Collection()

        def degraded_embed(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            raise mmrag.EmbedUnavailableError("embed unavailable after 3 attempts: timeout")

        code, out, _err = _run_cmd_ingest(path, collection, degraded_embed, budget_ms=10_000)

        _check("degraded path exits zero as before", code == 0, detail=f"got {code}")
        _check("degraded warning preserved", "WARNING: embedder degraded; skipped file" in out, detail=out)
        _check("skipped degraded summary preserved", "Skipped degraded: 1 (embedder unavailable)" in out, detail=out)
        _check("no partial marker on degraded skip", "INGEST_PARTIAL" not in out, detail=out)
        _check("no upsert on degraded file", collection.rows == {}, detail=f"got {collection.rows}")


if __name__ == "__main__":
    test_budget_exceeded_emits_partial_and_persists_upserted_chunk()
    test_second_run_after_partial_resumes_and_completes()
    test_tiny_budget_after_slow_setup_still_makes_forward_progress()
    test_complete_small_file_unchanged_exits_zero()
    test_hard_embed_unavailable_path_unchanged()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL PASS (5 scenarios)")
    sys.exit(0)
