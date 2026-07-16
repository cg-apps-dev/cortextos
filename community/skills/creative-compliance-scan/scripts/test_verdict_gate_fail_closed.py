"""Fail-closed regression tests for verdict authority loaders.

Run from repo root:
  python3 community/skills/creative-compliance-scan/scripts/test_verdict_gate_fail_closed.py
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
GREP = ROOT / "community/skills/creative-compliance-scan/scripts/grep_verdict.py"
COPY_GATE = ROOT / "agents/meta-ads-agent/meta-ad-copy-agent/references/copy-gate.py"


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
    return {"version": version, "hard": hard}


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


def strain_lexicon(version="1.0.0", count=71):
    return {"version": version, "strains": [f"strain {i}" for i in range(count)]}


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
    return with_env(env, lambda: import_from(GREP, "grep_verdict_fail_closed_test"))


def import_copy_gate(env):
    return with_env(env, lambda: import_from(COPY_GATE, "copy_gate_fail_closed_test"))


def test_grep_valid_authorities_allow_clean_pass(tmp):
    g = import_grep(valid_authority_files(tmp))
    assert g.verdict_for({"vision_text": "Plain product image"})[0] == "PASS"


def test_grep_missing_brain_hard_forces_unclear_not_reduced_pass(tmp):
    env = valid_authority_files(tmp)
    env["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
    g = import_grep(env)
    verdict = g.verdict_for({"vision_text": "Plain product image"})[0]
    assert verdict == "UNCLEAR"
    assert g.AUTHORITY_FORCE_UNCLEAR


def test_grep_absent_version_forces_unclear(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), {"hard": banned_terms()["hard"]})
    g = import_grep(env)
    assert g.verdict_for({"vision_text": "Plain product image"})[0] == "UNCLEAR"


def test_grep_selective_canary_removal_forces_unclear(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), banned_terms(include_family=False))
    g = import_grep(env)
    rec = {"ocr_text": " ".join(["family-grown"] * 44), "vision_text": "", "vo_text": ""}
    assert g.verdict_for(rec)[0] == "UNCLEAR"


def test_grep_strain_below_count_floor_forces_unclear(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["STRAIN_LEXICON_JSON"]), strain_lexicon(count=70))
    g = import_grep(env)
    assert g.verdict_for({"vision_text": "Plain product image"})[0] == "UNCLEAR"


def test_copy_gate_core_loss_hard_errors(tmp):
    env = valid_authority_files(tmp)
    env["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
    c = import_copy_gate(env)
    assert c._GATE_HARD_ERRORS
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
    problems = c.gate(clean_card())
    assert any(item[1] == "authority_degraded_force_unclear" for item in problems)


def test_copy_gate_selective_canary_removal_hard_errors(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), banned_terms(include_family=False))
    c = import_copy_gate(env)
    assert c._GATE_HARD_ERRORS


def test_copy_gate_absent_version_hard_errors(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["BANNED_TERMS_JSON"]), {"hard": banned_terms()["hard"]})
    c = import_copy_gate(env)
    assert c._GATE_HARD_ERRORS


def test_copy_gate_coding_canary_removal_force_holds(tmp):
    env = valid_authority_files(tmp)
    write_json(Path(env["CODING_SIGNALS_JSON"]), coding_signals(include_canary=False))
    c = import_copy_gate(env)
    problems = c.gate(clean_card())
    assert any(item[1] == "authority_degraded_force_unclear" for item in problems)


def test_copy_gate_hard_error_is_loud(tmp):
    env = valid_authority_files(tmp)
    env["BANNED_TERMS_JSON"] = str(tmp / "missing-banned.json")
    calls = []

    def fake_run(args, timeout=None, check=False):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0)

    c = import_copy_gate(env)
    old_run = c.subprocess.run
    old_chat = os.environ.get("CTX_TELEGRAM_CHAT_ID")
    os.environ["CTX_TELEGRAM_CHAT_ID"] = "123"
    try:
        c.subprocess.run = fake_run
        c._fire_operator_alert()
    finally:
        c.subprocess.run = old_run
        if old_chat is None:
            os.environ.pop("CTX_TELEGRAM_CHAT_ID", None)
        else:
            os.environ["CTX_TELEGRAM_CHAT_ID"] = old_chat
    flat = [" ".join(call[:5]) for call in calls]
    assert any("notify-agent meta-compliance-agent" in item for item in flat)
    assert any("log-event error copy_gate_authority_failure" in item for item in flat)
    assert any("send-telegram 123" in item for item in flat)


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
        test_copy_gate_hard_error_is_loud,
    ]
    with tempfile.TemporaryDirectory() as td:
        for test in tests:
            test(Path(td) / test.__name__)
    print(f"OK: {len(tests)} fail-closed authority-loader cases pass")


if __name__ == "__main__":
    run_all()
