#!/usr/bin/env python3
"""Creative verdict CLI/front-end backed by verdict_core."""
import json
import os
import re
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import verdict_core

_AUTHORITY = None


def _authority():
    global _AUTHORITY
    if _AUTHORITY is None:
        _AUTHORITY = verdict_core.load()
    return _AUTHORITY


def _log_must_not_pass_contradiction(rec):
    """Fire-and-forget log-event for a must_not_pass=True + verdict=PASS core-invariant violation caught on
    the creative surface. NEVER raises (a scan must not break on an audit-log failure). TEST-QUIET by
    default (returns under CTX_TEST/PYTEST) so any test/probe that exercises the contradiction without
    mocking this helper cannot leak a real error-event into the activity feed (the phantom-discipline);
    prod behavior is unchanged (the log-event fires on a real contradiction)."""
    if verdict_core._is_test_context():
        return
    try:
        import subprocess
        subprocess.run(
            ["cortextos", "bus", "log-event", "error", "verdict_core_must_not_pass_pass_contradiction",
             "error", "--meta", json.dumps({"surface": "creative", "row": rec.get("row"),
                                            "fileid": rec.get("fileid")})],
            timeout=10, check=False,
        )
    except Exception:
        pass


def verdict_for(rec):
    verdict = verdict_core.classify(rec, _authority(), surface="creative")
    v = verdict.verdict
    unclears = verdict.unclears
    # must_not_pass INVARIANT, symmetric with copy-gate's must_not_pass-FIRST branch (copy-gate.py L119):
    # the creative surface must NEVER auto-PASS a must_not_pass=True verdict. This surface keys on the
    # verdict STRING, so without this it would leak a must_not_pass verdict as PASS while copy-gate would
    # never-PASS the same one. must_not_pass=True + v=="PASS" is a CORE-INVARIANT VIOLATION (the core always
    # co-sets must_not_pass with UNCLEAR/FAIL and should never emit this) -> force never-PASS (UNCLEAR = the
    # hold/human-review disposition, matching the classify-belt internal_error + authority-degraded
    # precedent; NOT FAIL, which would over-assert an undetected violation) + surface it LOUDLY (a visible
    # note + a log-event); a silent rewrite would HIDE a core bug. Latent-not-live defense-in-depth. General:
    # keys on must_not_pass regardless of the verdict string or authority_class.
    if getattr(verdict, "must_not_pass", False) and v == "PASS":
        v = "UNCLEAR"
        unclears = list(unclears) + [
            "CORE-INVARIANT VIOLATION: must_not_pass=True with verdict=PASS on the creative surface - "
            "forced UNCLEAR (never-PASS); the core should never emit this, investigate verdict_core."
        ]
        _log_must_not_pass_contradiction(rec)
    return v, verdict.evidence, verdict.fails, unclears


def meta_reconcile(v, fails, meta):
    m = (meta or "").upper()
    if v == "PASS" and "DISAPPROV" in m:
        return "FAIL", " | Meta-DISAPPROVED (scan missed) - inspect", True
    if v == "FAIL" and fails and ("ACTIVE" in m or "APPROVED" in m):
        return "FAIL", " | Meta currently ACTIVE - retro-disapproval risk", False
    if v == "FAIL" and not fails and ("ACTIVE" in m or "APPROVED" in m):
        return "UNCLEAR", " | judgment-only call, Meta ACTIVE - human eye", False
    return v, "", False


def apply_leaf_icon_floor(v, ev, rec):
    """M-27 companion (leaf_icon wire-up): leaf_icon was read into the output but consumed nowhere, so a
    leaf-icon creative silently PASSed. A leaf-icon on a would-be-PASS row is a HUMAN vision-adjudication
    call, not a machine verdict: the Clean Green brand leaf-LOGO is EXEMPT (rules.md M-19/M-24 brand-imagery
    exemption) while banned cannabis-leaf ICONOGRAPHY is not, AND leaf-icon is a known vision-hallucination
    surface. So FLOOR a PASS to UNCLEAR (route to vision-adjudicate) - NEVER auto-FAIL, which would
    false-FAIL every branded creative. Only PASS is floored (worst-of: FAIL/UNCLEAR already >= UNCLEAR);
    call this AFTER meta_reconcile so a Meta-DISAPPROVED FAIL is never masked by this UNCLEAR floor."""
    if v == "PASS" and (rec.get("leaf_icon", "no") or "no").lower() == "yes":
        note = ("M-19e leaf-icon present -> UNCLEAR (brand-logo-exempt vs banned-iconography; "
                "vision-adjudicate). leaf_icon=yes.")
        return "UNCLEAR", (ev + " | " + note if ev else note)
    return v, ev


_CARD_NAME_ROUTING = None


def _card_name_routing():
    """M-8b card-name routing patterns - brain-sourced (news-anchor-routing.json), NEVER hardcoded
    (design item 6, locked 2026-10-11 mc msg 1791731592934). Path derives from the SAME brain root as
    BANNED_TERMS_JSON (sibling file in the same data dir), so a fresh-clone pin of BANNED_TERMS_JSON
    carries this file with it - deliberately NO 4th env var (the 2026-08-21 all-or-none partial-pinning
    rule: every new independent env is a new way to split authority across two clones).
    FAIL-CLOSED on absence/unparseable/empty (strain-lexicon 404 precedent): this loader only runs when
    a record actually carries card_name (see apply_card_name_escalator), so post-brain-land a missing
    file here means a stale/wrong clone - raising is the only non-silent option (a silent no-routing
    fallback is the copy-gate silent-degrade false-pass class)."""
    global _CARD_NAME_ROUTING
    if _CARD_NAME_ROUTING is None:
        banned = verdict_core._brain_data_path("BANNED_TERMS_JSON", "banned-terms.json")
        path = os.path.join(os.path.dirname(banned), "news-anchor-routing.json")
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        pats = data.get("card_name_patterns")
        if not isinstance(pats, list) or not pats:
            raise ValueError(f"{path}: card_name_patterns missing/empty - refusing silent no-routing")
        _CARD_NAME_ROUTING = [re.compile(p, re.IGNORECASE) for p in pats]
    return _CARD_NAME_ROUTING


def apply_card_name_escalator(v, ev, rec):
    """M-8b scan-wiring (card-name escalator; design locked 2026-10-11, mc review msg 1791731592934,
    rule half = rules.md 302-310). ROUTING-ONLY sibling of apply_leaf_icon_floor at the shared post-gate
    routing seam (and of the G1 semantic-router when that lands - this deterministic check runs ahead of
    any LLM router by position in the chain): a ClickUp card NAME matching a News-Anchor routing pattern
    floors an otherwise-PASS to UNCLEAR so VISION adjudicates the broadcast-format call. Card NAME is not
    card FORMAT - grep only routes, vision issues any FAIL, so UNCLEAR, never FAIL. Only PASS is floored
    (worst-of: FAIL/UNCLEAR already >= UNCLEAR); runs AFTER meta_reconcile + leaf_icon floor so a
    Meta-DISAPPROVED FAIL is never masked (PASS-only floors commute, order fixed for determinism).
    RECALL BOUNDARY (mandatory at this signal site, design item 5): HIGH-PRECISION / LOW-RECALL -
    catches cards the team LABELED News-Anchor; structurally misses broadcast-FORMAT cards named
    something else and cards whose card_name fetch failed. ADDITIVE PRECISION, not M-8b coverage.
    Full recall = a visual anchor/studio-plate detector in the vision layer (separate piece, out of
    scope here).
    ABSENCE SEMANTICS (design item 4): a record without card_name returns unchanged WITHOUT touching
    the patterns file - old extraction JSONLs re-verify byte-identical to pre-M-8b behavior; the
    routing layer can only ADD a route."""
    name = (rec.get("card_name") or "").strip()
    if not name or v != "PASS":
        return v, ev
    for rx in _card_name_routing():
        if rx.search(name):
            note = ("M-8b card-name routing hit (pattern " + repr(rx.pattern) + " on card_name) -> "
                    "UNCLEAR (routing-only; vision-adjudicate broadcast format - card name is not card "
                    "format). Additive precision, NOT M-8b coverage.")
            return "UNCLEAR", (ev + " | " + note if ev else note)
    return v, ev


# Test compatibility for the modality unit. The implementation remains private in verdict_core.
single_vision_only = verdict_core._single_vision_only


# STRUCTURAL GUARD (not a remembered rule - a remembered rule fired twice in one session and still
# failed under load): a hand-built extraction record can accidentally carry scene-description narration
# inside vision_text/vision_text2/ocr_text/vo_text (e.g. "[on-screen: a product pouch with...]") instead
# of strictly verbatim on-image/spoken text. A generic candidate-tier word inside that narration (e.g.
# "product") then falsely trips the grep - the scanner ends up grading its OWN description, not the ad.
# A real short bracket ad-callout ("[LIMITED TIME]", "[SWIPE UP]", "[9x16]") is 1-4 words; narration is a
# full descriptive sentence, so a >=5-word bracket segment is the discriminator. FAIL LOUD (raise, not a
# printed warning) so this cannot be scrolled past - the exact property a memory-only fix does not have.
_NARRATION_BRACKET_RE = re.compile(r"\[([^\[\]]{1,400})\]")


def _reject_narration(rec):
    for field in ("vision_text", "vision_text2", "ocr_text", "vo_text"):
        text = rec.get(field) or ""
        for m in _NARRATION_BRACKET_RE.finditer(text):
            words = m.group(1).split()
            if len(words) >= 5:
                raise ValueError(
                    f"row {rec.get('row')} field '{field}' looks like scene-description narration, "
                    f"not verbatim on-image/spoken text: {m.group(0)!r} - strip it before re-running. "
                    "verdict_core grades this field literally; narration pollutes the grep."
                )


if __name__ == "__main__":
    ts = sys.argv[2] if len(sys.argv) > 2 else "2026-06-10 PT"
    out = []
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        _reject_narration(rec)
        v, ev, fails, unclears = verdict_for(rec)
        grep_fails = [f for f in fails if not f.startswith("M-19d")]
        v2, note, learn = meta_reconcile(v, grep_fails, rec.get("meta", ""))
        if v2 != v or note:
            ev = ev + note
            v = v2
        # M-27 leaf_icon wire-up: AFTER meta_reconcile (worst-of - never masks a Meta-DISAPPROVED FAIL).
        v, ev = apply_leaf_icon_floor(v, ev, rec)
        # M-8b card-name escalator: last in the PASS-only floor chain (same worst-of property).
        v, ev = apply_card_name_escalator(v, ev, rec)
        cell = f"{v} (creative v2.1 {ts}) - {ev}"
        if rec.get("asset") == "9x16":
            cell += " (9x16)"
        out.append({
            "row": rec["row"],
            "verdict": v,
            "cell": cell,
            "fileid": rec.get("fileid", ""),
            "evidence": ev,
            "meta": rec.get("meta", ""),
            "asset": rec.get("asset", ""),
            "bud_plant": (rec.get("bud_plant", "no") or "no").lower(),
            "leaf_icon": (rec.get("leaf_icon", "no") or "no").lower(),
            "card_name": rec.get("card_name", ""),
            "text_verdict": v,
        })
    json.dump(out, open(sys.argv[1].replace(".jsonl", "_verdicts.json"), "w"), indent=0)
    from collections import Counter

    c = Counter(o["verdict"] for o in out)
    print(f"{len(out)} verdicts:", dict(c))
