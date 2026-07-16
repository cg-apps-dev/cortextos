#!/usr/bin/env python3
"""Meta Ad Copy - the ONE deterministic gate (PART 3 of the playbook).

Run over a card's copy BEFORE any sheet write. ANY hit = rewrite that cell, re-gate.
Input: a card dict {product, rows:[(row,avatar)], copy:{headline,hv1..4,primary,pv1..4}, ad_description}.
The de-code/banned term-set is loaded from the meta-compliance-agent banned terms JSON.
"""

import json
import os
import re
import sys
from pathlib import Path

_CORE_DIR = Path(__file__).resolve().parents[4] / "community/skills/creative-compliance-scan/scripts"
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))
import verdict_core

HEAD = ["headline", "hv1", "hv2", "hv3", "hv4"]
BODY = ["primary", "pv1", "pv2", "pv3", "pv4"]
VALID_FUNNELS = {"TOF", "MOF", "BOF"}
_AUTHORITY = None


class GateAuthorityError(RuntimeError):
    """Raised when a core authority is unavailable and the run must write nothing."""


def _authority():
    global _AUTHORITY
    if _AUTHORITY is None:
        _AUTHORITY = verdict_core.ensure_brain()
    return _AUTHORITY

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
    authority = _authority()
    authority_probe = verdict_core.classify("", authority, surface="copy")
    if authority_probe.must_not_pass:
        if authority_probe.authority_class != "component_loss":
            raise GateAuthorityError(authority_probe.evidence)
    prod = card["product"]
    copy = card["copy"]
    cells = {k: _as_text(v) for k, v in dict(copy).items()}
    cells["ad_description"] = _as_text(card.get("ad_description", ""))

    for f, t in cells.items():
        verdict = verdict_core.classify(t, authority, surface="copy")
        if verdict.must_not_pass:
            if verdict.authority_class == "component_loss":
                for item in verdict.unclears or [verdict.evidence]:
                    p.append((f, "verdict_core_unclear", item))
            else:
                raise GateAuthorityError(verdict.evidence)
        elif verdict.verdict == "FAIL":
            for item in verdict.fails:
                if item.startswith("M-13") and prod != "gummies":
                    continue
                p.append((f, "verdict_core_fail", item))
        elif verdict.verdict == "UNCLEAR":
            for item in verdict.unclears:
                p.append((f, "verdict_core_unclear", item))

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
    try:
        problems = gate(card)
    except GateAuthorityError as exc:
        print(f"GATE HARD-ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
    print("GATE:", "CLEAN" if not problems else f"{len(problems)} HITS")
    for x in problems:
        print(" ", x)
    sys.exit(1 if problems else 0)
