#!/usr/bin/env python3
"""Creative verdict CLI/front-end backed by verdict_core."""
import json
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import verdict_core

_AUTHORITY = None


def _authority():
    global _AUTHORITY
    if _AUTHORITY is None:
        _AUTHORITY = verdict_core.load()
    return _AUTHORITY


def verdict_for(rec):
    verdict = verdict_core.classify(rec, _authority(), surface="creative")
    return verdict.verdict, verdict.evidence, verdict.fails, verdict.unclears


def meta_reconcile(v, fails, meta):
    m = (meta or "").upper()
    if v == "PASS" and "DISAPPROV" in m:
        return "FAIL", " | Meta-DISAPPROVED (scan missed) - inspect", True
    if v == "FAIL" and fails and ("ACTIVE" in m or "APPROVED" in m):
        return "FAIL", " | Meta currently ACTIVE - retro-disapproval risk", False
    if v == "FAIL" and not fails and ("ACTIVE" in m or "APPROVED" in m):
        return "UNCLEAR", " | judgment-only call, Meta ACTIVE - human eye", False
    return v, "", False


# Test compatibility for the modality unit. The implementation remains private in verdict_core.
single_vision_only = verdict_core._single_vision_only


if __name__ == "__main__":
    ts = sys.argv[2] if len(sys.argv) > 2 else "2026-06-10 PT"
    out = []
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        v, ev, fails, unclears = verdict_for(rec)
        grep_fails = [f for f in fails if not f.startswith("M-19d")]
        v2, note, learn = meta_reconcile(v, grep_fails, rec.get("meta", ""))
        if v2 != v or note:
            ev = ev + note
            v = v2
        cell = f"{v} (creative v2.1 {ts}) - {ev}"
        if rec.get("asset") == "9x16":
            cell += " (9x16)"
        out.append({
            "row": rec["row"],
            "verdict": v,
            "cell": cell,
            "fileid": rec.get("fileid", ""),
            "evidence": ev,
            "meta": rec.get("meta", ""),
            "asset": rec.get("asset", ""),
            "bud_plant": (rec.get("bud_plant", "no") or "no").lower(),
            "leaf_icon": (rec.get("leaf_icon", "no") or "no").lower(),
            "text_verdict": v,
        })
    json.dump(out, open(sys.argv[1].replace(".jsonl", "_verdicts.json"), "w"), indent=0)
    from collections import Counter

    c = Counter(o["verdict"] for o in out)
    print(f"{len(out)} verdicts:", dict(c))
