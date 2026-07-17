#!/usr/bin/env python3
"""grep_verdict modality-tag hardening tests (task_1784157356946).

Closes the prefix-naming latent fail-open: _single_vision_only tagged modality by the "vision" NAME-PREFIX,
so a non-vision source named "vision*" (e.g. "vision_ocr") mis-tagged as vision and downgraded a real
corroboration to UNCLEAR (fail-open-DIRECTION). Fix = explicit _SOURCE_MODALITY map; an unregistered
source is UNKNOWN -> fail-CLOSED (non-vision -> the hit FAILs, never UNCLEAR) + a loud NAMED degradation
(per-row) + a cross-process-deduped ops-PAGE.

Covers the security+mc two-touch re-gate: (1) unknown->FAIL not UNCLEAR; (2) loud note NAMES the source;
(3) _alert_source_config = ops-only + log-always + test-quiet + CROSS-PROCESS DEDUP; (4) vision_ocr-prefix
-> FAIL (hole closed); (5) vision3-registered -> UNCLEAR preserved; (6) completeness (all live sources
mapped); (7) docstring rewritten [manual]; (8) no-crash-on-unknown; plus security A (recovery does NOT
clear the source-config dedup = no re-open) and B (N rows -> N degradations, 1 page = loud-per-row/
deduped-page). Run: python3 test_modality_tag_hardening.py
"""
import contextlib, importlib.util, io, os, shutil, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE_DATA = "/tmp/brain/agents/meta-compliance-agent/data"


def _import_core():
    spec = importlib.util.spec_from_file_location("verdict_core_mt", os.path.join(HERE, "verdict_core.py"))
    m = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(m)
    return m


def _make_valid_brain(dest):
    data = os.path.join(dest, "agents", "meta-compliance-agent", "data")
    os.makedirs(data, exist_ok=True)
    for f in ("banned-terms.json", "cannabis-coding-signals.json", "strain-lexicon.json"):
        shutil.copyfile(os.path.join(LIVE_DATA, f), os.path.join(data, f))


def _env_for(root):
    d = os.path.join(root, "agents", "meta-compliance-agent", "data")
    return {
        "BANNED_TERMS_JSON": os.path.join(d, "banned-terms.json"),
        "CODING_SIGNALS_JSON": os.path.join(d, "cannabis-coding-signals.json"),
        "STRAIN_LEXICON_JSON": os.path.join(d, "strain-lexicon.json"),
    }


def _recorder(core):
    """Replace subprocess.run so the test NEVER touches the real bus (no page to ops - the phantom lesson).
    Records the argv of each call so we can count log-event vs notify-agent."""
    calls = []
    core.subprocess.run = lambda argv, *a, **k: calls.append(list(argv)) or None
    return calls


# ---------- (1)(4)(5) _single_vision_only: explicit map, unknown fail-closed ----------
def test_single_vision_only_registered_and_nonvision():
    core = _import_core()
    assert core._single_vision_only(["vision"]) is True, "registered vision -> single-vision (UNCLEAR path)"
    assert core._single_vision_only(["vision", "vision2"]) is True, "two vision passes -> still single-modality"
    assert core._single_vision_only(["ocr"]) is False, "single ocr -> non-vision corroboration -> FAIL"
    assert core._single_vision_only(["vo"]) is False, "vo -> non-vision -> FAIL"
    assert core._single_vision_only(["vision", "ocr"]) is False, "mixed -> has non-vision corroboration -> FAIL"
    print("  [PASS] _single_vision_only: registered vision True; non-vision False")


def test_single_vision_only_unknown_fail_closed_hole_closed():
    core = _import_core()
    # THE HOLE: OLD code did `startswith("vision")` -> "vision_ocr" mis-tagged as vision -> True -> UNCLEAR.
    assert "vision_ocr".startswith("vision") is True, "documents the OLD prefix hole (vision_ocr looked vision)"
    # NEW: explicit map -> "vision_ocr" is UNREGISTERED -> not provably vision -> False -> FAIL branch.
    assert core._single_vision_only(["vision_ocr"]) is False, "HOLE CLOSED: unknown prefix-match -> FAIL not UNCLEAR"
    assert core._single_vision_only(["vision3"]) is False, "unregistered vision3 -> fail-closed (must register)"
    assert core._single_vision_only(["foo"]) is False, "arbitrary unknown -> fail-closed"
    assert core._single_vision_only([]) is False, "empty names -> fail-closed (FAIL branch)"
    print("  [PASS] unknown source (incl vision_ocr prefix) -> False -> FAIL (fail-open hole closed)")


def test_vision3_registered_preserves_unclear():
    core = _import_core()
    assert core._single_vision_only(["vision3"]) is False, "unregistered -> fail-closed"
    core._SOURCE_MODALITY = dict(core._SOURCE_MODALITY, vision3="vision")  # 1-line registration
    assert core._single_vision_only(["vision3"]) is True, "registered vision3 -> single-vision UNCLEAR preserved"
    assert core._single_vision_only(["vision", "vision3"]) is True, "vision+registered-vision3 -> still single-modality"
    print("  [PASS] vision3 registered -> UNCLEAR preserved (explicit registration works, 1 line)")


# ---------- (6) completeness: every live source name is registered ----------
def test_completeness_all_live_sources_registered():
    core = _import_core()
    unregistered = [n for n in core._VERDICT_SOURCE_NAMES if n not in core._SOURCE_MODALITY]
    assert not unregistered, f"live source(s) not in _SOURCE_MODALITY: {unregistered} (drift lock)"
    print("  [PASS] completeness: every _VERDICT_SOURCE_NAMES entry is registered in _SOURCE_MODALITY")


# ---------- (3) _alert_source_config: log-always + test-quiet + dedup ----------
def test_alert_source_config_test_quiet_logs_but_no_page():
    core = _import_core()
    calls = _recorder(core)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td; os.environ["CTX_TEST"] = "1"
        try:
            core._alert_source_config(["vision_ocr"])
        finally:
            os.environ.pop("CTX_TEST", None); os.environ.pop("CTX_ROOT", None)
    log = [c for c in calls if "log-event" in c]
    page = [c for c in calls if "notify-agent" in c]
    assert log, "log-event must fire ALWAYS (audit never silent)"
    assert not page, "CTX_TEST quiet-path: NO real notify-agent page from the test (must-not-page-ops)"
    print("  [PASS] _alert_source_config: log-event always, CTX_TEST -> no ops page (test-quiet honored)")


def test_alert_source_config_ops_only_targets():
    core = _import_core()
    calls = _recorder(core)
    core._is_test_context = lambda: False  # force the notify loop (recorder prevents any real page)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            core._alert_source_config(["vision_ocr"])
        finally:
            os.environ.pop("CTX_ROOT", None)
    pages = [c for c in calls if "notify-agent" in c]
    targets = {c[c.index("notify-agent") + 1] for c in pages}
    assert targets == set(core._ALERT_OPS_TARGETS), f"ops-only targets, got {targets}"
    assert "meta-ads-agent" not in targets and "6991789266" not in str(pages), "NO Adam-facing runner"
    print(f"  [PASS] _alert_source_config: ops-only targets {sorted(targets)} (no Adam-facing)")


def test_source_config_dedup_flood_to_one():
    core = _import_core()
    _recorder(core)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            claimed = 0
            for _ in range(12):                 # 12 "processes" (fresh per-proc set each round)
                core._ALERTED.clear()
                if core._notify_dedup(core._source_config_key(["vision_ocr"]),
                                      ("source-config", ("vision_ocr",)),
                                      core._source_config_dedup_dir()):
                    claimed += 1
        finally:
            os.environ.pop("CTX_ROOT", None)
    assert claimed == 1, f"flood->one: expected 1 cross-process claim, got {claimed}"
    print("  [PASS] source-config dedup: 12 concurrent same-source-error -> ONE page (flood->one)")


# ---------- security A: healthy classify (recovery) must NOT clear the source-config dedup ----------
def test_recovery_does_not_clear_source_config_dedup():
    core = _import_core()
    _recorder(core)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            sc_dir = core._source_config_dedup_dir()
            auth_dir = core._alert_dedup_dir()
            assert sc_dir != auth_dir, "source-config dedup dir MUST be separate from the authority dir"
            key = core._source_config_key(["vision_ocr"])
            # first claim -> would page
            assert core._notify_dedup(key, ("source-config", ("vision_ocr",)), sc_dir) is True
            keyfile = os.path.join(sc_dir, key)
            assert os.path.exists(keyfile), "source-config dedup key file created"
            # a HEALTHY classify fires _alert_recovery() -> it clears ONLY the authority dir
            core._alert_recovery()
            assert os.path.exists(keyfile), "SECURITY-A: recovery must NOT delete the source-config key (no re-open)"
            # next same-source claim (new proc) still deduped -> no re-page
            core._ALERTED.clear()
            assert core._notify_dedup(key, ("source-config", ("vision_ocr",)), sc_dir) is False, \
                "still suppressed after a healthy classify (flood cannot re-open)"
        finally:
            os.environ.pop("CTX_ROOT", None)
    print("  [PASS] SECURITY-A: separate dir; _alert_recovery does NOT clear source-config dedup (no re-open)")


# ---------- (2)(8) + security B: record-level - unknown -> FAIL, NAMED, loud-per-row/deduped-page ----------
def _authority(core, root):
    _make_valid_brain(root)
    return core.load(_env_for(root))


def test_unregistered_source_record_fails_named_no_crash():
    core = _import_core()
    _recorder(core)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td; os.environ["CTX_TEST"] = "1"
        try:
            auth = _authority(core, os.path.join(td, "brain"))
            core._SOURCE_MODALITY = {k: v for k, v in core._SOURCE_MODALITY.items() if k != "ocr"}  # drop ocr
            # no-crash: classify must RETURN (not raise/propagate) even with an unregistered source
            v = core.classify({"ocr_text": "clean copy"}, auth, surface="creative")
            assert v.verdict == "FAIL", f"unregistered source -> FAIL (never PASS/UNCLEAR), got {v.verdict}"
            assert "ocr" in v.evidence, "(2) loud note must NAME the unregistered source"
            assert "register in _SOURCE_MODALITY" in v.evidence.lower() or \
                   any("register" in f.lower() for f in v.fails), "note is actionable (register-in-map)"
        finally:
            os.environ.pop("CTX_TEST", None); os.environ.pop("CTX_ROOT", None)
    print("  [PASS] (2)(8): unregistered source -> record FAILs, note NAMES 'ocr', no crash (classify returned)")


def test_dedup_split_N_rows_N_degradations_one_page():
    core = _import_core()
    calls = _recorder(core)  # recorder prevents any real bus call; force notify loop for page-counting
    core._is_test_context = lambda: False
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td
        try:
            auth = _authority(core, os.path.join(td, "brain"))
            core._SOURCE_MODALITY = {k: v for k, v in core._SOURCE_MODALITY.items() if k != "ocr"}
            degradations = 0
            for _ in range(8):                       # 8 affected rows
                v = core.classify({"ocr_text": "row copy"}, auth, surface="creative")
                if v.verdict == "FAIL" and "ocr" in v.evidence:
                    degradations += 1               # per-row named degradation (NOT dedup-gated)
            pages = [c for c in calls if "notify-agent" in c]
        finally:
            os.environ.pop("CTX_ROOT", None)
    assert degradations == 8, f"SECURITY-B loud-per-row: 8 rows -> 8 named degradations, got {degradations}"
    # ONE page notifies each ops target once (mc + orch), so 1 deduped page == len(_ALERT_OPS_TARGETS)
    # notify-agent calls total across all 8 rows (rows 2-8 dedup -> no page).
    n_targets = len(core._ALERT_OPS_TARGETS)
    assert len(pages) == n_targets, f"SECURITY-B deduped-page: 8 rows -> 1 page ({n_targets} target-notifies), got {len(pages)}"
    print("  [PASS] SECURITY-B: 8 rows -> 8 visible named degradations, 1 deduped ops page (no silent-after-first)")


def test_degraded_parity_unknown_never_pass():
    core = _import_core()
    _recorder(core)
    with tempfile.TemporaryDirectory() as td:
        os.environ["CTX_ROOT"] = td; os.environ["CTX_TEST"] = "1"
        try:
            auth = _authority(core, os.path.join(td, "brain"))
            core._SOURCE_MODALITY = {k: v for k, v in core._SOURCE_MODALITY.items() if k != "vo"}  # drop vo
            for rec in ({}, {"vo_text": "clean"}, {"ocr_text": "clean product copy"}):
                v = core.classify(rec, auth, surface="creative")
                assert v.verdict != "PASS", f"degraded-parity invariant: unknown source must never PASS ({rec})"
        finally:
            os.environ.pop("CTX_TEST", None); os.environ.pop("CTX_ROOT", None)
    print("  [PASS] degraded-parity: an unregistered source NEVER PASSes (never-PASS invariant)")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    import traceback
    ok = fail = 0
    for t in tests:
        try:
            t(); ok += 1
        except Exception as e:
            fail += 1
            print(f"  [FAIL] {t.__name__}: {e}")
            traceback.print_exc()
    print(f"\nRESULT: {ok} passed, {fail} failed  ({len(tests)} modality-tag hardening tests)")
    raise SystemExit(1 if fail else 0)
