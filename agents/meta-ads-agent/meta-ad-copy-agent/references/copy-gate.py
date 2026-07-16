#!/usr/bin/env python3
"""Meta Ad Copy - the ONE deterministic gate (PART 3 of the playbook).

Run over a card's copy BEFORE any sheet write. ANY hit = rewrite that cell, re-gate.
Input: a card dict {product, rows:[(row,avatar)], copy:{headline,hv1..4,primary,pv1..4}, ad_description}.
The de-code/banned term-set is loaded from the meta-compliance-agent banned terms JSON.
"""

import json
import os
import re
import subprocess
import sys

BANNED_TERMS_VERSION_FLOOR = (1, 0, 11)
CODING_SIGNALS_VERSION_FLOOR = (1, 1, 5)
BANNED_TERMS_CANARY = ("bud", "flower", "cannabis", "thc", "family grown")
CODING_SIGNALS_CANARY = ("lab-tested",)
_BRAIN_DATA_ROOT = "/tmp/brain/agents/meta-compliance-agent/data"

HEAD = ["headline", "hv1", "hv2", "hv3", "hv4"]
BODY = ["primary", "pv1", "pv2", "pv3", "pv4"]
VALID_FUNNELS = {"TOF", "MOF", "BOF"}
_GATE_DEGRADATIONS = []
_GATE_HARD_ERRORS = []
_GATE_ALERTED = [False]


class GateAuthorityError(RuntimeError):
    """Raised when a core authority is unavailable and the run must write nothing."""

# Canonical avatar lists (the authority - gog can't read the live dropdown; API doesn't reject invalid).
AVATARS = {
    "flower": {
        "FCA=The Shop Switcher",
        "FCA=The Skeptic 1st Time Online Buyer",
        "FCA=Daily Unwind",
        "FCA=Pain Relief",
        "FCA=Better Sleep",
        "FCA=Subscribe and Save",
        "FCA=The Well Seeker",
        "FCA=BOF/Promo",  # BOF/Promo rollout (Adam 2026-07-15), mirrors resolve_cards AVATAR_MAP
    },
    "gummies": {
        "DSCA=Tried Everything",
        "DSCA=Racing Mind",
        "DSCA=Wellness Stacker",
        "DSCA=Better Mornings",
        "DSCA=BOF/Promo",  # BOF/Promo rollout (Adam 2026-07-15), mirrors resolve_cards AVATAR_MAP
    },
}

FIRST_PERSON_RE = re.compile(r"\b(I(?:['\u2019]m|['\u2019]ve|['\u2019]ll|['\u2019]d)?|my|me|mine)\b", re.IGNORECASE)
THIRD_PERSON_HEADLINE_RE = re.compile(r"^\s*(he|she|they)\b|\b(his|her|their)\b", re.IGNORECASE)
PRESS_RE = re.compile(r"\b(CBS|FOX|USA Today|MSNBC|NBC|ABC News)\b", re.IGNORECASE)
# De-code HARD-REMOVE is LIVE-SOURCED from cannabis-coding-signals.json (single source, mc owns it):
# de_code_hard_remove.patterns[].pattern, compiled into DECODE_HARD_RE below. The old hardcoded
# DECODE_SHIP_RE is retired - it under-covered (eligible-states only) and was a second source of
# truth. family-grown is NOT in de_code_hard_remove (it's adam_accepted_risk) so it correctly passes.
# surface_handling.copy = HARD-REMOVE/FAIL -> this gate fails on any hit (must return 0 to pass).
EM_DASH = "\u2014"
# Offer-CTA recognition (Adam rules 2026-06-22): every body must CLOSE on an offer CTA, and
# >=2 of the 5 headlines must be direct offer-CTA headlines. Tokens kept specific so a bare
# "try"/"save" never matches; no outer \b (a "%"-ending token before a period would fail it).
# Recognized offers: TRY20, Subscribe & Save, a % off / save % discount, AND a free-gift offer
# (🎁 / "free gift" / "free <item> with your/every ...") - free-gift is a playbook §C valid close.
# The (?!to\b) guard after "free" blocks the benign "free TO <verb> ... with your/every" false-PASS
# ("feel free to share it with your friends") while keeping "free <item> with your/every" matching.
_OFFER_CTA = r"TRY\s*20|Subscribe\s*(?:&|and)\s*Save|\d{1,3}\s*%\s*off|save\s+\d{1,3}\s*%|🎁|free\s+gift|free\s+(?!to\b)[\w\s]{0,25}?\bwith\s+(?:your|every)"
BODY_CTA_RE = re.compile(rf"({_OFFER_CTA})", re.IGNORECASE)
HEAD_CTA_RE = re.compile(rf"({_OFFER_CTA}|get\s+\d{{1,3}}\s*%\s*off|Limited\s+Time)", re.IGNORECASE)


def _record_degradation(reason):
    _GATE_DEGRADATIONS.append(reason)
    print(reason, file=sys.stderr)


def _record_hard_error(reason):
    _GATE_HARD_ERRORS.append(reason)
    print(reason, file=sys.stderr)


def _fire_operator_alert():
    reasons = _GATE_HARD_ERRORS + _GATE_DEGRADATIONS
    if not reasons or _GATE_ALERTED[0]:
        return
    _GATE_ALERTED[0] = True
    prefix = "COPY-GATE HARD-ERROR" if _GATE_HARD_ERRORS else "COPY-GATE DEGRADED"
    msg = (
        prefix
        + ": "
        + "; ".join(reasons)
        + " - fail-closed. Restore by re-cloning /tmp/brain or setting BANNED_TERMS_JSON "
        + "and CODING_SIGNALS_JSON to the current meta-compliance data, then re-run."
    )
    # Route to the FIX-OWNER first (meta-compliance-agent owns banned-terms.json +
    # cannabis-coding-signals.json) then the RUNNER (meta-ads, whose in-flight verdicts are
    # degraded). The stdout marker already covers the runner; this wakes the owner who fixes
    # the data. Best-effort per target; never raise (CI/test/no-binary must not crash the gate).
    for _agent in ("meta-compliance-agent", "meta-ads-agent"):
        try:
            subprocess.run(
                ["cortextos", "bus", "notify-agent", _agent, msg],
                timeout=15,
                check=False,
            )
        except Exception:
            pass
    try:
        subprocess.run(
            [
                "cortextos",
                "bus",
                "log-event",
                "error",
                "copy_gate_authority_failure",
                "error",
                "--meta",
                json.dumps({"reasons": reasons}),
            ],
            timeout=15,
            check=False,
        )
    except Exception:
        pass
    chat_id = os.environ.get("CTX_TELEGRAM_CHAT_ID")
    if chat_id:
        try:
            subprocess.run(
                ["cortextos", "bus", "send-telegram", chat_id, msg],
                timeout=15,
                check=False,
            )
        except Exception:
            pass


def _brain_data_path(env_name, filename):
    return os.environ.get(env_name) or os.path.join(_BRAIN_DATA_ROOT, filename)


def _parse_version(value):
    if not isinstance(value, str) or not value.strip():
        return None
    parts = value.strip().split(".")
    parsed = []
    for part in parts:
        if not part.isdigit():
            return None
        parsed.append(int(part))
    return tuple(parsed)


def _version_at_least(value, floor):
    parsed = _parse_version(value)
    if parsed is None:
        return False
    width = max(len(parsed), len(floor))
    return parsed + (0,) * (width - len(parsed)) >= floor + (0,) * (width - len(floor))


def _require_version(data, floor, label):
    version = data.get("version")
    if not _version_at_least(version, floor):
        raise ValueError(f"{label} version {version!r} below floor {'.'.join(map(str, floor))}")


def _assert_banned_canary(compiled):
    missing = [term for term in BANNED_TERMS_CANARY if not any(rx.search(term) for rx in compiled.values())]
    if missing:
        raise ValueError("banned-terms canary missing: " + ", ".join(missing))


def _assert_coding_canary(compiled):
    missing = [term for term in CODING_SIGNALS_CANARY if not compiled.search(term)]
    if missing:
        raise ValueError("coding-signals canary missing: " + ", ".join(missing))


def _compile_hard_terms(entries):
    grouped = {}
    for item in entries:
        m_code = str(item.get("m_code", "")).strip()
        pattern = item.get("pattern")
        if not m_code or not isinstance(pattern, str) or not pattern:
            continue
        grouped.setdefault(m_code, []).append(pattern)

    if not grouped:
        raise ValueError("no usable hard banned-term patterns found")

    return {
        m_code: re.compile("|".join(f"(?:{pattern})" for pattern in patterns), re.IGNORECASE)
        for m_code, patterns in grouped.items()
    }


def _load_hard_terms():
    path = _brain_data_path("BANNED_TERMS_JSON", "banned-terms.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        _require_version(data, BANNED_TERMS_VERSION_FLOOR, "banned-terms")
        hard = data.get("hard")
        if not isinstance(hard, list):
            raise ValueError("top-level 'hard' is not an array")
        compiled = _compile_hard_terms(hard)
        _assert_banned_canary(compiled)
        return compiled
    except Exception as exc:
        _record_hard_error(
            f"failed to load authoritative banned terms from {path}: {exc}"
        )
        return {}


HARD_TERMS = _load_hard_terms()


def _load_decode_hard_remove():
    """Compile de_code_hard_remove.patterns from cannabis-coding-signals.json (single source).

    copy surface = HARD-REMOVE/FAIL (this gate). family-grown is NOT in this set (it is
    adam_accepted_risk), so it passes. On load failure, force-UNCLEAR instead of PASS.
    """
    path = _brain_data_path("CODING_SIGNALS_JSON", "cannabis-coding-signals.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        _require_version(data, CODING_SIGNALS_VERSION_FLOOR, "coding-signals")
        pats = [
            p["pattern"]
            for p in data["de_code_hard_remove"]["patterns"]
            if isinstance(p.get("pattern"), str) and p["pattern"]
        ]
        if not pats:
            raise ValueError("de_code_hard_remove.patterns is empty")
        compiled = re.compile("|".join(f"(?:{p})" for p in pats), re.IGNORECASE)
        _assert_coding_canary(compiled)
        return compiled
    except Exception as exc:
        _record_degradation(
            f"failed to load de-code signals from {path}: {exc}; force-UNCLEAR for all rows"
        )
        return None


DECODE_HARD_RE = _load_decode_hard_remove()


def _strip_quoted(text):
    """Remove quoted/parenthetical text so bare narration checks only test unquoted copy."""
    t = re.sub(r'"[^"]*"', " ", text)
    t = re.sub("\u201c[^\u201d]*\u201d", " ", t)
    t = re.sub("\u2018[^\u2019]*\u2019", " ", t)
    t = re.sub(r"\([^)]*\)", " ", t)
    return t


def _as_text(value):
    return "" if value is None else str(value)


def _first5(text):
    stripped = _strip_quoted(text)
    return " ".join(re.sub(r"[^\w\s]", " ", stripped).lower().split()[:5])


def _iter_rows(rows):
    for item in rows:
        if isinstance(item, dict):
            yield item.get("row", "?"), item.get("avatar", ""), item.get("funnel")
        else:
            row = item[0] if len(item) > 0 else "?"
            avatar = item[1] if len(item) > 1 else ""
            funnel = item[2] if len(item) > 2 else None
            yield row, avatar, funnel


def _valid_funnel(value):
    return value is None or str(value).strip() == "" or str(value).strip().upper() in VALID_FUNNELS


def gate(card):
    if _GATE_HARD_ERRORS:
        raise GateAuthorityError("; ".join(_GATE_HARD_ERRORS))
    p = []
    prod = card["product"]
    copy = card["copy"]
    cells = {k: _as_text(v) for k, v in dict(copy).items()}
    cells["ad_description"] = _as_text(card.get("ad_description", ""))

    for f, t in cells.items():
        for m_code, pattern in HARD_TERMS.items():
            if m_code == "M-13" and prod != "gummies":
                continue
            m = pattern.search(t)
            if m:
                p.append((f, m_code, m.group(0)))

        if DECODE_HARD_RE is None:
            p.append((f, "authority_degraded_force_unclear", "; ".join(_GATE_DEGRADATIONS)))
        else:
            m = DECODE_HARD_RE.search(t)
            if m:
                p.append((f, "decode_hard_remove", m.group(0)))

        m = PRESS_RE.search(t)
        if m:
            p.append((f, "press", m.group(0)))

        if EM_DASH in t:
            p.append((f, "em_dash", EM_DASH))

        bare = _strip_quoted(t)
        if FIRST_PERSON_RE.search(bare):
            p.append((f, "BARE_FIRST_PERSON (wrap testimonial in quotes/parens or reframe to you)"))

    # Headlines.
    for hk in HEAD:
        h = _as_text(copy[hk])
        if "\n" in h:
            p.append((hk, "headline_has_newline"))
        if len(h) > 40:
            p.append((hk, f"headline_len_{len(h)}"))
        if THIRD_PERSON_HEADLINE_RE.search(h):
            p.append((hk, "third_person_character_headline"))
        if re.search(r"^\s*(tired of|sick of|done with|fed up with|can.?t sleep)\b", h, re.IGNORECASE):
            p.append((hk, "M12_diagnostic_question"))
        if re.search(r"\bsleep gummies\b", h, re.IGNORECASE):
            p.append((hk, "NEVER_Sleep_Gummies (implied M-13) -> use 'wind-down gummies'/'DeepSleep Gummies'"))

    # No two headlines / bodies share their first 5 words.
    for grp, keys in (("headlines", HEAD), ("bodies", BODY)):
        seen = {}
        for k in keys:
            f5 = _first5(_as_text(copy[k]))
            if f5 and f5 in seen:
                p.append((k, f"shares_first5_words_with_{seen[f5]}: '{f5}'"))
            else:
                seen[f5] = k

    # Dramatic ellipsis outside a quote (allowed only inside "...", curly quotes, or (...)).
    for f, t in cells.items():
        if re.search(r"(\.\.\.|\u2026)", _strip_quoted(t)):
            p.append((f, "dramatic_ellipsis_outside_quote"))

    # Bodies: paragraph format and third-person narration.
    for bk in BODY:
        b = _as_text(copy[bk])
        if "\n" in b and "\n\n" not in b:
            p.append((bk, "single_newline_only_FORMAT"))
        if "\n\n\n" in b:
            p.append((bk, "triple_newline"))

        bare = _strip_quoted(b)
        # Third-person narration about a specific person (named character) in the body:
        # flag singular he/she/his/her OUTSIDE quotes (catches "Robert built it into his
        # wind-down" via "his"). Does NOT flag second-person you, brand we/our, or generic
        # they/their about customers-in-general - only a specific person's voice.
        m = re.search(r"\b(he|she|his|her)\b", bare, re.IGNORECASE)
        if m:
            p.append((bk, "THIRD_PERSON_BODY (use you/brand voice or quote the testimonial)", m.group(0)))

    # Offer-CTA presence (Adam rules 2026-06-22, option 2 / LEARN_MORE exception):
    #   (1) every body must CLOSE on a recognized offer CTA, and
    #   (2) >=2 of the 5 headlines must be direct offer-CTA headlines.
    # EXEMPTION: LEARN_MORE / advertorial rows use a curiosity/soft close + curiosity headlines
    # (the offer lives on the landing page), so BOTH checks are SKIPPED only when the row's CTA
    # button == LEARN_MORE. FAIL-SAFE: default is ENFORCE - missing / unknown / SHOP_NOW / any
    # other CTA -> both checks apply (never let a no-offer close slip via an absent cta field).
    # The cta comes from the sheet "CTA" column (card["cta"] or per-row rows[].cta), set at gen time.
    _cta = card.get("cta")
    if not _cta:
        for _r in card.get("rows", []):
            if isinstance(_r, dict) and _r.get("cta"):
                _cta = _r["cta"]
                break
    is_learn_more = bool(re.fullmatch(r"\s*learn[\s_-]*more\s*", str(_cta or ""), re.IGNORECASE))
    if not is_learn_more:
        # (1) body must CLOSE on an offer CTA (copywriters varied closes + dropped the CTA on ~1/3).
        for bk in BODY:
            paras = [x.strip() for x in _as_text(copy[bk]).split("\n\n") if x.strip()]
            last = paras[-1] if paras else ""
            if not BODY_CTA_RE.search(last):
                p.append((bk, "missing_offer_CTA_close (end the body with an offer CTA: TRY20 / Subscribe & Save / % off / free-gift)"))

        # (2) >=2 direct offer-CTA headlines per card.
        n_cta_heads = sum(1 for hk in HEAD if HEAD_CTA_RE.search(_as_text(copy[hk])))
        if n_cta_heads < 2:
            p.append(("headlines", f"need >=2 direct offer-CTA headlines (TRY20 / % off / Limited Time / Subscribe & Save / free-gift); found {n_cta_heads}"))

    # Avatars and optional funnel values.
    allow = AVATARS.get(prod, set())
    for row, av, funnel in _iter_rows(card.get("rows", [])):
        if av not in allow:
            p.append((f"row{row}", f"avatar_invalid:{av}"))
        if not _valid_funnel(funnel):
            p.append((f"row{row}", f"funnel_invalid:{funnel}"))

    for key in ("funnel", "funnel_stage"):
        if key in card and not _valid_funnel(card.get(key)):
            p.append((key, f"funnel_invalid:{card.get(key)}"))

    return p


if __name__ == "__main__":
    card = json.load(open(sys.argv[1], encoding="utf-8")) if len(sys.argv) > 1 else json.load(sys.stdin)
    # Surface a degraded term-set BEFORE running the gate: the degradation is known at
    # import (the loaders populated _GATE_DEGRADATIONS), and gate() may raise on a malformed
    # card - the operator must be alerted to a degraded gate regardless.
    _fire_operator_alert()
    if _GATE_HARD_ERRORS:
        print(
            "GATE HARD-ERROR:",
            "; ".join(_GATE_HARD_ERRORS),
            "(write nothing; restore /tmp/brain or authoritative env paths and re-run)",
            file=sys.stderr,
        )
        sys.exit(2)
    if _GATE_DEGRADATIONS:
        print(
            "GATE DEGRADED:",
            "; ".join(_GATE_DEGRADATIONS),
            "(force-UNCLEAR; restore /tmp/brain or authoritative env paths and re-run)",
        )
    try:
        problems = gate(card)
    except GateAuthorityError as exc:
        print(f"GATE HARD-ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
    print("GATE:", "CLEAN" if not problems else f"{len(problems)} HITS")
    for x in problems:
        print(" ", x)
    sys.exit(1 if problems else 0)
