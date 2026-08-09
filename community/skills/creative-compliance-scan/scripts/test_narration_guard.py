"""Regression test for the scene-description-narration guard (grep_verdict.py _reject_narration,
added 2026-07-31). Origin: the SAME extraction mistake ("[on-screen: a product pouch with...]"
polluting vision_text and false-tripping the M-2 candidate grep on the word "product") happened
twice in one session despite the first instance being logged as a lesson - a memory-only fix does
not survive under load. This structural guard fires on every file processed through grep_verdict.py's
__main__ loop, with no separate step to remember. Run: python3 test_narration_guard.py"""
import json
import os
import tempfile
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GREP_VERDICT = os.path.join(SCRIPT_DIR, "grep_verdict.py")


def _run(records):
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
        path = f.name
    try:
        p = subprocess.run([sys.executable, GREP_VERDICT, path, "test"],
                            capture_output=True, text=True, timeout=30)
        return p.returncode, p.stdout, p.stderr
    finally:
        os.unlink(path)


def test_all():
    cases = 0
    # (1) narration in vision_text -> must raise (nonzero exit), never silently produce a verdict.
    rc, out, err = _run([{"row": 1, "fileid": "x", "asset": "1x1", "product": "flower",
                           "vision_text": "SALE [on-screen: a product pouch sits on the counter]",
                           "ocr_text": "SALE", "vo_text": "", "bud_plant": "no", "leaf_icon": "no"}])
    assert rc != 0, f"narration in vision_text must fail loud, got rc={rc}"
    assert "narration" in err, f"error must name the defect, got: {err!r}"
    cases += 1

    # (2) narration in ocr_text -> same, any of the 4 fields must be checked, not just vision_text.
    rc, out, err = _run([{"row": 2, "fileid": "x", "asset": "1x1", "product": "flower",
                           "vision_text": "SALE", "ocr_text": "[the scene shows a hand holding a pouch]",
                           "vo_text": "", "bud_plant": "no", "leaf_icon": "no"}])
    assert rc != 0, f"narration in ocr_text must fail loud, got rc={rc}"
    cases += 1

    # (3) narration in vo_text -> same, video records must be checked too.
    rc, out, err = _run([{"row": 3, "fileid": "x", "asset": "9x16", "product": "flower",
                           "vision_text": "SALE", "ocr_text": "SALE",
                           "vo_text": "[on-screen: kitchen scenes with a product pouch visible]",
                           "bud_plant": "no", "leaf_icon": "no"}])
    assert rc != 0, f"narration in vo_text must fail loud, got rc={rc}"
    cases += 1

    # (4) HEALTHY CONTROL - short legit bracket ad-copy must NOT be flagged (no over-block).
    rc, out, err = _run([{"row": 4, "fileid": "x", "asset": "1x1", "product": "flower",
                           "vision_text": "SALE NOW [LIMITED TIME]", "ocr_text": "SALE NOW",
                           "vo_text": "", "bud_plant": "no", "leaf_icon": "no"}])
    assert rc == 0, f"short legit bracket ad-copy must NOT be blocked, got rc={rc} err={err!r}"
    assert "'PASS': 1" in out or "PASS" in out, f"expected a real PASS verdict, got: {out!r}"
    cases += 1

    # (5) HEALTHY CONTROL - no brackets at all, ordinary record, must pass through untouched.
    rc, out, err = _run([{"row": 5, "fileid": "x", "asset": "1x1", "product": "flower",
                           "vision_text": "Premium quality, delivered fast.", "ocr_text": "Premium quality",
                           "vo_text": "", "bud_plant": "no", "leaf_icon": "no"}])
    assert rc == 0, f"ordinary bracket-free record must pass through, got rc={rc} err={err!r}"
    cases += 1

    # (6) EDGE - a 4-word bracket (at the threshold boundary) must NOT trip (only >=5 words does).
    rc, out, err = _run([{"row": 6, "fileid": "x", "asset": "1x1", "product": "flower",
                           "vision_text": "SALE [tap here to shop]", "ocr_text": "SALE",
                           "vo_text": "", "bud_plant": "no", "leaf_icon": "no"}])
    assert rc == 0, f"4-word bracket must stay under the narration threshold, got rc={rc} err={err!r}"
    cases += 1

    print(f"OK: {cases} narration-guard cases pass (3 must-fail-loud + 3 healthy-control)")


if __name__ == "__main__":
    test_all()
