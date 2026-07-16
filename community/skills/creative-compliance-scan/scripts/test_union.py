"""Regression test for grep_verdict.py as a thin verdict_core front-end.

Run:
  python3 community/skills/creative-compliance-scan/scripts/test_union.py
"""
import contextlib
import importlib.util
import io
import os
import sys

UNION = os.path.join(os.path.dirname(__file__), "grep_verdict.py")


def load_module(capture_stderr):
    spec = importlib.util.spec_from_file_location("gv_union", UNION)
    m = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stderr(capture_stderr):
        assert spec.loader is not None
        spec.loader.exec_module(m)
    return m


def rec(text):
    return {"product": "flower", "vision_text": text, "vision_text2": "", "ocr_text": ""}


def run_normal():
    err = io.StringIO()
    m = load_module(err)
    fails = []
    if err.getvalue():
        fails.append("import side effects")
        print(f"  [FAIL] import produced stderr: {err.getvalue()!r}")
    else:
        print("  [PASS] import is side-effect-free")

    authority = m.verdict_core.load()
    if authority.status != "ok":
        fails.append("authority load")
        print(f"  [FAIL] authority status={authority.status} reasons={authority.reasons}")
    else:
        print("  [PASS] explicit authority load succeeds")

    cases = [
        ("brain-hard federally compliant", "Now federally compliant nationwide", "UNCLEAR"),
        ("M-2 inline Clean Green Flower", "Clean Green Flower 3.5g", "UNCLEAR"),
        ("M-16a 3-digit count", "Over 8,249 reviews from happy customers", "UNCLEAR"),
        ("M-16a refine age no-FP", "Maya, 31, Brooklyn loves it", "PASS"),
        ("clean PASS", "Feel your best every day. Natural wellness.", "PASS"),
    ]
    for name, text, want in cases:
        v, ev, f, u = m.verdict_for(rec(text))
        ok = v == want
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: v={v} fails={f} unclears={u}")
        if not ok:
            fails.append(name)
    return fails


def run_degraded():
    os.environ["CODING_SIGNALS_JSON"] = "/tmp/creative-compliance-scan-missing-coding-signals.json"
    err = io.StringIO()
    m = load_module(err)
    calls = []
    m.verdict_core._ALERTED.clear()
    m.verdict_core.subprocess.run = lambda args, timeout=None, check=False: calls.append(args)
    v, ev, f, u = m.verdict_for(rec("Independently tested before it ships."))
    ok = v == "UNCLEAR" and "authority degraded" in ev
    print(f"  [{'PASS' if ok else 'FAIL'}] missing coding signals fail closed: v={v} ev={ev!r}")
    if "CODING_SIGNALS_JSON" in os.environ:
        del os.environ["CODING_SIGNALS_JSON"]
    return [] if ok else ["degraded fail-closed"]


if __name__ == "__main__":
    if "--degraded" in sys.argv:
        failures = run_degraded()
    else:
        failures = run_normal()
    print()
    if failures:
        print(f"RESULT: {len(failures)} FAILED: {failures}")
        sys.exit(1)
    print("RESULT: ALL PASS")
