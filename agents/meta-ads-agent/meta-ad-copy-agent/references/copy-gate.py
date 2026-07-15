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

# banned-terms.json lives in the meta-compliance-agent (the single compliance source). When this
# gate sits in the brain repo (agents/meta-ads-agent/meta-ad-copy-agent/references/), resolve it
# relative to __file__ (4 dirs up = the agents/ dir). Override with $BANNED_TERMS_JSON; on any load
# failure the embedded LAST_KNOWN_HARD fallback is used. rules.md/banned-terms.json stay the authority.
DEFAULT_BANNED_TERMS_JSON = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "meta-compliance-agent", "data", "banned-terms.json",
)

HEAD = ["headline", "hv1", "hv2", "hv3", "hv4"]
BODY = ["primary", "pv1", "pv2", "pv3", "pv4"]
VALID_FUNNELS = {"TOF", "MOF", "BOF"}
_GATE_DEGRADATIONS = []
_GATE_ALERTED = [False]

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

LAST_KNOWN_HARD = [
    {"m_code": "M-2", "pattern": r"\b(bud|flower|pre-roll|strain|harvest|cannabis|marijuana|weed|thc|thca|cbd|hemp)\b"},
    {"m_code": "M-2", "pattern": r"\bhand[- ]?roll(s|ed|ing|er)?\b"},
    {"m_code": "M-2", "pattern": r"\b(eighth|eighths|gram|grams|nug|nugs|dank|dime bag|dub sack)\b"},
    {"m_code": "M-2", "pattern": r"\b(discreet|discreetly|stealth|vacuum sealed|plain box|plain billing|unmarked)\b"},
    {"m_code": "M-2", "pattern": r"no (smells|labels|logos|giveaways|markings)"},
    {"m_code": "M-2", "pattern": r"nothing on the (box|statement|card)"},
    {"m_code": "M-2", "pattern": r"(generic line item|generic statement)"},
    {"m_code": "M-2", "pattern": r"\b(potency|potent|strong enough|side effects|kicks in)\b"},
    {"m_code": "M-2", "pattern": r"\b(no medical card|no prescription|without a doctor|loophole)\b"},
    {"m_code": "M-2", "pattern": r"\b(federally compliant|farm bill|agriculture act)\b"},
    {"m_code": "M-2", "pattern": r"(certificate of analysis|coa)\b"},
    {"m_code": "M-2", "pattern": r"\b(no pesticides|no sprays)\b"},
    {"m_code": "M-2", "pattern": r"(selling stigma|war on drugs|big pharma|dispensary|dispensaries)"},
    {"m_code": "M-2", "pattern": r"\b(legal|legally|legality|illegal|illegally)\b", "claim_surface_only": True},
    {"m_code": "M-2", "pattern": r"\b(scam|scams|scammy)\b", "claim_surface_only": True},
    {"m_code": "M-2", "pattern": r"\b(package seizure|dea)\b"},
    {"m_code": "M-2", "pattern": r"\b(72|48|24)\s*-?\s*(hour|hr)s?\b"},
    {"m_code": "M-16", "pattern": r"\b\d+\s*-?\s*(hour|hr|hrs|day|days|minute|min)s?\s+(deliver|delivery|shipping|ship)\b|\b(deliver(ed|y|s)?|ship(s|ped|ping)?|arrives?)\b[^.\n]{0,12}\bin\s+\d+\s*(hour|hr|hrs|day|days|minute|min)s?\b"},
    {"m_code": "M-2", "pattern": r"\bmedical\b"},
    {"m_code": "M-19a", "pattern": r"\b(stoned|smoke|smoking|cbn|indica|sativa|ganja|reefer|mary ?jane|blazed|blaze up|get lifted)\b"},
    {"m_code": "M-19a", "pattern": r"\b(delta[ -]?8|delta[ -]?9|delta[ -]?10|hhc|thc[ -]?o|thc[ -]?p|thcp|thcv|tetrahydrocannabinol)\b"},
    {"m_code": "M-19a", "pattern": r"\b(bong|dab rig|rolling papers?|rolling tray|one-hitter|bubbler|spliff)\b"},
    {"m_code": "M-19e", "pattern": "\U0001F33F|\U0001F343|\U0001F4A8|\U0001F6AC|\U0001F48A"},
    {"m_code": "M-24a", "pattern": r"\bclean green\b", "claim_surface_only": True},
    {"m_code": "M-21a", "pattern": r"\b(cocaine|heroin|fentanyl|methamphetamine|oxycodone|oxycontin|percocet|mdma|ecstasy|ketamine|psilocybin|lsd|opioids?)\b"},
    {"m_code": "M-25a", "pattern": r"\bscams?\b|\bscam(med|my)\b|\brip-?offs?\b|\bripped off\b|\bfake[ds]?\b|\bfaking\b|\bfraud(ulent)?\b|\bcounterfeits?\b|\bknock-?offs?\b|\bbogus\b|\bhoax(es)?\b|\bswindle[ds]?\b|\bswindling\b|\billegitimate\b|too good to be true", "claim_surface_only": True},
    {"m_code": "M-16", "pattern": r"you won'?t believe|doctors hate|the truth they don'?t want|big (pharma|sleep|wellness|sleep industry)|shocking|game.?changer|mind.?blowing|works in (minutes|seconds)|knocks you out|guaranteed sleep|instant relief|one weird trick"},
    {"m_code": "M-16", "pattern": r"\b(URGENT|WARNING|DANGER|ALERT)\b|(?<!no )(?<!zero )\brisk\b(?!-? ?free)"},
    {"m_code": "M-16a", "pattern": r"\b\d[\d,]{2,}\+?\s*(customers|reviews|people|subscribers|households|orders|families|users)\b|\b\d[\d,]*\+?\s*(5[- ]?star|five[- ]?star)\b|\b\d(\.\d)?\s*(\u2605|stars?)\b[^.\n]{0,15}(rating|review)"},
    {"m_code": "M-18", "pattern": r"guaranteed results|results guaranteed|guaranteed to (work|help|cure|heal|relieve|fix|solve|stop|improve|reduce|eliminate|make you)|we guarantee you( will|'?ll)"},
    {"m_code": "M-12", "pattern": r"struggl(e|ing|ed) (to|with)|tired of (being|feeling)|are you (anxious|depressed|stressed|overwhelmed|tired|exhausted)|if (you|your).*(diagnosed|suffering|managing)|for (people|those|anyone) (dealing with|managing|struggling|with)[^.\n]*\b(sleep|insomnia|anxiety|stress|pain)\b|can'?t (sleep|fall asleep|stay asleep)"},
    {"m_code": "M-22a", "pattern": r"get rid of your|fix your (ugly|bad|problem|stubborn)|stop being embarrassed|finally (lose|get rid of)|tired of feeling (fat|ugly|old|gross|tired)|the body you deserve|perfect body"},
    {"m_code": "M-5", "pattern": r"\b(no|not|without|zero)\s+(next[- ]?day\s+)?(grog|groggy|grogginess|fog|foggy|haze|hazy|hangover|sluggish|sluggishness|drowsy|drowsiness)\b"},
    {"m_code": "M-13", "pattern": r"wake up (refreshed|rested|clear[- ]?headed|renewed|energized)|wakes? up (refreshed|rested|clear[- ]?headed)|clear[- ]?headed and refreshed"},
]

FIRST_PERSON_RE = re.compile(r"\b(I(?:['\u2019]m|['\u2019]ve|['\u2019]ll|['\u2019]d)?|my|me|mine)\b", re.IGNORECASE)
THIRD_PERSON_HEADLINE_RE = re.compile(r"^\s*(he|she|they)\b|\b(his|her|their)\b", re.IGNORECASE)
PRESS_RE = re.compile(r"\b(CBS|FOX|USA Today|MSNBC|NBC|ABC News)\b", re.IGNORECASE)
# De-code HARD-REMOVE is LIVE-SOURCED from cannabis-coding-signals.json (single source, mc owns it):
# de_code_hard_remove.patterns[].pattern, compiled into DECODE_HARD_RE below. The old hardcoded
# DECODE_SHIP_RE is retired - it under-covered (eligible-states only) and was a second source of
# truth. family-grown is NOT in de_code_hard_remove (it's adam_accepted_risk) so it correctly passes.
# surface_handling.copy = HARD-REMOVE/FAIL -> this gate fails on any hit (must return 0 to pass).
DEFAULT_CODING_SIGNALS_JSON = os.path.join(
    os.path.dirname(DEFAULT_BANNED_TERMS_JSON), "cannabis-coding-signals.json"
)
LAST_KNOWN_DECODE = [
    r"\b(ships?|shipping|available|delivery)\b[^.\n]{0,20}\b(eligible|select|certain|legal)\s+states\b|\beligible states\b|\bstate list\b|\bwhere (it'?s )?legal\b",
    r"\b(lab[- ]?tested|test results|third[- ]?party tested|independently tested|tested before it ships|certificate of analysis|\bcoa\b)\b",
    r"\bfarm[- ]?direct\b",
]
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


def _fire_operator_alert():
    if not _GATE_DEGRADATIONS or _GATE_ALERTED[0]:
        return
    _GATE_ALERTED[0] = True
    msg = (
        "COPY-GATE DEGRADED: "
        + "; ".join(_GATE_DEGRADATIONS)
        + " - running on LAST_KNOWN reduced term-set, verdicts may MISS banned terms. "
        + "FIX the data file + re-run."
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
    path = os.environ.get("BANNED_TERMS_JSON", DEFAULT_BANNED_TERMS_JSON)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        hard = data.get("hard")
        if not isinstance(hard, list):
            raise ValueError("top-level 'hard' is not an array")
        return _compile_hard_terms(hard)
    except Exception as exc:
        _record_degradation(
            f"WARNING: failed to load banned terms from {path}: {exc}; using LAST_KNOWN fallback"
        )
        return _compile_hard_terms(LAST_KNOWN_HARD)


HARD_TERMS = _load_hard_terms()


def _load_decode_hard_remove():
    """Compile de_code_hard_remove.patterns from cannabis-coding-signals.json (single source).

    copy surface = HARD-REMOVE/FAIL (this gate). family-grown is NOT in this set (it is
    adam_accepted_risk), so it passes. On any load failure, fall back to LAST_KNOWN_DECODE.
    """
    path = os.environ.get("CODING_SIGNALS_JSON", DEFAULT_CODING_SIGNALS_JSON)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        pats = [
            p["pattern"]
            for p in data["de_code_hard_remove"]["patterns"]
            if isinstance(p.get("pattern"), str) and p["pattern"]
        ]
        if not pats:
            raise ValueError("de_code_hard_remove.patterns is empty")
    except Exception as exc:
        _record_degradation(
            f"WARNING: failed to load de-code signals from {path}: {exc}; using LAST_KNOWN_DECODE"
        )
        pats = LAST_KNOWN_DECODE
    return re.compile("|".join(f"(?:{p})" for p in pats), re.IGNORECASE)


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
    if _GATE_DEGRADATIONS:
        print(
            "GATE DEGRADED:",
            "; ".join(_GATE_DEGRADATIONS),
            "(running on LAST_KNOWN reduced set - verdicts may MISS terms; FIX the data file)",
        )
    problems = gate(card)
    print("GATE:", "CLEAN" if not problems else f"{len(problems)} HITS")
    for x in problems:
        print(" ", x)
    sys.exit(1 if problems else 0)
