"""Behavioral tests for Chroma HttpClient fallback selection.

Run from knowledge-base/scripts:

    python -m _test_clients.test_chroma_client_fallback
"""

import contextlib
import io
import os
import sys

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


class _FakeCollection:
    pass


class _FakePersistentClient:
    def __init__(self, owner, path=None):
        self.owner = owner
        self.path = path
        owner.persistent_calls.append(path)

    def get_or_create_collection(self, name=None, metadata=None):
        self.owner.collections.append({"name": name, "metadata": metadata})
        return _FakeCollection()


class _FakeHttpClient:
    def __init__(self, owner, host=None, port=None):
        self.owner = owner
        self.host = host
        self.port = port
        owner.http_calls.append({"host": host, "port": port})

    def heartbeat(self):
        if self.owner.http_raises:
            raise RuntimeError("server unavailable")
        self.owner.heartbeats += 1
        return 1


class _FakeChromadb:
    def __init__(self, http_raises=True):
        self.http_raises = http_raises
        self.http_calls = []
        self.persistent_calls = []
        self.collections = []
        self.heartbeats = 0

    def HttpClient(self, host=None, port=None):
        return _FakeHttpClient(self, host=host, port=port)

    def PersistentClient(self, path=None):
        return _FakePersistentClient(self, path=path)


@contextlib.contextmanager
def _fake_chromadb(http_raises=True):
    original = sys.modules.get("chromadb")
    fake = _FakeChromadb(http_raises=http_raises)
    sys.modules["chromadb"] = fake
    try:
        yield fake
    finally:
        if original is None:
            sys.modules.pop("chromadb", None)
        else:
            sys.modules["chromadb"] = original


@contextlib.contextmanager
def _patched_env(**updates):
    keys = {"CHROMA_SERVER_HOST", "CHROMA_SERVER_PORT"} | set(updates)
    original = {key: os.environ.get(key) for key in keys}
    for key in keys:
        os.environ.pop(key, None)
    for key, value in updates.items():
        os.environ[key] = value
    try:
        yield
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_env_unset_uses_embedded_client_only():
    print("\n[test 1/3] env unset uses embedded PersistentClient")
    with _patched_env(), _fake_chromadb() as fake:
        client = mmrag.get_chroma_client()

    _check("returns persistent client", isinstance(client, _FakePersistentClient))
    _check("does not construct HttpClient", fake.http_calls == [], detail=f"got {fake.http_calls}")
    _check("uses configured chroma dir", fake.persistent_calls == [str(mmrag.CHROMADB_DIR)])


def test_unreachable_server_warns_and_falls_back_to_embedded():
    print("\n[test 2/3] unreachable server falls back to embedded")
    out = io.StringIO()
    with _patched_env(CHROMA_SERVER_HOST="127.0.0.1", CHROMA_SERVER_PORT="9555"), \
         _fake_chromadb(http_raises=True) as fake, \
         contextlib.redirect_stdout(out):
        collection = mmrag.get_chroma_collection("fallback-test")

    output = out.getvalue()
    _check("returns collection from fallback client", isinstance(collection, _FakeCollection))
    _check("tried HttpClient with parsed port", fake.http_calls == [{"host": "127.0.0.1", "port": 9555}], detail=f"got {fake.http_calls}")
    _check("fell back to PersistentClient", fake.persistent_calls == [str(mmrag.CHROMADB_DIR)], detail=f"got {fake.persistent_calls}")
    _check("warning announces fallback", "falling back to embedded" in output, detail=output)
    _check("collection request preserved", fake.collections == [{"name": "fallback-test", "metadata": {"hnsw:space": "cosine"}}])


def test_reachable_server_uses_http_client_only():
    print("\n[test 3/3] reachable server uses HttpClient")
    with _patched_env(CHROMA_SERVER_HOST="127.0.0.1", CHROMA_SERVER_PORT="9555"), \
         _fake_chromadb(http_raises=False) as fake:
        client = mmrag.get_chroma_client()

    _check("returns http client", isinstance(client, _FakeHttpClient))
    _check("heartbeat probed server", fake.heartbeats == 1, detail=f"got {fake.heartbeats}")
    _check("does not construct PersistentClient", fake.persistent_calls == [], detail=f"got {fake.persistent_calls}")


if __name__ == "__main__":
    test_env_unset_uses_embedded_client_only()
    test_unreachable_server_warns_and_falls_back_to_embedded()
    test_reachable_server_uses_http_client_only()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL PASS (3 scenarios)")
    sys.exit(0)
