"""Behavioral tests for per-chunk content-hash delta ingest.

Run from knowledge-base/scripts:

    python -m _test_clients.test_chunk_delta
"""

import contextlib
import os
import sys
import tempfile
from pathlib import Path

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
    def __init__(self):
        self.rows = {}
        self.deleted = []

    def get(self, ids=None, where=None, include=None):
        if ids is not None:
            found = [doc_id for doc_id in ids if doc_id in self.rows]
            return {
                "ids": found,
                "metadatas": [self.rows[doc_id]["metadata"] for doc_id in found],
            }
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


@contextlib.contextmanager
def _patched(obj, name, value):
    original = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, original)


@contextlib.contextmanager
def _delta_harness():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "memory.md"
        collection = _Collection()
        embed_calls = []

        def fake_chunk_text(text, chunk_size=None, overlap=None):
            return [line.strip() for line in text.splitlines() if line.strip()]

        def fake_embed_content(client, config, content, task_type="RETRIEVAL_DOCUMENT"):
            embed_calls.append(content)
            return [float(len(embed_calls))]

        with _patched(mmrag, "chunk_text", fake_chunk_text), \
             _patched(mmrag, "embed_content", fake_embed_content):
            original_force = mmrag.args_force
            mmrag.args_force = False
            try:
                yield path, collection, embed_calls
            finally:
                mmrag.args_force = original_force


def _ids_for(collection):
    return set(collection.rows.keys())


def test_unchanged_file_zero_reembed():
    print("\n[test 1/5] unchanged file skips all chunks")
    with _delta_harness() as (path, collection, embed_calls):
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        first = mmrag.ingest_text_file(object(), {}, collection, path)
        embed_calls.clear()
        second = mmrag.ingest_text_file(object(), {}, collection, path)

        _check("initial ingest embeds both chunks", first == 2, detail=f"got {first}")
        _check("unchanged ingest returns zero", second == 0, detail=f"got {second}")
        _check("unchanged ingest makes zero embed calls", embed_calls == [], detail=f"got {embed_calls}")


def test_changed_file_reembeds_only_changed_chunk():
    print("\n[test 2/5] changed file embeds only changed chunk")
    with _delta_harness() as (path, collection, embed_calls):
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        mmrag.ingest_text_file(object(), {}, collection, path)
        before_ids = _ids_for(collection)
        old_beta_id = mmrag.content_chunk_id(path, "beta")
        embed_calls.clear()
        collection.deleted.clear()

        path.write_text("alpha\nbeta changed\n", encoding="utf-8")
        count = mmrag.ingest_text_file(object(), {}, collection, path)
        after_ids = _ids_for(collection)

        _check("changed ingest embeds one chunk", count == 1, detail=f"got {count}")
        _check("only changed content embedded", embed_calls == ["beta changed"], detail=f"got {embed_calls}")
        _check("unchanged alpha ID preserved", mmrag.content_chunk_id(path, "alpha") in after_ids)
        _check("old changed chunk deleted", old_beta_id in collection.deleted, detail=f"deleted {collection.deleted}")
        _check("ID set changed by one chunk only", len(before_ids) == len(after_ids), detail=f"{before_ids} -> {after_ids}")


def test_gone_chunk_deleted_without_reembed():
    print("\n[test 3/5] removed chunk is deleted without embedding")
    with _delta_harness() as (path, collection, embed_calls):
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        mmrag.ingest_text_file(object(), {}, collection, path)
        beta_id = mmrag.content_chunk_id(path, "beta")
        embed_calls.clear()
        collection.deleted.clear()

        path.write_text("alpha\n", encoding="utf-8")
        count = mmrag.ingest_text_file(object(), {}, collection, path)

        _check("removal re-embeds zero chunks", count == 0, detail=f"got {count}")
        _check("removal makes zero embed calls", embed_calls == [], detail=f"got {embed_calls}")
        _check("removed chunk deleted", beta_id in collection.deleted, detail=f"deleted {collection.deleted}")
        _check("removed chunk absent from collection", beta_id not in collection.rows)


def test_force_reembeds_all_existing_chunks():
    print("\n[test 4/5] force remains explicit re-embed-all")
    with _delta_harness() as (path, collection, embed_calls):
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        mmrag.ingest_text_file(object(), {}, collection, path)
        embed_calls.clear()
        mmrag.args_force = True

        count = mmrag.ingest_text_file(object(), {}, collection, path)

        _check("force reports both chunks embedded", count == 2, detail=f"got {count}")
        _check("force embeds all existing chunks", embed_calls == ["alpha", "beta"], detail=f"got {embed_calls}")


def test_legacy_path_ids_migrate_without_reembed():
    print("\n[test 5/5] legacy path IDs migrate without re-embed")
    with _delta_harness() as (path, collection, embed_calls):
        path.write_text("alpha\nbeta\n", encoding="utf-8")
        source = str(path.resolve())
        for idx, chunk in enumerate(["alpha", "beta"]):
            legacy_id = mmrag.file_id(path, idx)
            collection.rows[legacy_id] = {
                "embedding": [float(idx + 10)],
                "document": chunk,
                "metadata": {
                    "source": source,
                    "type": "text",
                    "chunk_index": idx,
                    "total_chunks": 2,
                    "filename": path.name,
                    "file_ext": ".md",
                },
            }

        count = mmrag.ingest_text_file(object(), {}, collection, path)
        expected_ids = {mmrag.content_chunk_id(path, "alpha"), mmrag.content_chunk_id(path, "beta")}

        _check("legacy migration reports zero embeds", count == 0, detail=f"got {count}")
        _check("legacy migration makes zero embed calls", embed_calls == [], detail=f"got {embed_calls}")
        _check("content-hash IDs now present", expected_ids <= _ids_for(collection), detail=f"rows {_ids_for(collection)}")
        _check("legacy IDs deleted", all(doc_id in collection.deleted for doc_id in [mmrag.file_id(path, 0), mmrag.file_id(path, 1)]))


if __name__ == "__main__":
    test_unchanged_file_zero_reembed()
    test_changed_file_reembeds_only_changed_chunk()
    test_gone_chunk_deleted_without_reembed()
    test_force_reembeds_all_existing_chunks()
    test_legacy_path_ids_migrate_without_reembed()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL PASS (5 scenarios)")
    sys.exit(0)
