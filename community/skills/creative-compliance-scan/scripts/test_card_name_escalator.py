"""M-8b card-name escalator tests (scan-wiring half; design locked 2026-10-11, mc msg 1791731592934).

Run:
  python3 community/skills/creative-compliance-scan/scripts/test_card_name_escalator.py

Covers: absence semantics (no card_name = byte-identical, patterns file never touched), PASS-only
floor (FAIL/UNCLEAR never downgraded or touched), fail-closed patterns-file load (missing/empty =
raise, never silent no-routing), known-bad fires + known-good passes (healthy-control discipline),
case-insensitivity, and chain order under meta_reconcile (a Meta-DISAPPROVED FAIL is never masked).
These tests exercise the escalator seam directly with a synthetic patterns file - they do NOT need a
real /tmp/brain (BANNED_TERMS_JSON env is set to a temp dir purely for sibling-path derivation).
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile

GV = os.path.join(os.path.dirname(__file__), "grep_verdict.py")

PATTERNS = {
    "version": "1.0.0",
    "card_name_patterns": [
        "news[ -]?anchor", "\\banchor(man|woman)?\\b", "breaking[ -]?news",
        "newsroom", "news[ -]?desk", "\\bbroadcast\\b",
    ],
}


def load_module():
    spec = importlib.util.spec_from_file_location("gv_m8b", GV)
    m = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(m)
    return m


def fresh(tmpdir, write_patterns=True, patterns=None):
    """Point BANNED_TERMS_JSON into tmpdir (sibling-path derivation only) + reset the module cache."""
    os.environ["BANNED_TERMS_JSON"] = os.path.join(tmpdir, "banned-terms.json")
    routing = os.path.join(tmpdir, "news-anchor-routing.json")
    if os.path.exists(routing):
        os.remove(routing)
    if write_patterns:
        with open(routing, "w", encoding="utf-8") as fh:
            json.dump(patterns if patterns is not None else PATTERNS, fh)
    m = load_module()
    m._CARD_NAME_ROUTING = None
    return m


def main():
    fails = []
    tmpdir = tempfile.mkdtemp(prefix="m8b-test-")
    try:
        # 1. ABSENCE: no card_name -> unchanged, patterns file NEVER touched (file absent, must not raise)
        m = fresh(tmpdir, write_patterns=False)
        v, ev = m.apply_card_name_escalator("PASS", "clean", {"row": 1})
        if (v, ev) == ("PASS", "clean"):
            print("  [PASS] no card_name = byte-identical (patterns file absent, untouched)")
        else:
            fails.append("absence"); print(f"  [FAIL] absence changed verdict: {v!r} {ev!r}")

        # 2. PASS + matching name -> UNCLEAR with M-8b routing note
        m = fresh(tmpdir)
        v, ev = m.apply_card_name_escalator("PASS", "", {"row": 2, "card_name": "News Anchor #4 - Skeptic"})
        if v == "UNCLEAR" and "M-8b" in ev and "routing" in ev:
            print("  [PASS] PASS + News Anchor name -> UNCLEAR, M-8b routing note")
        else:
            fails.append("escalate"); print(f"  [FAIL] expected UNCLEAR+note, got {v!r} {ev!r}")

        # 3. KNOWN-BAD CONTROL fires across seed patterns + case-insensitive
        m = fresh(tmpdir)
        bad = ["BREAKING NEWS skit V2", "The Newsroom Reaction", "UGC broadcast desk bit",
               "Anchorwoman testimonial", "news-desk cutaway"]
        misses = [n for n in bad
                  if m.apply_card_name_escalator("PASS", "", {"card_name": n})[0] != "UNCLEAR"]
        if not misses:
            print("  [PASS] known-bad control names all fire (case-insensitive)")
        else:
            fails.append("known-bad"); print(f"  [FAIL] known-bad names did not fire: {misses}")

        # 4. KNOWN-GOOD CONTROL passes (healthy names must not fire)
        good = ["MB_CG_IMG_901 - Flower TOF: Cozy Evening", "UGC #241 - Gardening Wind-Down",
                "Jaxon unboxing V3", "PODB-170 - GridBank Text-on-Screen"]
        wrong = [n for n in good
                 if m.apply_card_name_escalator("PASS", "", {"card_name": n})[0] != "PASS"]
        if not wrong:
            print("  [PASS] known-good control names all stay PASS")
        else:
            fails.append("known-good"); print(f"  [FAIL] healthy names fired: {wrong}")

        # 5. PASS-ONLY floor: FAIL and UNCLEAR are untouched even on a match
        for base in ("FAIL", "UNCLEAR"):
            v, ev = m.apply_card_name_escalator(base, "x", {"card_name": "News Anchor #4"})
            if (v, ev) != (base, "x"):
                fails.append(f"worst-of-{base}"); print(f"  [FAIL] {base} was modified: {v!r} {ev!r}")
        if not any(f.startswith("worst-of") for f in fails):
            print("  [PASS] FAIL/UNCLEAR untouched (worst-of holds)")

        # 6. FAIL-CLOSED: card_name present + PASS + patterns file MISSING -> raise
        m = fresh(tmpdir, write_patterns=False)
        try:
            m.apply_card_name_escalator("PASS", "", {"card_name": "News Anchor #4"})
            fails.append("fail-closed-missing"); print("  [FAIL] missing patterns file did not raise")
        except Exception:
            print("  [PASS] missing patterns file raises (fail-closed, no silent no-routing)")

        # 7. FAIL-CLOSED: empty card_name_patterns -> raise
        m = fresh(tmpdir, patterns={"version": "1.0.0", "card_name_patterns": []})
        try:
            m.apply_card_name_escalator("PASS", "", {"card_name": "News Anchor #4"})
            fails.append("fail-closed-empty"); print("  [FAIL] empty patterns did not raise")
        except Exception:
            print("  [PASS] empty card_name_patterns raises (fail-closed)")

        # 8. CHAIN ORDER: Meta-DISAPPROVED flips PASS->FAIL in meta_reconcile; escalator never masks it
        m = fresh(tmpdir)
        v, note, _ = m.meta_reconcile("PASS", [], "DISAPPROVED")
        v2, _ = m.apply_card_name_escalator(v, note, {"card_name": "News Anchor #4"})
        if v == "FAIL" and v2 == "FAIL":
            print("  [PASS] chain order: Meta-DISAPPROVED FAIL survives the escalator")
        else:
            fails.append("chain-order"); print(f"  [FAIL] chain order broke: reconcile={v!r} after-escalator={v2!r}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        os.environ.pop("BANNED_TERMS_JSON", None)

    if fails:
        print(f"RESULT: FAIL ({len(fails)}): {fails}")
        return 1
    print("RESULT: PASS (8/8 groups)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
