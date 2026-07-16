"""Fail-closed regression tests for verdict authority loaders.

Run from repo root:
  python3 community/skills/creative-compliance-scan/scripts/test_verdict_gate_fail_closed.py
"""
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import contextlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
GREP = ROOT / "community/skills/creative-compliance-scan/scripts/grep_verdict.py"
COPY_GATE = ROOT / "agents/meta-ads-agent/meta-ad-copy-agent/references/copy-gate.py"
CORE = ROOT / "community/skills/creative-compliance-scan/scripts/verdict_core.py"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


def banned_terms(version="1.0.11", include_canaries=True, include_family=True):
    hard = []
    if include_canaries:
        hard.append({"m_code": "M-2", "pattern": r"\b(bud|flower|cannabis|thc)\b"})
    if include_family:
        hard.append({"m_code": "M-19b", "pattern": r"\bfamily[- ]grown\b"})
    hard.append({"m_code": "M-2", "pattern": r"\bstrain\b"})
    candidate = [{"m_code": "M-19b", "pattern": r"\bgrown\b"}]
    return {"version": version, "hard": hard, "candidate": candidate}


def coding_signals(version="1.1.5", include_canary=True):
    patterns = []
    if include_canary:
        patterns.append({
            "pattern": r"\blab[- ]?tested\b",
            "surface_handling": {"copy": "hard_remove", "creative": "unclear"},
        })
    patterns.append({
        "pattern": r"\bfarm[- ]?direct\b",
        "surface_handling": {"copy": "hard_remove", "creative": "unclear"},
    })
    return {"version": version, "de_code_hard_remove": {"patterns": patterns}}


def strain_lexicon(version="1.0.0", count=71, first="quiet moon"):
    strains = [first] + [f"strainname {i}" for i in range(max(0, count - 1))]
    return {"version": version, "strains": strains[:count]}


def with_env(paths, fn):
    old = {k: os.environ.get(k) for k in paths}
    try:
        for key, value in paths.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        return fn()
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def import_from(path, name):
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def valid_authority_files(tmp):
    return {
        "BANNED_TERMS_JSON": write_json(tmp / "banned-terms.json", banned_terms()),
        "CODING_SIGNALS_JSON": write_json(tmp / "cannabis-coding-signals.json", coding_signals()),
        "STRAIN_LEXICON_JSON": write_json(tmp / "strain-lexicon.json", strain_lexicon()),
    }


def clean_card():
    body = "Premium quality for your daily ritual.\n\nUse TRY20 today."
    return {
        "product": "flower",
        "rows": [{"row": 1, "avatar": "FCA=Daily Unwind", "funnel": "TOF"}],
        "copy": {
            "headline": "Get 20% Off",
            "hv1": "Limited Time Offer",
            "hv2": "Premium Quality",
            "hv3": "Daily Ritual",
            "hv4": "Ships Fast",
            "primary": body,
            "pv1": body,
            "pv2": body,
            "pv3": body,
            "pv4": body,
        },
        "ad_description": "",
    }


def import_grep(env):
    module = import_from(GREP, "grep_verdict_fail_closed_test")
    module._AUTHORITY = module.verdict_core.load(env)
    return module


def import_copy_gate(env):
    module = import_from(COPY_GATE, "copy_gate_fail_closed_test")
    module._AUTHORITY = module.verdict_core.load(env)
    return module


def import_core():
    return import_from(CORE, "verdict_core_fail_closed_test")


def stub_alerts(module):
    calls = []

    def fake_run(args, timeout=None, check=False):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0)

    module.verdict_core._ALERTED.clear()
    module.verdict_core.subprocess.run = fake_run
    return calls


def test_grep_valid_authorities_allow_clean_pass(tmp):
    g = import_grep(valid_authority_files(tmp))
    assert g.verdict_for({"vision_text": "Plain image"})[0] == "PASS"


def test_grep_missing_brain_hard_forces_unclear_not_reduced_pass(tmp):
    env = valid_authority_files(tmp)
    env["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
    g = import_grep(env)
    stub_alerts(g)
    verdict = g.verdict_for({"vision_text": "Plain image"})[0]
    assert verdict == "UNCLEAR"
    assert g._AUTHORITY.status == "failed"
    assert g._AUTHORITY.authority_class == "core_loss"


def test_grep_absent_version_forces_unclear(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), {"hard": banned_terms()["hard"]})
    g = import_grep(env)
    stub_alerts(g)
    assert g.verdict_for({"vision_text": "Plain image"})[0] == "UNCLEAR"


def test_grep_selective_canary_removal_forces_unclear(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), banned_terms(include_family=False))
    g = import_grep(env)
    stub_alerts(g)
    rec = {"ocr_text": " ".join(["family-grown"] * 44), "vision_text": "", "vo_text": ""}
    assert g.verdict_for(rec)[0] == "UNCLEAR"


def test_grep_strain_below_count_floor_forces_unclear(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["STRAIN_LEXICON_JSON"]), strain_lexicon(count=70))
    g = import_grep(env)
    stub_alerts(g)
    assert g.verdict_for({"vision_text": "Plain image"})[0] == "UNCLEAR"


def test_copy_gate_core_loss_hard_errors(tmp):
    env = valid_authority_files(tmp)
    env["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
    c = import_copy_gate(env)
    stub_alerts(c)
    try:
        c.gate(clean_card())
    except c.GateAuthorityError:
        pass
    else:
        raise AssertionError("core authority loss must hard-error")


def test_copy_gate_decode_component_loss_force_holds(tmp):
    env = valid_authority_files(tmp)
    env["CODING_SIGNALS_JSON"] = str(tmp / "missing-coding.json")
    c = import_copy_gate(env)
    stub_alerts(c)
    problems = c.gate(clean_card())
    assert any(item[1] == "verdict_core_unclear" and "de-code copy scope unavailable" in item[2] for item in problems)


def test_copy_gate_selective_canary_removal_hard_errors(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), banned_terms(include_family=False))
    c = import_copy_gate(env)
    stub_alerts(c)
    try:
        c.gate(clean_card())
    except c.GateAuthorityError:
        pass
    else:
        raise AssertionError("core authority canary loss must hard-error")


def test_copy_gate_absent_version_hard_errors(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), {"hard": banned_terms()["hard"]})
    c = import_copy_gate(env)
    stub_alerts(c)
    try:
        c.gate(clean_card())
    except c.GateAuthorityError:
        pass
    else:
        raise AssertionError("absent version must hard-error")


def test_copy_gate_coding_canary_removal_force_holds(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["CODING_SIGNALS_JSON"]), coding_signals(include_canary=False))
    c = import_copy_gate(env)
    stub_alerts(c)
    problems = c.gate(clean_card())
    assert any(item[1] == "verdict_core_unclear" and "de-code copy scope unavailable" in item[2] for item in problems)


def test_component_loss_preserves_creative_hard_fail(tmp):
    env = valid_authority_files(tmp)
    env["CODING_SIGNALS_JSON"] = str(tmp / "missing-coding.json")
    g = import_grep(env)
    stub_alerts(g)
    hard = g.verdict_for({"vision_text": "", "ocr_text": "FLOWER", "vo_text": ""})
    clean = g.verdict_for({"vision_text": "Plain image", "ocr_text": "", "vo_text": ""})
    assert hard[0] == "FAIL"
    assert clean[0] == "UNCLEAR"
    assert "de-code creative scope unavailable" in clean[1]


def test_component_loss_preserves_creative_candidate_unclear(tmp):
    env = valid_authority_files(tmp)
    env["CODING_SIGNALS_JSON"] = str(tmp / "missing-coding.json")
    g = import_grep(env)
    stub_alerts(g)
    verdict, evidence, fails, unclears = g.verdict_for({
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "Outdoor-grown quality.",
        "vo_text": "",
    })
    assert verdict == "UNCLEAR"
    assert not fails
    assert any("candidate:'grown'" in item for item in unclears)
    assert any("de-code creative scope unavailable" in item for item in unclears)


def test_component_loss_names_strain_scope(tmp):
    env = valid_authority_files(tmp)
    env["STRAIN_LEXICON_JSON"] = str(tmp / "missing-strain.json")
    g = import_grep(env)
    stub_alerts(g)
    verdict, evidence, fails, unclears = g.verdict_for({"vision_text": "Plain image", "ocr_text": "", "vo_text": ""})
    assert verdict == "UNCLEAR"
    assert not fails
    assert any("strain-check creative scope unavailable" in item for item in unclears)


def test_component_loss_preserves_copy_hard_fail(tmp):
    env = valid_authority_files(tmp)
    env["CODING_SIGNALS_JSON"] = str(tmp / "missing-coding.json")
    c = import_copy_gate(env)
    stub_alerts(c)
    card = clean_card()
    card["copy"]["primary"] = "Premium flower for your daily ritual.\n\nUse TRY20 today."
    problems = c.gate(card)
    assert any(item[1] == "verdict_core_fail" and "flower" in item[2] for item in problems)
    assert any(item[1] == "verdict_core_unclear" and "de-code copy scope unavailable" in item[2] for item in problems)


def test_component_loss_preserves_copy_candidate_unclear(tmp):
    env = valid_authority_files(tmp)
    env["CODING_SIGNALS_JSON"] = str(tmp / "missing-coding.json")
    c = import_copy_gate(env)
    stub_alerts(c)
    card = clean_card()
    card["copy"]["primary"] = "Outdoor-grown quality for your daily ritual.\n\nUse TRY20 today."
    problems = c.gate(card)
    assert any(item[1] == "verdict_core_unclear" and "candidate:'grown'" in item[2] for item in problems)
    assert any(item[1] == "verdict_core_unclear" and "de-code copy scope unavailable" in item[2] for item in problems)


def test_copy_gate_hard_error_is_loud(tmp):
    env = valid_authority_files(tmp)
    env["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
    calls = []

    def fake_run(args, timeout=None, check=False):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0)

    c = import_copy_gate(env)
    old_test = os.environ.get("CTX_TEST")
    old_pytest = os.environ.get("PYTEST_CURRENT_TEST")
    old_ci = os.environ.get("CI")
    old_chat = os.environ.get("CTX_TELEGRAM_CHAT_ID")
    try:
        c.verdict_core._ALERTED.clear()
        c.verdict_core.subprocess.run = fake_run
        os.environ.pop("CTX_TEST", None)
        os.environ.pop("PYTEST_CURRENT_TEST", None)
        os.environ.pop("CI", None)
        os.environ["CTX_TELEGRAM_CHAT_ID"] = "123"
        try:
            c.gate(clean_card())
        except c.GateAuthorityError:
            pass
    finally:
        for key, value in (
            ("CTX_TEST", old_test),
            ("PYTEST_CURRENT_TEST", old_pytest),
            ("CI", old_ci),
            ("CTX_TELEGRAM_CHAT_ID", old_chat),
        ):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    flat = [" ".join(call[:5]) for call in calls]
    assert any("notify-agent meta-compliance-agent" in item for item in flat)
    assert any("notify-agent meta-ads-agent" in item for item in flat)
    assert any("log-event error verdict_core_authority_failure" in item for item in flat)
    assert not any("send-telegram" in item for item in flat)


def test_authority_alert_test_context_keeps_log_but_skips_pages(tmp):
    core = import_core()
    authority = core.load({"BANNED_TERMS_JSON": str(tmp / "missing.json")})
    calls = []

    def fake_run(args, timeout=None, check=False):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0)

    old_run = core.subprocess.run
    old_test = os.environ.get("CTX_TEST")
    old_chat = os.environ.get("CTX_TELEGRAM_CHAT_ID")
    try:
        core._ALERTED.clear()
        core.subprocess.run = fake_run
        os.environ["CTX_TEST"] = "1"
        os.environ["CTX_TELEGRAM_CHAT_ID"] = "123"
        verdict = core.classify("plain", authority, surface="copy")
    finally:
        core.subprocess.run = old_run
        if old_test is None:
            os.environ.pop("CTX_TEST", None)
        else:
            os.environ["CTX_TEST"] = old_test
        if old_chat is None:
            os.environ.pop("CTX_TELEGRAM_CHAT_ID", None)
        else:
            os.environ["CTX_TELEGRAM_CHAT_ID"] = old_chat
    assert verdict.must_not_pass
    flat = [" ".join(call[:5]) for call in calls]
    assert any("log-event error verdict_core_authority_failure" in item for item in flat)
    assert not any("notify-agent" in item for item in flat)
    assert not any("send-telegram" in item for item in flat)


def test_authority_alert_ci_alone_stays_loud(tmp):
    core = import_core()
    authority = core.load({"BANNED_TERMS_JSON": str(tmp / "missing.json")})
    calls = []

    def fake_run(args, timeout=None, check=False):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0)

    old_run = core.subprocess.run
    old_test = os.environ.get("CTX_TEST")
    old_pytest = os.environ.get("PYTEST_CURRENT_TEST")
    old_ci = os.environ.get("CI")
    old_chat = os.environ.get("CTX_TELEGRAM_CHAT_ID")
    try:
        core._ALERTED.clear()
        core.subprocess.run = fake_run
        os.environ.pop("CTX_TEST", None)
        os.environ.pop("PYTEST_CURRENT_TEST", None)
        os.environ["CI"] = "1"
        os.environ["CTX_TELEGRAM_CHAT_ID"] = "123"
        verdict = core.classify("plain", authority, surface="copy")
    finally:
        core.subprocess.run = old_run
        for key, value in (
            ("CTX_TEST", old_test),
            ("PYTEST_CURRENT_TEST", old_pytest),
            ("CI", old_ci),
            ("CTX_TELEGRAM_CHAT_ID", old_chat),
        ):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    assert verdict.must_not_pass
    flat = [" ".join(call[:5]) for call in calls]
    assert any("log-event error verdict_core_authority_failure" in item for item in flat)
    assert any("notify-agent meta-compliance-agent" in item for item in flat)
    assert any("notify-agent meta-ads-agent" in item for item in flat)
    assert not any("send-telegram" in item for item in flat)


def test_core_status_first_failed_authority_never_passes(tmp):
    core = import_core()
    class FailedExplosiveAuthority:
        status = "failed"
        authority_class = "core_loss"
        reasons = ["synthetic failure"]

        def __getattr__(self, name):
            if name in {"hard", "claim_surface", "candidate", "decode_copy_re", "decode_creative_re", "strain_re"}:
                raise AssertionError(f"matcher accessed before status gate: {name}")
            raise AttributeError(name)

    authority = FailedExplosiveAuthority()
    calls = []
    old_run = core.subprocess.run
    try:
        core.subprocess.run = lambda args, timeout=None, check=False: calls.append(args) or subprocess.CompletedProcess(args, 0)
        verdict = core.classify("Plain image", authority, surface="copy")
    finally:
        core.subprocess.run = old_run
    assert verdict.must_not_pass
    assert verdict.verdict == "UNCLEAR"
    assert verdict.authority_class == "core_loss"


def test_core_import_is_side_effect_free(tmp):
    old = {
        "BANNED_TERMS_JSON": os.environ.get("BANNED_TERMS_JSON"),
        "CODING_SIGNALS_JSON": os.environ.get("CODING_SIGNALS_JSON"),
        "STRAIN_LEXICON_JSON": os.environ.get("STRAIN_LEXICON_JSON"),
    }
    try:
        os.environ["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
        os.environ["CODING_SIGNALS_JSON"] = str(tmp / "missing-coding.json")
        os.environ["STRAIN_LEXICON_JSON"] = str(tmp / "missing-strain.json")
        err = io.StringIO()
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            core = import_core()
        assert out.getvalue() == ""
        assert err.getvalue() == ""
        assert core.__all__ == ["load", "ensure_brain", "classify"]
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class UnknownAuthority:
    status = "ok"
    authority_class = "mystery"
    reasons = ["synthetic unknown"]


def test_unknown_authority_class_fail_closes_both_frontends(tmp):
    g = import_grep(valid_authority_files(tmp))
    c = import_copy_gate(valid_authority_files(tmp))
    g._AUTHORITY = UnknownAuthority()
    c._AUTHORITY = UnknownAuthority()
    stub_alerts(g)
    stub_alerts(c)
    assert g.verdict_for({"vision_text": "Plain image"})[0] == "UNCLEAR"
    try:
        c.gate(clean_card())
    except c.GateAuthorityError:
        pass
    else:
        raise AssertionError("unknown authority class must hard-error copy gate")


def test_candidate_canary_missing_hard_fails_authority(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), {
        "version": "1.0.11",
        "hard": banned_terms()["hard"],
        "candidate": [{"m_code": "M-19b", "pattern": r"\bproduct\b"}],
    })
    core = import_core()
    authority = core.load(env)
    assert authority.status == "failed"
    assert authority.authority_class == "core_loss"
    assert "candidate canary" in "; ".join(authority.reasons)


def test_creative_candidate_bucket_forces_unclear(tmp):
    g = import_grep(valid_authority_files(tmp))
    verdict, evidence, fails, unclears = g.verdict_for({
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "Outdoor-grown quality.",
        "vo_text": "",
    })
    assert verdict == "UNCLEAR"
    assert not fails
    assert any("candidate" in item for item in unclears)


def test_ensure_brain_cached_valid_past_ttl_proceeds_and_logs_degrade(tmp):
    env = valid_authority_files(tmp)
    core = import_core()
    old = 1000
    for path in env.values():
        os.utime(path, (old, old))
    logs = []
    authority = core.ensure_brain(
        env,
        ttl_seconds=10,
        now=old + 1000,
        clone_fn=lambda: (_ for _ in ()).throw(RuntimeError("clone down")),
        log_fn=logs.append,
    )
    assert authority.status == "ok"
    assert logs and "brain refresh failed" in logs[0]
    assert authority.degradations


def test_ensure_brain_no_valid_clone_hard_class(tmp):
    env = valid_authority_files(tmp)
    env["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
    core = import_core()
    authority = core.ensure_brain(
        env,
        ttl_seconds=10,
        now=2000,
        clone_fn=lambda: (_ for _ in ()).throw(RuntimeError("clone down")),
    )
    assert authority.status == "failed"
    assert authority.authority_class == "core_loss"


def test_copy_gate_hard_preserved_candidate_and_strain_gained(tmp):
    c = import_copy_gate(valid_authority_files(tmp))
    card = clean_card()
    card["copy"]["primary"] = "Premium flower for your daily ritual.\n\nUse TRY20 today."
    assert any(item[1] == "verdict_core_fail" for item in c.gate(card))

    c = import_copy_gate(valid_authority_files(tmp))
    card = clean_card()
    card["copy"]["primary"] = "Outdoor-grown quality for your daily ritual.\n\nUse TRY20 today."
    assert any(item[1] == "verdict_core_unclear" and "candidate" in item[2] for item in c.gate(card))

    c = import_copy_gate(valid_authority_files(tmp))
    card = clean_card()
    card["copy"]["primary"] = "Quiet Moon for your daily ritual.\n\nUse TRY20 today."
    assert any(item[1] == "verdict_core_unclear" and "strain-name" in item[2] for item in c.gate(card))


def run_all():
    tests = [
        test_grep_valid_authorities_allow_clean_pass,
        test_grep_missing_brain_hard_forces_unclear_not_reduced_pass,
        test_grep_absent_version_forces_unclear,
        test_grep_selective_canary_removal_forces_unclear,
        test_grep_strain_below_count_floor_forces_unclear,
        test_copy_gate_core_loss_hard_errors,
        test_copy_gate_decode_component_loss_force_holds,
        test_copy_gate_selective_canary_removal_hard_errors,
        test_copy_gate_absent_version_hard_errors,
        test_copy_gate_coding_canary_removal_force_holds,
        test_component_loss_preserves_creative_hard_fail,
        test_component_loss_preserves_creative_candidate_unclear,
        test_component_loss_names_strain_scope,
        test_component_loss_preserves_copy_hard_fail,
        test_component_loss_preserves_copy_candidate_unclear,
        test_copy_gate_hard_error_is_loud,
        test_authority_alert_test_context_keeps_log_but_skips_pages,
        test_authority_alert_ci_alone_stays_loud,
        test_core_status_first_failed_authority_never_passes,
        test_core_import_is_side_effect_free,
        test_unknown_authority_class_fail_closes_both_frontends,
        test_candidate_canary_missing_hard_fails_authority,
        test_creative_candidate_bucket_forces_unclear,
        test_ensure_brain_cached_valid_past_ttl_proceeds_and_logs_degrade,
        test_ensure_brain_no_valid_clone_hard_class,
        test_copy_gate_hard_preserved_candidate_and_strain_gained,
    ]
    with tempfile.TemporaryDirectory() as td:
        for test in tests:
            test(Path(td) / test.__name__)
    print(f"OK: {len(tests)} fail-closed authority-loader cases pass")


if __name__ == "__main__":
    run_all()
