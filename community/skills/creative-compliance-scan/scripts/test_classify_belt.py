#!/usr/bin/env python3
"""classify() outer fail-closed belt tests (task_1784266462532).

The belt wraps the verdict path so ANY unexpected exception -> fail-CLOSED (verdict="UNCLEAR" +
must_not_pass=True + authority_class="internal_error"), never crash/propagate, + a loud deduped ops-alert.
Covers the security+mc run-it re-gate: belt-catches (not crash); BOTH surfaces never-PASS (grep_verdict
UNCLEAR-string + copy-gate must_not_pass+distinct-class hard-error routing); _alert_internal_error dedup
same-(surface,type)-DIFFERENT-messages->1 (the message-not-in-key proof) / two-types->2 / separate-dir-
survives-recovery / ops-only+log-always+test-quiet; except-Exception-NOT-BaseException (SystemExit
propagates); degraded-parity (non-raise byte-identical); no-masking. Run: python3 test_classify_belt.py
"""
import contextlib, importlib.util, io, os, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _import_core():
    spec = importlib.util.spec_from_file_location("verdict_core_belt", os.path.join(HERE, "verdict_core.py"))
    m = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(m)
    return m


def _recorder(core):
    calls = []
    core.subprocess.run = lambda argv, *a, **k: calls.append(list(argv)) or None
    return calls


def _raise(exc):
    def _f(*a, **k):
        raise exc
    return _f


# ---------- belt catches -> fail-closed internal_error, not crash ----------
def test_belt_catches_exception_fails_closed():
    core = _import_core(); _recorder(core)
    os.environ["CTX_TEST"] = "1"
    try:
        core._classify_impl = _raise(RuntimeError("boom row-42 <obj at 0x7f>"))
        r = core.classify({"ocr_text": "x"}, object(), surface="creative")
    finally:
        os.environ.pop("CTX_TEST", None)
    assert r.verdict == "UNCLEAR", f"belt -> UNCLEAR (never PASS), got {r.verdict}"
    assert r.must_not_pass is True, "belt -> must_not_pass (copy-gate hard-error)"
    assert r.authority_class == "internal_error", "distinct class (copy-gate routing)"
    assert "internal error" in r.evidence and "RuntimeError" in r.evidence, "loud named evidence"
    print("  [PASS] belt catches -> UNCLEAR+must_not_pass+internal_error (not crash/propagate), named evidence")


def test_belt_all_three_signals_load_bearing():
    # verify="UNCLEAR" (grep creative), must_not_pass (copy-gate), authority_class distinct-from component_loss+ok
    core = _import_core(); _recorder(core)
    os.environ["CTX_TEST"] = "1"
    try:
        core._classify_impl = _raise(KeyError("k"))
        r = core.classify("copy text", object(), surface="copy")
    finally:
        os.environ.pop("CTX_TEST", None)
    assert r.verdict == "UNCLEAR" and r.must_not_pass is True
    assert r.authority_class == "internal_error" and r.authority_class not in ("component_loss", "ok")
    print("  [PASS] all three fail-closed signals present + class distinct from component_loss/ok")


# ---------- except Exception NOT BaseException: SystemExit/KeyboardInterrupt propagate ----------
def test_systemexit_propagates_through_belt():
    core = _import_core(); _recorder(core)
    os.environ["CTX_TEST"] = "1"
    try:
        core._classify_impl = _raise(SystemExit("shutdown"))
        raised = False
        try:
            core.classify({}, object(), surface="creative")
        except SystemExit:
            raised = True
        assert raised, "SystemExit MUST propagate (belt catches Exception, NOT BaseException)"
        core._classify_impl = _raise(KeyboardInterrupt())
        kb = False
        try:
            core.classify({}, object(), surface="creative")
        except KeyboardInterrupt:
            kb = True
        assert kb, "KeyboardInterrupt MUST propagate"
    finally:
        os.environ.pop("CTX_TEST", None)
    print("  [PASS] SystemExit + KeyboardInterrupt propagate through the belt (never swallowed)")


# ---------- degraded-parity + no-masking: belt transparent on the non-raise path ----------
def test_belt_transparent_on_non_raise():
    core = _import_core(); _recorder(core)
    sentinel_pass = core._Verdict(verdict="PASS", evidence="clean")
    sentinel_fail = core._Verdict(verdict="FAIL", evidence="M-2:'x'", fails=["M-2:'x'"])
    sentinel_unc = core._Verdict(verdict="UNCLEAR", evidence="hold", must_not_pass=True)
    for want in (sentinel_pass, sentinel_fail, sentinel_unc):
        core._classify_impl = lambda *a, _w=want, **k: _w
        r = core.classify({}, object(), surface="creative")
        assert r is want, "belt must return the impl's verdict UNCHANGED on the non-raise path (no-masking)"
    print("  [PASS] degraded-parity/no-masking: PASS/FAIL/UNCLEAR pass through the belt byte-identical")


# ---------- _alert_internal_error: dedup (message NOT in key), separate dir, ops-only, test-quiet ----------
def test_dedup_same_type_different_messages_one_page():
    core = _import_core(); _recorder(core)
    core._is_test_context = lambda: False  # force the notify decision; recorder prevents any real page
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            claimed = 0
            for i in range(12):                       # SAME type+surface, DIFFERENT messages
                core._ALERTED.clear()
                exc = RuntimeError(f"distinct message {i} row-{i} 0x{i:x}")
                if core._notify_dedup(core._internal_error_key(exc, "creative"),
                                      ("internal-error", "RuntimeError", "creative"),
                                      core._internal_error_dedup_dir()):
                    claimed += 1
        finally:
            os.environ.pop("CTX_ROOT", None)
    assert claimed == 1, f"message-NOT-in-key proof: 12 same-type diff-message -> 1 page, got {claimed}"
    print("  [PASS] dedup: 12 same-(surface,type) DIFFERENT-messages -> 1 page (message not in key)")


def test_dedup_two_types_two_pages():
    core = _import_core(); _recorder(core)
    core._is_test_context = lambda: False
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            keys = set()
            for exc in (RuntimeError("a"), KeyError("b"), RuntimeError("c")):  # 2 distinct types
                core._ALERTED.clear()
                k = core._internal_error_key(exc, "creative")
                if core._notify_dedup(k, ("internal-error", type(exc).__name__, "creative"),
                                      core._internal_error_dedup_dir()):
                    keys.add(k)
        finally:
            os.environ.pop("CTX_ROOT", None)
    assert len(keys) == 2, f"two distinct exc-types -> 2 pages (b3 per-type), got {len(keys)}"
    print("  [PASS] dedup: two distinct exc-types -> 2 pages (per-type distinct)")


def test_dedup_surface_discriminates():
    core = _import_core()
    kc = core._internal_error_key(RuntimeError("x"), "creative")
    kp = core._internal_error_key(RuntimeError("x"), "copy")
    assert kc != kp, "same exc-type, different surface -> distinct key (surface discriminator)"
    print("  [PASS] dedup: surface (copy vs creative) discriminates the key")


def test_separate_dir_survives_recovery():
    core = _import_core(); _recorder(core)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            ie_dir = core._internal_error_dedup_dir()
            auth_dir = core._alert_dedup_dir()
            assert ie_dir != auth_dir, "internal-error dir MUST be separate from authority dir"
            exc = RuntimeError("boom")
            key = core._internal_error_key(exc, "creative")
            assert core._notify_dedup(key, ("internal-error", "RuntimeError", "creative"), ie_dir) is True
            keyfile = os.path.join(ie_dir, key)
            assert os.path.exists(keyfile)
            core._alert_recovery()                    # healthy classify signal - clears ONLY the authority dir
            assert os.path.exists(keyfile), "recovery must NOT clear the internal-error dedup (no re-flood)"
            core._ALERTED.clear()
            assert core._notify_dedup(key, ("internal-error", "RuntimeError", "creative"), ie_dir) is False, \
                "still suppressed after a healthy classify"
        finally:
            os.environ.pop("CTX_ROOT", None)
    print("  [PASS] separate dir: _alert_recovery does NOT clear the internal-error dedup (no re-open)")


def test_alert_internal_error_ops_only_log_always_test_quiet():
    core = _import_core()
    # test-quiet: CTX_TEST set -> log fires, NO page
    calls = _recorder(core)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td; os.environ["CTX_TEST"] = "1"
        try:
            core._alert_internal_error(RuntimeError("x"), "creative")
        finally:
            os.environ.pop("CTX_TEST", None); os.environ.pop("CTX_ROOT", None)
    assert any("log-event" in c for c in calls), "log-event ALWAYS (audit never silent)"
    assert not any("notify-agent" in c for c in calls), "CTX_TEST quiet: no ops page from the test"
    # ops-only targets (force notify loop via _is_test_context=False; recorder prevents real page)
    core2 = _import_core(); calls2 = _recorder(core2); core2._is_test_context = lambda: False
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            core2._alert_internal_error(RuntimeError("x"), "copy")
        finally:
            os.environ.pop("CTX_ROOT", None)
    targets = {c[c.index("notify-agent") + 1] for c in calls2 if "notify-agent" in c}
    assert targets == set(core2._ALERT_OPS_TARGETS), f"ops-only, got {targets}"
    assert "meta-ads-agent" not in targets and "6991789266" not in str(calls2), "no Adam-facing"
    print(f"  [PASS] _alert_internal_error: log-always, CTX_TEST test-quiet, ops-only {sorted(targets)}")


# ---------- FRONT-END consumption: both surfaces never-PASS an internal_error verdict ----------
def test_grep_verdict_creative_never_passes_internal_error():
    import grep_verdict as g
    ie = g.verdict_core._Verdict(verdict="UNCLEAR", evidence="internal error (RuntimeError)",
                                 authority_class="internal_error", must_not_pass=True)
    saved = g.verdict_core.classify
    try:
        g.verdict_core.classify = lambda *a, **k: ie
        v, ev, fails, unclears = g.verdict_for({"ocr_text": "x"})
        assert v == "UNCLEAR", f"grep_verdict (creative) must never-PASS an internal_error, got {v}"
    finally:
        g.verdict_core.classify = saved
    print("  [PASS] grep_verdict (creative surface): internal_error -> UNCLEAR (never-PASS via string)")


def test_copy_gate_internal_error_routes_to_hard_error():
    # copy-gate gate() raises GateAuthorityError iff (must_not_pass AND authority_class != component_loss).
    # Assert the belt's internal_error verdict satisfies exactly that routing condition (security runs the
    # full gate() in their re-gate; this locks the routing-relevant properties).
    core = _import_core(); _recorder(core)
    os.environ["CTX_TEST"] = "1"
    try:
        core._classify_impl = _raise(ValueError("v"))
        r = core.classify("", object(), surface="copy")
    finally:
        os.environ.pop("CTX_TEST", None)
    routes_hard_error = bool(r.must_not_pass) and r.authority_class != "component_loss"
    assert routes_hard_error, "internal_error must hit copy-gate's must_not_pass + non-component_loss hard-error branch"
    print("  [PASS] copy-gate routing: internal_error satisfies must_not_pass AND class!=component_loss -> GateAuthorityError")


if __name__ == "__main__":
    import traceback
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    ok = fail = 0
    for t in tests:
        try:
            t(); ok += 1
        except Exception as e:
            fail += 1; print(f"  [FAIL] {t.__name__}: {e}"); traceback.print_exc()
    print(f"\nRESULT: {ok} passed, {fail} failed  ({len(tests)} classify-belt tests)")
    raise SystemExit(1 if fail else 0)
