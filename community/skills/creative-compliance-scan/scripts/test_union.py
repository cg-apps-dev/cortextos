"""Regression test for the reconciled grep_verdict.py UNION.
Proves neither side regresses: live-ahead features (brain-hard union, M-16a refinement,
M-2 inline) AND community-ahead features (robust de-code loader + loud fallback banner,
broad legality verb-set in LAST_KNOWN_DECODE_HARD_FAIL degraded path).
Run: python3 test_union.py            # normal-path cases (brain data present)
     python3 test_union.py --degraded  # forced fallback path (bad CODING_SIGNALS_JSON)
"""
import sys, os, io, importlib.util, contextlib

UNION = os.path.join(os.path.dirname(__file__), "grep_verdict.py")

def load_module(capture_stderr):
    spec = importlib.util.spec_from_file_location("gv_union", UNION)
    m = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stderr(capture_stderr):
        spec.loader.exec_module(m)
    return m

def rec(text):
    return {"product": "flower", "vision_text": text, "vision_text2": "", "ocr_text": ""}

def run_normal():
    err = io.StringIO()
    m = load_module(err)
    load_log = err.getvalue()
    fails = []
    def check(name, text, want_verdict=None, want_not_fail_substr=None, want_fail=True):
        v, ev, f, u = m.verdict_for(rec(text))
        ok = True; why = ""
        if want_verdict and v != want_verdict:
            ok = False; why = f"verdict={v} (wanted {want_verdict}) ev={ev!r} fails={f}"
        if want_fail and v not in ("FAIL", "UNCLEAR"):
            ok = False; why = f"expected FAIL/UNCLEAR, got {v} ev={ev!r}"
        if want_not_fail_substr is not None:
            # assert NO M-16a fail for this text
            if any("16a" in x for x in f):
                ok = False; why = f"M-16a wrongly fired on {want_not_fail_substr!r}: {f}"
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: v={v} fails={f} unclears={u}")
        if not ok:
            print(f"        -> {why}")
            fails.append(name)
    print("== NORMAL PATH (brain data present) ==")
    print("  load banners:")
    for ln in load_log.strip().splitlines():
        print("    | " + ln)
    assert "brain hard[] loaded" in load_log, "brain-hard union did NOT load (dead-scan!)"
    print("  [PASS] brain-hard union loaded (positive proof, not dead)")
    # live-ahead: brain-hard union term (M-2 legality that lives in brain hard[])
    check("brain-hard 'federally compliant'", "Now federally compliant nationwide", want_fail=True)
    # live-ahead: M-2 inline flower
    check("M-2 inline 'Clean Green Flower'", "Clean Green Flower 3.5g", want_fail=True)
    # live-ahead: M-16a refined - 3+digit count SHOULD fail
    check("M-16a 3-digit count '8,249 reviews'", "Over 8,249 reviews from happy customers", want_fail=True)
    # live-ahead: M-16a refined - 2-digit testimonial age should NOT fire M-16a
    check("M-16a refine: 2-digit age no-FP 'Maya, 31, Brooklyn'", "Maya, 31, Brooklyn loves it",
          want_not_fail_substr="Maya, 31", want_fail=False)
    # clean PASS
    v, ev, f, u = m.verdict_for(rec("Feel your best every day. Natural wellness."))
    ok = (v == "PASS")
    print(f"  [{'PASS' if ok else 'FAIL'}] clean PASS: v={v} ev={ev!r}")
    if not ok: fails.append("clean PASS")
    return fails

def run_degraded():
    import re
    os.environ["CODING_SIGNALS_JSON"] = "/tmp/creative-compliance-scan-missing-coding-signals.json"
    err = io.StringIO()
    m = load_module(err)
    print("== DEGRADED/FALLBACK GUARDS (LAST_KNOWN_DECODE broad-verb port + robust loader) ==")
    fails = []
    # community port A (static guard): eligible-states hard-fail fallback must carry the broad verb-set,
    # but it must NOT be included in DECODE_CREATIVE_RE's unclear mask.
    lk0 = m.LAST_KNOWN_DECODE_HARD_FAIL[0]
    for verb in ("sold", "sells", "buy", "order", "gets", "purchas"):
        if verb not in lk0:
            print(f"  [FAIL] LAST_KNOWN_DECODE_HARD_FAIL[0] missing broad verb '{verb}' (regressed to live-narrow)")
            fails.append(f"LK broad-verb:{verb}")
    if not fails:
        print("  [PASS] LAST_KNOWN_DECODE_HARD_FAIL[0] carries broad verb-set (sold/sells/buy/order/gets/purchas)")
    # and its compiled regex actually matches broad-verb phrasing that live-narrow would MISS
    lk_re = re.compile("|".join(f"(?:{p})" for p in m.LAST_KNOWN_DECODE_HARD_FAIL), re.IGNORECASE)
    for phrase, should in (("you can buy this in legal states", True),
                           ("sold in eligible states", True),
                           ("ships to eligible states", True)):
        hit = bool(lk_re.search(phrase))
        ok = (hit == should)
        print(f"  [{'PASS' if ok else 'FAIL'}] LAST_KNOWN regex on {phrase!r}: match={hit}")
        if not ok: fails.append(f"LK regex:{phrase}")
    # community port B (static guard): robust loader is multi-path + has the loud never-silent banner
    import inspect
    src = inspect.getsource(m._load_decode_creative)
    if "candidates = [" in src and "NOT loaded from a live source" in src and "surface_handling" in src:
        print("  [PASS] de-code loader is multi-path + loud never-silent fallback + per-surface handling")
    else:
        print("  [FAIL] robust multi-path/loud-fallback/per-surface loader NOT present"); fails.append("robust loader")
    v, ev, f, u = m.verdict_for(rec("Sold in legal states."))
    ok = (v == "FAIL")
    print(f"  [{'PASS' if ok else 'FAIL'}] eligible-states hard-fail is unmasked: v={v} fails={f} unclears={u}")
    if not ok:
        fails.append("eligible states unmasked")
    v, ev, f, u = m.verdict_for(rec("Independently tested before it ships."))
    ok = (v == "UNCLEAR")
    print(f"  [{'PASS' if ok else 'FAIL'}] lab/COA de-code remains unclear-mask: v={v} fails={f} unclears={u}")
    if not ok:
        fails.append("lab de-code unclear")
    return fails

if __name__ == "__main__":
    if "--degraded" in sys.argv:
        fails = run_degraded()
    else:
        fails = run_normal()
    print()
    if fails:
        print(f"RESULT: {len(fails)} FAILED: {fails}"); sys.exit(1)
    print("RESULT: ALL PASS")
