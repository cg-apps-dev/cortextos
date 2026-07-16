#!/usr/bin/env python3
"""Deterministic verdict engine for creative-compliance-scan v2.1 (2026-06-10).
v2.1 fixes three audited defects of v2:
 (1) DIGIT FALSE-PASS: v2 leet-normalized (0->o,4->a,...) BEFORE matching, corrupting every
     digit pattern ("420"->"a2o", "60,000+ customers"->"6o,ooo+ customers"). v2.1 matches
     digit-bearing patterns on RAW lowered text; leet stays for alpha-only de-obfuscation.
 (2) VISION-ONLY FALSE-FAIL: v2 FAILed on product words leaked from vision DESCRIPTIONS
     (category word "flower" on clean offer cards, rows 786-793; later "pre-roll" on IMG_697).
     v2.1 requires CORROBORATION for hard creative hits sourced only from a single vision pass:
     OCR/VO or >=2 independent sources FAIL; single vision-only hit -> UNCLEAR (human eye), never FAIL.
     Extraction prompts must demand VERBATIM on-image text only - a category word in a
     description is the scanner talking, not the ad.
 (3) DELIVERY-TIME OVER-BLOCK: plain shipping timeframes are NOT banned (brain rules.md M-3
     approved substitute: "If we ship to your state, it is at your door in under 72 hours").
     v2 'M-2 delivery-time' class REMOVED. M-16 quantified OUTCOME timing stays banned
     (asleep in 10 minutes / 8 hours guaranteed / results in N days).
 Also adds the word-gap classes confirmed banned in live rules.md: farm bill (M-2 legality,
 rules.md:88), lab-tested/third-party tested (M-2/M-7, rules.md:675,696), no chemicals.

Extraction record fields:
  row, fileid, asset, product ("flower"|"gummies"), meta,
  vision_text, [vision_text2 optional], ocr_text, vo_text, bud_plant, leaf_icon, low_conf
"""
import json, os, re, shutil, subprocess, sys, time

_LEET = str.maketrans({'0':'o','1':'i','3':'e','4':'a','5':'s','@':'a','$':'s'})
_BANNED_TERMS_VERSION_FLOOR = (1, 0, 11)
_CODING_SIGNALS_VERSION_FLOOR = (1, 1, 5)
_STRAIN_VERSION_FLOOR = (1, 0, 0)
_STRAIN_COUNT_FLOOR = 71
_BANNED_TERMS_CANARY = ("bud", "flower", "cannabis", "thc", "family grown")
_CODING_SIGNALS_CANARY = ("lab-tested",)
_CANDIDATE_CANARY = ("grown",)
_BRAIN_DATA_ROOT = "/tmp/brain/agents/meta-compliance-agent/data"
_AUTHORITY_FORCE_UNCLEAR = []
_ALERTED = set()
_EMPTY_RE = re.compile(r"a^")
__all__ = ["load", "ensure_brain", "classify"]

class _Authority:
    def __init__(
        self,
        status="ok",
        authority_class="ok",
        reasons=None,
        hard=None,
        claim_surface=None,
        candidate=None,
        decode_copy_re=None,
        decode_creative_re=None,
        strain_terms=None,
        degradations=None,
        failed_components=None,
    ):
        self.status = status
        self.authority_class = authority_class
        self.reasons = reasons or []
        self.hard = hard or []
        self.claim_surface = claim_surface or []
        self.candidate = candidate or []
        self.decode_copy_re = decode_copy_re or _EMPTY_RE
        self.decode_creative_re = decode_creative_re or _EMPTY_RE
        self.strain_terms = strain_terms or []
        self.strain_re = _compile_strain_re(self.strain_terms)
        self.degradations = degradations or []
        self.failed_components = failed_components or []


class _Verdict:
    def __init__(
        self,
        verdict="PASS",
        evidence="clean",
        fails=None,
        unclears=None,
        candidate_hits=None,
        authority_class="ok",
        must_not_pass=False,
    ):
        self.verdict = verdict
        self.evidence = evidence
        self.fails = fails or []
        self.unclears = unclears or []
        self.candidate_hits = candidate_hits or []
        self.authority_class = authority_class
        self.must_not_pass = must_not_pass
        self.tier_outcome = "FAIL" if verdict == "FAIL" else "UNCLEAR" if verdict == "UNCLEAR" else "PASS"

def _brain_data_path(env_name, filename, env=None):
    source = env if env is not None else os.environ
    return source.get(env_name) or os.path.join(_BRAIN_DATA_ROOT, filename)

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

def _leet_norm(text):
    return (text or "").lower().translate(_LEET)

def _raw_norm(text):
    return (text or "").lower()

def _flat(t): return re.sub(r'[ \t]+',' ',t)

def _letterspace_collapse_words(line):
    toks = re.split(r'[\s]+', line)
    words = []; run = []
    for tk in toks:
        core = re.sub(r'[^a-z0-9]', '', tk)
        if len(core) == 1:
            run.append(core)
        else:
            if run: words.append(''.join(run)); run = []
            if core: words.append(core)
    if run: words.append(''.join(run))
    return words

# ---- ALPHA hard bans: matched on _LEET-normalized text (de-obfuscation wanted) ----
_HARD_ALPHA = [
 ("M-2 bud/flower", re.compile(r'\b(buds?|flowers?|cannabis|marijuana|weed|thca?|cbd|ganja|reefer|nugs?|dank)\b')),
 ("M-2 hemp", re.compile(r'\bhemp\b')),
 ("M-2 preroll/handroll", re.compile(r'\b(pre[- ]?rolls?|hands?[- ]?roll(s|ed|ing|er)?)\b')),
 ("M-2 strain", re.compile(r'\bstrains?\b')),
 ("M-2 dispensary", re.compile(r'\bdispensar(y|ies)\b')),
 # bare "legal" included (banned-terms.json M-2 hard-bans \blegal\b); de-code framings ("where it's
 # legal" / "legal states") are MASKED before this grep, so bare-legal only fires on a standalone claim.
 # "dea" dropped 2026-07-13: fragile 3-letter token that false-fired on OCR/whisper noise (retro FP on "real deal") for negligible signal; "package seizure" kept. Paired with brain PR #216 banned-terms M-2 dea-drop.
 ("M-2 legality", re.compile(r'\b(illegal(ly)?|legal(ly|ity)?|federally compliant|farm bill|agriculture act|package seizure)\b')),
 ("M-2 no-medical-card", re.compile(r'no medical card')),
 ("M-2 plain-box/mail", re.compile(r'plain (box|mail|packaging|billing)')),
 ("M-2 discreet", re.compile(r'\bdiscree?t(ly)?\b')),
 ("M-2 medical(bare)", re.compile(r'\bmedical\b')),
 ("M-19f eligible-states", re.compile(r"\b(ships?|shipping|available|delivery|delivers?|delivered|sold|sells?|buy|buys|order(s|ing)?|gets?|purchas\w+)\b[^.\n]{0,20}\b(eligible|select|certain|participating|approved|qualifying|permitted|legal)\s+states\b|\beligible states\b|\bstate list\b|\bwhere (it'?s )?(legal|permitted|allowed|available)\b")),
 # lab-tested/3rd-party/COA MOVED to de-code UNCLEAR set (surface_handling.creative, #154 2026-06-22):
 # on-CREATIVE de-code = UNCLEAR-for-Adam-review, NOT hard-FAIL. "no chemicals" is M-2 (not de-code) -> stays HARD.
 ("M-2 no-chemicals", re.compile(r'no chemicals')),
 ("M-25 scam/fake", re.compile(r'\b(scam(med|my)?|rip[- ]?off|ripped off|fakes?|faking|faked|fraud(ulent)?|counterfeit|knock[- ]?off|bogus|hoax|swindle[ds]?|swindling|illegitimate)\b|too good to be true')),
 # mc banked ruling (video batch 2026-06-10, flower 833 2026-06-11): clear-morning class = M-5 side-effect-absence claim
 ("M-5 morning-clarity", re.compile(r'mornings? (are|were|feel) clear|clear mornings?|clear[- ]headed (morning|day)|wake up clear')),
]
# ---- DIGIT hard bans: matched on RAW lowered text (leet would corrupt them) ----
_HARD_DIGIT = [
 ("M-2 4/20", re.compile(r'\b4\s*[:/]\s*20\b|\b420\b')),
 ("M-16 outcome-timing", re.compile(r'asleep in \d+\s*min|knocked? (you |me )?out in \d|results? in \d+\s*days?')),
 # Adam HARD ban 2026-06-10 (rejection-proven, flower 522-524): ANY quantified delivery-time promise
 ("M-2 delivery-time-guarantee", re.compile(r'deliver\w*\s+in\s+\d+\s*(hours?|days?)|\d+[- ]?(hour|day)[- ]?(delivery|shipping)|\b(24|48|72)[- ]?hours?\b')),
 # M-16a (rules.md 2026-06-11, rejection-proven): ANY specific count tied to a social-proof noun = HARD,
 # any surface incl on-image. Standalone ratings ("4.8 stars") stay PASS; "thousands of" is the APPROVED form.
 # 2026-07-03 (mc-aligned to canonical): (1) 3+-digit FLOOR \d[\d,]{2,} - a real CG count is always 3+ digits
 # (62,719 / 8,249 / 1000), a testimonial byline AGE ("Maya, 31, Brooklyn") is 2 = never a count. (2) same-line
 # adjacency [^\S\n]* not \s* between number and count-noun - a real count keeps them adjacent; blocks a span
 # across a paragraph break into a distant CTA ("31, Brooklyn\n\nOrder Today"). Mirrors mc's staged canonical fix.
 ("M-16a social-proof-count", re.compile(r'(?<![\$])\b\d[\d,]{2,}[^\S\n]*\+?[^\S\n]*(?:\w+[^\S\n]+)?(customers?|reviews?|subscribers?|households?|people|orders?|families|sleepers?|users?|five[- ]star)\b|\b\d+k\+?[^\S\n]*(customers?|reviews?|subscribers?|people)\b|\b\d(\.\d)?[^\S\n]*stars?[^\S\n]+from[^\S\n]+\d')),
]
_SHIPCTX = re.compile(r'\b(ship|shipped|shipping|deliver|delivered|delivery|arrive|arrives|arrival|doorstep|door|mail|mailed)\b')
_SINGLE_TOKEN_BANS = {
 'bud','buds','flower','flowers','cannabis','marijuana','weed','thc','thca','cbd',
 'hemp','strain','strains','dispensary','nug','nugs','dank','ganja','reefer','medical','discreet'
}
_SINGLE_TOKEN_LABEL = {w:('M-2 '+w) for w in _SINGLE_TOKEN_BANS}

# ---- AMBIGUOUS (UNCLEAR): alpha on leet, digit on raw ----
_AMBIG_ALPHA = [
 ("M-4 health/relief", re.compile(r'\b(relief|cures?|cured|treats?|treatment|anxiety|insomnia|stress|pain)\b|feel like yourself|feel the difference')),
 ("M-8 press", re.compile(r'\b(cbs|fox|usa today|msnbc|nbc|abc|forbes)\b|as seen (on|in)|as featured')),
 ("M-20 comparison", re.compile(r'better than|better\s+\w+\s+than|stronger than|more potent|not weak|not gas station|higher.?quality than|quality than|than (the|my|any|anything|what|i|your)\b.{0,18}\b(getting|got|had|used|tried|before|old|local|shop|dispensar)')),
]
_AMBIG_DIGIT = [
 # (M-6 social-proof# count class moved to _HARD_DIGIT as M-16a 2026-06-11; standalone star ratings and
 #  "thousands of" are explicitly APPROVED per rules.md M-16a and are no longer flagged)
]
_GUM_HARD_ALPHA = [
 ("M-13 sleep-onset", re.compile(r'fall asleep|asleep all night|sleep through the night|slept through the night|drift off|wake up rested|stay asleep|stayed asleep|natural sleep aid|non[- ]?habit[- ]?forming')),
 ("M-12 diagnostic-Q", re.compile(r"can'?t sleep\??|still awake\??|trouble sleeping\??|can'?t shut off")),
 ("M-5 side-effect", re.compile(r'no grogginess|no morning fog|without grog|zero grog|morning fog|\bgrog\b|grogginess')),
]
_GUM_HARD_DIGIT = [
 ("M-13 sleep-onset#", re.compile(r'out by \d+|asleep by \d+|\b8 hours\b')),
]
_GUM_AMBIG_ALPHA = [
 ("M-13? melatonin mention", re.compile(r'(?<!no )(?<!no-)(?<!free )(?<!without )(?<!zero )melatonin\b(?![ -]?free)')),
]

_BRAIN_HARD = []
_BRAIN_CLAIM_SURFACE = []
_BRAIN_CANDIDATE = []

_DECODE_CREATIVE_RE = _EMPTY_RE

def _phrase_re(phrase):
    parts = [re.escape(p) for p in re.split(r'\s+', phrase.strip()) if p]
    return r'(?<![a-z0-9])' + r'[\s-]+'.join(parts) + r'(?![a-z0-9])'

_STRAIN_TERMS = []
_STRAIN_RE = _EMPTY_RE
_STRAIN_CORROBORATOR_RE = re.compile(
    r'\b(thc|thca|cbd|cannabinoids?|cannabis|marijuana|weed|hemp|flower|buds?|nugs?|'
    r'dispensar(y|ies)|strains?|coa|certificate of analysis|lab[- ]?tested|third[- ]?party tested|'
    r'farm bill|agriculture act|discree?t(ly)?|plain (box|mail|packaging|billing))\b',
    re.IGNORECASE,
)

def _find_all(text, pats):
    hits=[]
    for label, rx in pats:
        for m in rx.finditer(text):
            # $-price guard for social-proof ("orders over $99")
            if label in ("M-6 social-proof#", "M-16a social-proof-count"):
                s=max(0,m.start()-12)
                if re.search(r'over \$|\$\d', text[s:m.end()+3]): continue
            hits.append((label, m.group(0)))
    return hits

def _single_vision_only(names):
    """A hard hit is uncorroborated (-> UNCLEAR, human review) IFF EVERY source it hit is the VISION
    modality (native-vision LLM read). Vision is GENERATIVE + hallucination-prone (an LLM describing an
    image can invent a term), and a hallucination recurs across passes, so N vision passes are the SAME
    modality = NOT independent corroboration (IMG_697 "pre-rolls" landed in vision_text AND vision_text2,
    which the earlier name-count fix wrongly FAILed). Corroboration = >=1 NON-vision modality (OCR reads
    pixels / VO reads audio - non-generative, SELF-TRUSTING; a SINGLE ocr/vo hit -> FAIL, asymmetric per
    mc rule #219/#220) or legible-confirm. MODALITY-TAGGED by the "vision" name-prefix, NOT a source-NAME
    count/set: a future vision3 pass auto-maps to the vision modality with zero code-edit, so the bug
    cannot recur on an added pass (both the name-count bug and the vision3-recurrence closed by
    construction). Empty names -> fail-closed FAIL (all([]) is True, so the guard is explicit)."""
    if not names:
        return False
    return all(name.startswith("vision") for name in names)

def _creative_verdict_for(rec):
    product = rec.get("product","flower")
    vis  = rec.get("vision_text","") or ""
    vis2 = rec.get("vision_text2","") or ""
    ocr  = rec.get("ocr_text","") or ""
    vo   = rec.get("vo_text","") or ""
    if "DOWNLOAD_FAIL" in vis or vis.strip().upper().startswith("SCAN ERROR"):
        return "SCAN ERROR", "1x1 inaccessible (404/expired) - needs re-share", [], []
    sources = {"vision": vis, "vision2": vis2, "ocr": ocr, "vo": vo}
    corpus = "\n".join(sources.values())
    union_raw_l  = _flat(_raw_norm(corpus))
    union_leet_l = _flat(_leet_norm(corpus))
    union_raw_full_l = union_raw_l

    # DE-CODE on-creative (surface_handling.creative #154) -> UNCLEAR-for-Adam-review, SPAN-LOCAL.
    # Capture the de-code phrases, then MASK their spans (blank them) OUT of the text BEFORE the hard
    # grep. This way a de-code phrase cannot trip a broader HARD rule (e.g. M-2 legality "legal" living
    # inside "where it's legal"), yet a STANDALONE hard claim - cannabis noun, Agriculture Act legality,
    # enforcement, or a SEPARATE "100% legal" - sits OUTSIDE every de-code span, survives the mask, and
    # correctly FAILs. The suppression is span-local (overlap-only), NOT row-scoped: only the de-code
    # span itself becomes UNCLEAR; co-occurring standalone hard violations still FAIL the row.
    decode_hits = [m.group(0) for m in _DECODE_CREATIVE_RE.finditer(union_raw_l)]
    _blank = lambda m: " " * len(m.group(0))
    union_raw_l  = _DECODE_CREATIVE_RE.sub(_blank, union_raw_l)
    union_leet_l = _DECODE_CREATIVE_RE.sub(_blank, union_leet_l)

    fails=[]; unclears=[]; vision_adjudicate=[]

    masked_sources_raw = {k: _flat(_raw_norm(_DECODE_CREATIVE_RE.sub(_blank, v))) for k, v in sources.items()}
    masked_sources_leet = {k: _flat(_DECODE_CREATIVE_RE.sub(_blank, _leet_norm(v))) for k, v in sources.items()}

    def hit_sources(rx, source_texts):
        return [name for name, text in source_texts.items() if text and rx.search(text)]

    # _single_vision_only is a module-level pure function (importable + unit-testable, incl. vision3-injection)

    def add_hard_hit(label, val, names):
        if _single_vision_only(names):
            unclears.append(f"{label}(single-vision, uncorroborated):'{val}' - verify on image")
        else:
            fails.append(f"{label}:'{val}'")

    seen=set()
    for label, rx in _HARD_ALPHA:
        for m in rx.finditer(union_leet_l):
            val = m.group(0)
            names = hit_sources(rx, masked_sources_leet)
            add_hard_hit(label, val, names)
            base = re.sub(r'[^a-z]','',val.split()[0]) if val else ''
            tok = val.strip().lower()
            if tok in _SINGLE_TOKEN_BANS or base in _SINGLE_TOKEN_BANS:
                w = tok if tok in _SINGLE_TOKEN_BANS else base
                seen.add(w)
    for label, rx in _HARD_DIGIT:
        for m in rx.finditer(union_raw_l):
            val = m.group(0)
            names = hit_sources(rx, masked_sources_raw)
            if _single_vision_only(names):
                unclears.append(f"{label}(single-vision, uncorroborated):'{val}' - verify on image")
                continue
            if label=="M-2 delivery-time-guarantee" and re.fullmatch(r'(24|48|72)[- ]?hours?', val.strip()):
                # bare hours number: HARD only with a ship/deliver word in the text (else it could be product info)
                if not _SHIPCTX.search(union_raw_l):
                    unclears.append(f"{label}(no ship context):'{val}' - verify"); continue
            fails.append(f"{label}:'{val}'")

    # brain-derived hard[] union pass (raw lowered text; dedup vs already-failed values)
    already = {f.split(":'",1)[1].rstrip("'") for f in fails if ":'" in f}
    for label, rx in _BRAIN_HARD:
        for m in rx.finditer(union_raw_l):
            val = m.group(0)
            if val in already: continue
            already.add(val)
            names = hit_sources(rx, masked_sources_raw)
            add_hard_hit(label, val, names)

    # candidate[] is a universal hold tier. It never passes silently and never hard-FAILs without
    # meta-compliance context; every hit becomes UNCLEAR for human review.
    for label, rx, item in _BRAIN_CANDIDATE:
        for m in rx.finditer(union_raw_l):
            val = m.group(0)
            context = _context(union_raw_l, m.start(), m.end())
            unclears.append(f"{item.get('m_code','M-?')} candidate:'{val}' - {context}")

    # Strain lexicon floor/live union. A strain name alone is ambiguous because some names can be
    # ordinary product/flavor language. A strain plus any other cannabis/M-2 signal in the same record
    # is a hard M-2 corpus hit.
    strain_hits = list(dict.fromkeys(m.group(0) for m in _STRAIN_RE.finditer(union_raw_full_l)))
    strain_corroborated = bool(_STRAIN_CORROBORATOR_RE.search(union_raw_full_l))
    for sv in strain_hits:
        if strain_corroborated:
            fails.append(f"M-2 strain-name(corroborated):'{sv}'")
        else:
            unclears.append(f"M-2 strain-name(single-source):'{sv}' - verify on image")

    # claim_surface_only patterns on the creative-OCR surface: NOT a hard fail (mc 2026-07-03).
    # Emit as a vision-adjudication note (default packaging/incidental = exempt PASS; the vision pass
    # flips added-headline/overlay/mockup-listing to FAIL). Skip values already failed on another axis
    # (e.g. a "Clean Green Flower" mockup already M-2-failed on 'flower').
    for label, val in _find_all(union_raw_l, _BRAIN_CLAIM_SURFACE):
        if val in already: continue
        vision_adjudicate.append(f"{label}:'{val}'")

    # letterspace-collapsed evasion: also corroboration-gated
    readable = set(seen)
    for w in _SINGLE_TOKEN_BANS:
        if re.search(r'\b'+re.escape(w)+r'\b', union_leet_l): readable.add(w)
    for line in _leet_norm(corpus).splitlines():
        for w in _letterspace_collapse_words(line):
            if w in _SINGLE_TOKEN_BANS and w not in readable:
                unclears.append(f"{_SINGLE_TOKEN_LABEL.get(w,'M-2')}(despaced,single-source):'{w}' - verify on image")

    if product == "gummies":
        for label, rx in _GUM_HARD_ALPHA:
            for m in rx.finditer(union_leet_l):
                add_hard_hit(label, m.group(0), hit_sources(rx, masked_sources_leet))
        for label, rx in _GUM_HARD_DIGIT:
            for m in rx.finditer(union_raw_l):
                add_hard_hit(label, m.group(0), hit_sources(rx, masked_sources_raw))
        for label, val in _find_all(union_leet_l, _GUM_AMBIG_ALPHA): unclears.append(f"{label}:'{val}'")

    for label, val in _find_all(union_leet_l, _AMBIG_ALPHA): unclears.append(f"{label}:'{val}'")
    for label, val in _find_all(union_raw_l,  _AMBIG_DIGIT): unclears.append(f"{label}:'{val}'")

    # DE-CODE on-creative -> UNCLEAR-for-Adam-review (surface_handling.creative). The de-code spans
    # were masked out of the text above BEFORE the hard grep, so these flags are span-local and never
    # suppress a co-occurring standalone hard violation. family-grown never matches (not in the set).
    for dv in dict.fromkeys(decode_hits):
        unclears.append(f"de-code on-creative (Adam review):'{dv}'")

    if rec.get("low_conf"): unclears.append("low-confidence read")
    for reason in _AUTHORITY_FORCE_UNCLEAR:
        unclears.append(f"authority degraded: {reason}")

    fails = list(dict.fromkeys(fails)); unclears = list(dict.fromkeys(unclears))
    vision_adjudicate = list(dict.fromkeys(vision_adjudicate))
    if fails:    v, ev = "FAIL", "; ".join(fails[:6])
    elif unclears: v, ev = "UNCLEAR", "; ".join(unclears[:5]) + "; needs human review"
    else:
        v = "PASS"
        # claim-surface hits that did not fail on any other axis: default-exempt (pouch logo/incidental)
        # per mc 2026-07-03, with a note so the vision pass can flip added-text/mockup to FAIL.
        if vision_adjudicate:
            ev = "clean: no banned text, imagery clean [vision-adjudicate default-exempt: " + "; ".join(vision_adjudicate[:3]) + "]"
        else:
            ev = "clean: no banned text, imagery clean"
    return v, ev, fails, unclears

def _meta_reconcile(v, fails, meta):
    m = (meta or "").upper()
    if v == "PASS" and "DISAPPROV" in m:
        return "FAIL", " | Meta-DISAPPROVED (scan missed) - inspect", True
    if v == "FAIL" and fails and ("ACTIVE" in m or "APPROVED" in m):
        return "FAIL", " | Meta currently ACTIVE - retro-disapproval risk", False
    if v == "FAIL" and not fails and ("ACTIVE" in m or "APPROVED" in m):
        return "UNCLEAR", " | judgment-only call, Meta ACTIVE - human eye", False
    return v, "", False

def _compile_strain_re(strains):
    if not strains:
        return _EMPTY_RE
    return re.compile("|".join(f"(?:{_phrase_re(s)})" for s in sorted(strains, key=len, reverse=True)), re.IGNORECASE)


def _read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _compile_entries(entries, label_prefix):
    out = []
    for item in entries:
        pat = item.get("pattern") if isinstance(item, dict) else None
        if not isinstance(pat, str) or not pat:
            continue
        try:
            out.append((f"{item.get('m_code','M-?')} {label_prefix}", re.compile(pat, re.IGNORECASE), item))
        except re.error as exc:
            print(f"WARNING: {label_prefix} pattern skipped ({exc}): {pat[:60]}", file=sys.stderr)
    return out


def _load_banned(env):
    path = _brain_data_path("BANNED_TERMS_JSON", "banned-terms.json", env)
    data = _read_json(path)
    _require_version(data, _BANNED_TERMS_VERSION_FLOOR, "banned-terms")
    hard_entries = data.get("hard")
    candidate_entries = data.get("candidate")
    if not isinstance(hard_entries, list):
        raise ValueError("top-level hard is not an array")
    if not isinstance(candidate_entries, list):
        raise ValueError("top-level candidate is not an array")
    hard = _compile_entries(hard_entries, "brain-hard")
    candidate = _compile_entries(candidate_entries, "candidate")
    if not hard:
        raise ValueError("hard[] empty")
    if not candidate:
        raise ValueError("candidate[] empty")
    hard_nonclaim = [(label, rx) for label, rx, item in hard if not item.get("claim_surface_only")]
    hard_claim = [
        (f"{item.get('m_code','M-?')} claim-surface (vision-adjudicate: pouch-logo exempt / added-text FAIL)", rx)
        for _label, rx, item in hard
        if item.get("claim_surface_only")
    ]
    canary_missing = [term for term in _BANNED_TERMS_CANARY if not any(rx.search(term) for _label, rx in hard_nonclaim)]
    if canary_missing:
        raise ValueError("banned-terms canary missing: " + ", ".join(canary_missing))
    candidate_missing = [
        term for term in _CANDIDATE_CANARY
        if not any(rx.search(term) for _label, rx, _item in candidate)
    ]
    if candidate_missing:
        raise ValueError("candidate canary missing: " + ", ".join(candidate_missing))
    return hard_nonclaim, hard_claim, [(label, rx, item) for label, rx, item in candidate]


def _load_coding(env):
    path = _brain_data_path("CODING_SIGNALS_JSON", "cannabis-coding-signals.json", env)
    data = _read_json(path)
    _require_version(data, _CODING_SIGNALS_VERSION_FLOOR, "coding-signals")
    patterns = data["de_code_hard_remove"]["patterns"]
    copy_pats = []
    creative_unclear_pats = []
    for item in patterns:
        pat = item.get("pattern")
        if not isinstance(pat, str) or not pat:
            continue
        handling = item.get("surface_handling") or {}
        if handling.get("copy") in {"hard_remove", "hard_fail"}:
            copy_pats.append(pat)
        if handling.get("creative") == "unclear":
            creative_unclear_pats.append(pat)
    if not copy_pats:
        raise ValueError("no copy de-code patterns")
    if not creative_unclear_pats:
        raise ValueError("no creative=unclear de-code patterns")
    copy_re = re.compile("|".join(f"(?:{p})" for p in copy_pats), re.IGNORECASE)
    missing = [term for term in _CODING_SIGNALS_CANARY if not copy_re.search(term)]
    if missing:
        raise ValueError("coding-signals canary missing: " + ", ".join(missing))
    creative_re = re.compile("|".join(f"(?:{p})" for p in creative_unclear_pats), re.IGNORECASE)
    return copy_re, creative_re


def _load_strain_authority(env):
    path = _brain_data_path("STRAIN_LEXICON_JSON", "strain-lexicon.json", env)
    data = _read_json(path)
    _require_version(data, _STRAIN_VERSION_FLOOR, "strain-lexicon")
    live = data.get("strains")
    if not isinstance(live, list):
        raise ValueError("strains is not a list")
    added = {s.strip().lower() for s in live if isinstance(s, str) and s.strip()}
    if len(added) < _STRAIN_COUNT_FLOOR:
        raise ValueError(f"strain count {len(added)} below floor {_STRAIN_COUNT_FLOOR}")
    return sorted(added, key=len, reverse=True)


def load(env=None, degradations=None):
    source = env if env is not None else os.environ
    try:
        hard, claim, candidate = _load_banned(source)
    except Exception as exc:
        return _Authority(
            status="failed",
            authority_class="core_loss",
            reasons=[f"failed to load authoritative banned terms: {exc}"],
        )
    reasons = []
    failed_components = []
    try:
        decode_copy_re, decode_creative_re = _load_coding(source)
    except Exception as exc:
        reasons.append(f"failed to load de-code signals: {exc}")
        failed_components.append("decode")
        decode_copy_re = _EMPTY_RE
        decode_creative_re = _EMPTY_RE
    try:
        strains = _load_strain_authority(source)
    except Exception as exc:
        reasons.append(f"failed to load strain lexicon: {exc}")
        failed_components.append("strain")
        strains = []
    if reasons:
        return _Authority(
            status="failed",
            authority_class="component_loss",
            reasons=reasons,
            hard=hard,
            claim_surface=claim,
            candidate=candidate,
            decode_copy_re=decode_copy_re,
            decode_creative_re=decode_creative_re,
            strain_terms=strains,
            degradations=degradations,
            failed_components=failed_components,
        )
    return _Authority(
        status="ok",
        authority_class="ok",
        hard=hard,
        claim_surface=claim,
        candidate=candidate,
        decode_copy_re=decode_copy_re,
        decode_creative_re=decode_creative_re,
        strain_terms=strains,
        degradations=degradations,
    )


def _brain_root(env=None):
    source = env if env is not None else os.environ
    banned = _brain_data_path("BANNED_TERMS_JSON", "banned-terms.json", source)
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(banned)))) if "/agents/" in banned else "/tmp/brain"


def _max_data_mtime(env=None):
    source = env if env is not None else os.environ
    mtimes = []
    for env_name, filename in (
        ("BANNED_TERMS_JSON", "banned-terms.json"),
        ("CODING_SIGNALS_JSON", "cannabis-coding-signals.json"),
        ("STRAIN_LEXICON_JSON", "strain-lexicon.json"),
    ):
        path = _brain_data_path(env_name, filename, source)
        if os.path.exists(path):
            mtimes.append(os.path.getmtime(path))
    return max(mtimes) if mtimes else 0


def ensure_brain(env=None, ttl_seconds=3600, now=None, clone_fn=None, log_fn=None):
    source = env if env is not None else os.environ
    clock = time.time() if now is None else now
    cached = load(source)
    fresh = clock - _max_data_mtime(source) <= ttl_seconds
    if cached.status == "ok" and fresh:
        return cached
    if clone_fn is None:
        def clone_fn():
            root = _brain_root(source)
            if os.path.exists(root):
                shutil.rmtree(root)
            subprocess.run(
                ["gh", "repo", "clone", "CLEAN-APPS-DEV/clean-green-marketing-brain", root],
                check=True,
                timeout=120,
            )
    try:
        clone_fn()
        return load(source)
    except Exception as exc:
        if cached.status == "ok":
            msg = f"brain refresh failed; using cached floor+canary-passing authority: {exc}"
            if log_fn:
                log_fn(msg)
            cached.degradations.append(msg)
            return cached
        return cached


def _alert(authority):
    if authority.status == "ok":
        return
    key = (authority.authority_class, tuple(authority.reasons))
    if key in _ALERTED:
        return
    _ALERTED.add(key)
    msg = (
        "VERDICT-CORE AUTHORITY FAILURE: "
        + "; ".join(authority.reasons)
        + " - fail-closed. Restore by re-cloning /tmp/brain or setting authoritative env paths and re-run."
    )
    try:
        subprocess.run(
            [
                "cortextos",
                "bus",
                "log-event",
                "error",
                "verdict_core_authority_failure",
                "error",
                "--meta",
                json.dumps({"authority_class": authority.authority_class, "reasons": authority.reasons}),
            ],
            timeout=15,
            check=False,
        )
    except Exception:
        pass
    if _is_test_context():
        return
    for agent in ("meta-compliance-agent", "meta-ads-agent"):
        try:
            subprocess.run(["cortextos", "bus", "notify-agent", agent, msg], timeout=15, check=False)
        except Exception:
            pass


def _is_test_context():
    return any(os.environ.get(name) for name in ("PYTEST_CURRENT_TEST", "CTX_TEST"))


def _context(text, start, end, width=36):
    left = max(0, start - width)
    right = min(len(text), end + width)
    return re.sub(r"\s+", " ", text[left:right]).strip()


def _copy_classify(text, authority):
    raw = _flat(_raw_norm(text))
    fails = []
    unclears = []
    candidate_hits = []
    for label, rx in authority.hard + authority.claim_surface:
        for match in rx.finditer(raw):
            fails.append(f"{label}:'{match.group(0)}'")
    for match in authority.decode_copy_re.finditer(raw):
        fails.append(f"decode_hard_remove:'{match.group(0)}'")
    strain_hits = list(dict.fromkeys(match.group(0) for match in authority.strain_re.finditer(raw)))
    strain_corroborated = bool(_STRAIN_CORROBORATOR_RE.search(raw))
    for value in strain_hits:
        if strain_corroborated:
            fails.append(f"M-2 strain-name(corroborated):'{value}'")
        else:
            unclears.append(f"M-2 strain-name(single-source):'{value}' - verify")
    for label, rx, item in authority.candidate:
        for match in rx.finditer(raw):
            hit = {
                "term": item.get("note", label),
                "m_code": item.get("m_code", "M-?"),
                "matched_text": match.group(0),
                "context": _context(raw, match.start(), match.end()),
            }
            candidate_hits.append(hit)
            unclears.append(f"{hit['m_code']} candidate:'{hit['matched_text']}' - {hit['context']}")
    fails = list(dict.fromkeys(fails))
    unclears = list(dict.fromkeys(unclears))
    if fails:
        return _Verdict("FAIL", "; ".join(fails[:6]), fails, unclears, candidate_hits)
    if unclears:
        return _Verdict("UNCLEAR", "; ".join(unclears[:5]) + "; needs human review", fails, unclears, candidate_hits)
    return _Verdict("PASS", "clean: no banned text")


def _with_creative_authority(rec, authority):
    global _BRAIN_HARD, _BRAIN_CLAIM_SURFACE, _BRAIN_CANDIDATE, _DECODE_CREATIVE_RE, _STRAIN_TERMS, _STRAIN_RE, _AUTHORITY_FORCE_UNCLEAR
    old = (_BRAIN_HARD, _BRAIN_CLAIM_SURFACE, _BRAIN_CANDIDATE, _DECODE_CREATIVE_RE, _STRAIN_TERMS, _STRAIN_RE, _AUTHORITY_FORCE_UNCLEAR)
    _BRAIN_HARD = authority.hard
    _BRAIN_CLAIM_SURFACE = authority.claim_surface
    _BRAIN_CANDIDATE = authority.candidate
    _DECODE_CREATIVE_RE = authority.decode_creative_re
    _STRAIN_TERMS = authority.strain_terms
    _STRAIN_RE = authority.strain_re
    _AUTHORITY_FORCE_UNCLEAR = authority.degradations
    try:
        v, ev, fails, unclears = _creative_verdict_for(rec)
        return _Verdict(v, ev, fails, unclears)
    finally:
        (_BRAIN_HARD, _BRAIN_CLAIM_SURFACE, _BRAIN_CANDIDATE, _DECODE_CREATIVE_RE, _STRAIN_TERMS, _STRAIN_RE, _AUTHORITY_FORCE_UNCLEAR) = old


def _component_loss_unclears(authority, surface):
    out = []
    failed = set(getattr(authority, "failed_components", []))
    reasons = "; ".join(getattr(authority, "reasons", []))
    if "decode" in failed:
        out.append(f"authority degraded: de-code {surface} scope unavailable - {reasons}")
    if "strain" in failed:
        out.append(f"authority degraded: strain-check {surface} scope unavailable - {reasons}")
    if not out:
        out.append("authority degraded: component scope unavailable - " + reasons)
    return out


def classify(text_or_record, authority, surface="creative"):
    authority_class = getattr(authority, "authority_class", "unknown")
    status = getattr(authority, "status", "failed")
    if status != "ok":
        _alert(authority)
        if authority_class == "component_loss":
            if surface == "copy":
                verdict = _copy_classify(str(text_or_record or ""), authority)
            else:
                verdict = _with_creative_authority(text_or_record or {}, authority)
            verdict.authority_class = authority_class
            if verdict.verdict == "FAIL":
                return verdict
            component_unclears = _component_loss_unclears(authority, surface)
            existing_unclears = list(verdict.unclears)
            for item in component_unclears:
                if item not in existing_unclears:
                    existing_unclears.append(item)
            verdict.verdict = "UNCLEAR"
            verdict.unclears = existing_unclears
            verdict.evidence = "; ".join(existing_unclears[:5]) + "; needs human review"
            verdict.must_not_pass = True
            verdict.tier_outcome = "UNCLEAR"
            return verdict
        return _Verdict(
            verdict="UNCLEAR",
            evidence="authority degraded: " + "; ".join(getattr(authority, "reasons", [])),
            authority_class=authority_class,
            must_not_pass=True,
        )
    if authority_class != "ok":
        _alert(authority)
        return _Verdict(
            verdict="UNCLEAR",
            evidence=f"unknown authority class {authority_class}; default-deny",
            authority_class=authority_class,
            must_not_pass=True,
        )
    if surface == "copy":
        return _copy_classify(str(text_or_record or ""), authority)
    return _with_creative_authority(text_or_record or {}, authority)


if __name__ == "__main__":
    raise SystemExit("verdict_core is a library; use grep_verdict.py or copy-gate.py")
