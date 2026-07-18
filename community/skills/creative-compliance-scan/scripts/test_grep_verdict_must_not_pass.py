#!/usr/bin/env python3
"""grep_verdict must_not_pass-invariant tests (task_1784280840653).

Closes the copy/creative ASYMMETRY: copy-gate honors the must_not_pass=True -> never-PASS invariant
(must_not_pass-first, copy-gate.py L119) but grep_verdict (creative) kept the verdict STRING and discarded
must_not_pass -> a latent fail-open. Fix: verdict_for forces UNCLEAR (never-PASS) on a must_not_pass+PASS
contradiction + surfaces it LOUDLY. Security+mc two-touch: UNCLEAR form, verdict_for enforcement point,
general (any class), LOUD-not-silent, and the enforcement must HOLD through meta_reconcile (downgrade-only).
Run: python3 test_grep_verdict_must_not_pass.py
"""
import grep_verdict as g


def _mk(verdict, must_not_pass=False, authority_class="ok"):
    return g.verdict_core._Verdict(
        verdict=verdict, evidence="", fails=[], unclears=[],
        must_not_pass=must_not_pass, authority_class=authority_class,
    )


def _run_verdict_for(vobj, rec=None):
    """Call verdict_for with classify mocked to return vobj + the log-event captured (no real bus/scan)."""
    saved = (g.verdict_core.classify, g._authority, g._log_must_not_pass_contradiction)
    logged = []
    try:
        g.verdict_core.classify = lambda *a, **k: vobj
        g._authority = lambda: object()
        g._log_must_not_pass_contradiction = lambda r: logged.append(r)
        return g.verdict_for(rec or {"row": 1, "fileid": "x"}), logged
    finally:
        g.verdict_core.classify, g._authority, g._log_must_not_pass_contradiction = saved


def test_must_not_pass_pass_forced_unclear_and_loud():
    (v, ev, fails, unclears), logged = _run_verdict_for(_mk("PASS", must_not_pass=True))
    assert v == "UNCLEAR", f"must_not_pass=True + PASS must force UNCLEAR (never-PASS), got {v}"
    assert any("CORE-INVARIANT VIOLATION" in u for u in unclears), "LOUD visible note must be in unclears"
    assert len(logged) == 1, "log-event must fire on the contradiction (non-silence)"
    print("  [PASS] must_not_pass+PASS -> UNCLEAR + loud NAMED note + log-event fires (non-silent)")


def test_normal_pass_still_passes_no_overblock():
    (v, ev, fails, unclears), logged = _run_verdict_for(_mk("PASS", must_not_pass=False))
    assert v == "PASS", "a normal PASS (must_not_pass=False) must stay PASS (no over-block)"
    assert not logged and not any("CORE-INVARIANT" in u for u in unclears), "no loud signal on a normal PASS"
    print("  [PASS] normal PASS (must_not_pass=False) -> stays PASS (no over-block, no false loud)")


def test_must_not_pass_fail_and_unclear_untouched():
    (v, *_), _ = _run_verdict_for(_mk("FAIL", must_not_pass=True))
    assert v == "FAIL", "must_not_pass+FAIL stays FAIL (already never-PASS; minimal rewrite)"
    (v2, *_), _ = _run_verdict_for(_mk("UNCLEAR", must_not_pass=True))
    assert v2 == "UNCLEAR", "must_not_pass+UNCLEAR stays UNCLEAR (minimal rewrite)"
    print("  [PASS] must_not_pass+FAIL stays FAIL; must_not_pass+UNCLEAR stays UNCLEAR (only PASS rewritten)")


def test_future_proof_arbitrary_authority_class():
    (v, *_), _ = _run_verdict_for(_mk("PASS", must_not_pass=True, authority_class="some_new_unknown_class"))
    assert v == "UNCLEAR", "invariant is GENERAL: any authority_class + must_not_pass+PASS -> UNCLEAR"
    print("  [PASS] future-proof: arbitrary unknown authority_class + must_not_pass+PASS -> UNCLEAR (general)")


def test_pipeline_meta_reconcile_never_re_passes():
    # The end-to-end check: verdict_for forces UNCLEAR; meta_reconcile (the only downstream v-transform)
    # must NOT re-leak it to PASS on ANY meta.
    (v, ev, fails, unclears), _ = _run_verdict_for(_mk("PASS", must_not_pass=True))
    assert v == "UNCLEAR"
    for meta in ("ACTIVE", "APPROVED", "DISAPPROVED", "PAUSED", ""):
        v2, note, learn = g.meta_reconcile(v, fails, meta)
        assert v2 != "PASS", f"meta_reconcile re-leaked the enforced UNCLEAR to PASS on meta={meta!r}: {v2}"
    print("  [PASS] pipeline: forced UNCLEAR survives meta_reconcile on every meta (never re-leaked to PASS)")


def test_meta_reconcile_is_downgrade_only():
    # Structural: meta_reconcile never produces PASS from a non-PASS input (the D2 downgrade-only condition).
    for vin in ("FAIL", "UNCLEAR"):
        for meta in ("ACTIVE", "APPROVED", "DISAPPROVED", "PAUSED", ""):
            out, _, _ = g.meta_reconcile(vin, [], meta)
            assert out != "PASS", f"meta_reconcile({vin},{meta!r}) -> {out} (must never upgrade to PASS)"
    print("  [PASS] meta_reconcile is downgrade-only (never emits PASS from a non-PASS input)")


def test_degraded_parity_normal_records_unchanged():
    # Happy-corpus parity: a normal core verdict (no contradiction) flows through verdict_for UNCHANGED.
    for vin, mnp in (("PASS", False), ("FAIL", True), ("UNCLEAR", True)):
        (v, *_), logged = _run_verdict_for(_mk(vin, must_not_pass=mnp))
        assert v == vin, f"normal {vin} verdict must pass through unchanged, got {v}"
        assert not logged, "no contradiction-log on a normal record"
    print("  [PASS] degraded-parity: normal records (no must_not_pass+PASS) unchanged, no spurious loud")


if __name__ == "__main__":
    import traceback
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    ok = fail = 0
    for t in tests:
        try:
            t(); ok += 1
        except Exception as e:
            fail += 1; print(f"  [FAIL] {t.__name__}: {e}"); traceback.print_exc()
    print(f"\nRESULT: {ok} passed, {fail} failed  ({len(tests)} must_not_pass-invariant tests)")
    raise SystemExit(1 if fail else 0)
