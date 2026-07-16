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
import json, os, re, sys

LEET = str.maketrans({'0':'o','1':'i','3':'e','4':'a','5':'s','@':'a','$':'s'})
BANNED_TERMS_VERSION_FLOOR = (1, 0, 11)
STRAIN_VERSION_FLOOR = (1, 0, 0)
STRAIN_COUNT_FLOOR = 71
BANNED_TERMS_CANARY = ("bud", "flower", "cannabis", "thc", "family grown")
_BRAIN_DATA_ROOT = "/tmp/brain/agents/meta-compliance-agent/data"
AUTHORITY_FORCE_UNCLEAR = []

def brain_data_path(env_name, filename):
    return os.environ.get(env_name) or os.path.join(_BRAIN_DATA_ROOT, filename)

def parse_version(value):
    if not isinstance(value, str) or not value.strip():
        return None
    parts = value.strip().split(".")
    parsed = []
    for part in parts:
        if not part.isdigit():
            return None
        parsed.append(int(part))
    return tuple(parsed)

def version_at_least(value, floor):
    parsed = parse_version(value)
    if parsed is None:
        return False
    width = max(len(parsed), len(floor))
    return parsed + (0,) * (width - len(parsed)) >= floor + (0,) * (width - len(floor))

def require_version(data, floor, label):
    version = data.get("version")
    if not version_at_least(version, floor):
        raise ValueError(f"{label} version {version!r} below floor {'.'.join(map(str, floor))}")

def record_force_unclear(reason):
    AUTHORITY_FORCE_UNCLEAR.append(reason)
    print(reason, file=sys.stderr)

def leet_norm(text):
    return (text or "").lower().translate(LEET)

def raw_norm(text):
    return (text or "").lower()

def flat(t): return re.sub(r'[ \t]+',' ',t)

def letterspace_collapse_words(line):
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

# ---- ALPHA hard bans: matched on LEET-normalized text (de-obfuscation wanted) ----
HARD_ALPHA = [
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
HARD_DIGIT = [
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
SHIPCTX = re.compile(r'\b(ship|shipped|shipping|deliver|delivered|delivery|arrive|arrives|arrival|doorstep|door|mail|mailed)\b')
SINGLE_TOKEN_BANS = {
 'bud','buds','flower','flowers','cannabis','marijuana','weed','thc','thca','cbd',
 'hemp','strain','strains','dispensary','nug','nugs','dank','ganja','reefer','medical','discreet'
}
SINGLE_TOKEN_LABEL = {w:('M-2 '+w) for w in SINGLE_TOKEN_BANS}

# ---- AMBIGUOUS (UNCLEAR): alpha on leet, digit on raw ----
AMBIG_ALPHA = [
 ("M-4 health/relief", re.compile(r'\b(relief|cures?|cured|treats?|treatment|anxiety|insomnia|stress|pain)\b|feel like yourself|feel the difference')),
 ("M-8 press", re.compile(r'\b(cbs|fox|usa today|msnbc|nbc|abc|forbes)\b|as seen (on|in)|as featured')),
 ("M-20 comparison", re.compile(r'better than|better\s+\w+\s+than|stronger than|more potent|not weak|not gas station|higher.?quality than|quality than|than (the|my|any|anything|what|i|your)\b.{0,18}\b(getting|got|had|used|tried|before|old|local|shop|dispensar)')),
]
AMBIG_DIGIT = [
 # (M-6 social-proof# count class moved to HARD_DIGIT as M-16a 2026-06-11; standalone star ratings and
 #  "thousands of" are explicitly APPROVED per rules.md M-16a and are no longer flagged)
]
GUM_HARD_ALPHA = [
 ("M-13 sleep-onset", re.compile(r'fall asleep|asleep all night|sleep through the night|slept through the night|drift off|wake up rested|stay asleep|stayed asleep|natural sleep aid|non[- ]?habit[- ]?forming')),
 ("M-12 diagnostic-Q", re.compile(r"can'?t sleep\??|still awake\??|trouble sleeping\??|can'?t shut off")),
 ("M-5 side-effect", re.compile(r'no grogginess|no morning fog|without grog|zero grog|morning fog|\bgrog\b|grogginess')),
]
GUM_HARD_DIGIT = [
 ("M-13 sleep-onset#", re.compile(r'out by \d+|asleep by \d+|\b8 hours\b')),
]
GUM_AMBIG_ALPHA = [
 ("M-13? melatonin mention", re.compile(r'(?<!no )(?<!no-)(?<!free )(?<!without )(?<!zero )melatonin\b(?![ -]?free)')),
]

# ---- BRAIN-DERIVED HARD set (canonicalization, task_1782181935289 2026-07-02) ----
# UNION layer on top of the inline sets above: every banned-terms.json hard[] pattern also runs
# (matched on RAW lowered text - brain patterns are authored against normal text). The inline sets
# stay as the FLOOR (fail-safe: a malformed brain file can never make this gate WEAKER, only the
# brain-additions drop, with a loud warning). Single source of truth = mc's banned-terms.json;
# this closes the local-drift class (e.g. the v1.0.8->v1.0.9 naturally-grown gap, the "calmer"/
# "batch" lag that #146 fixed on mc's own gate).
# SURFACE-SPLIT for claim_surface_only patterns (mc ruling 2026-07-03, M-24a scoping spec):
# A claim_surface_only pattern (e.g. M-24a "\bclean green\b") behaves DIFFERENTLY by surface.
#  - COPY surface (Headline..Primary Var.4 + Ad Description) = advertiser-authored claim layer ->
#    stays a HARD grep FAIL. That is the copy-gate (copy-gate.py), NOT this creative scan - untouched.
#  - CREATIVE-IMAGERY OCR surface (this scan) = mixed layer (physical packaging + advertiser overlays).
#    An OCR-d pouch WORDMARK/logo must NOT auto-FAIL. So claim_surface_only patterns are EXCLUDED from
#    the deterministic hard[] union here and EMITTED as a VISION-ADJUDICATION note (candidate) instead:
#    the vision pass resolves pouch-LOGO -> exempt PASS vs added HEADLINE/overlay/testimonial-line/
#    mockup-product-listing -> FAIL. (rules.md L492/L614 + M-19f pouch/logo exclusion; skill L126
#    "vision flag, not a blind grep".) A "Clean Green Flower" mockup still hard-FAILs independently on
#    M-2 'flower'; the cleangreen.com domain URL stays exempt. Generalized to ALL claim_surface_only.
def _load_brain_hard():
    path = brain_data_path("BANNED_TERMS_JSON", "banned-terms.json")
    out = []; claim = []
    try:
        d = json.load(open(path, encoding="utf-8"))
        require_version(d, BANNED_TERMS_VERSION_FLOOR, "banned-terms")
        ver = d.get("version", "?")
        for p in d.get("hard", []):
            pat = p.get("pattern")
            if not isinstance(pat, str) or not pat:
                continue
            try:
                entry = (f"{p.get('m_code','M-?')} brain-hard", re.compile(pat, re.IGNORECASE))
            except re.error as e:
                print(f"WARNING: banned-terms hard pattern skipped ({e}): {pat[:60]}", file=sys.stderr)
                continue
            # claim_surface_only -> NOT a creative-OCR hard fail; route to vision-adjudication.
            if p.get("claim_surface_only"):
                claim.append((f"{p.get('m_code','M-?')} claim-surface (vision-adjudicate: pouch-logo exempt / added-text FAIL)", entry[1]))
            else:
                out.append(entry)
        if not out:
            raise ValueError("hard[] empty")
        missing = [term for term in BANNED_TERMS_CANARY if not any(rx.search(term) for _, rx in out)]
        if missing:
            raise ValueError("banned-terms canary missing: " + ", ".join(missing))
        print(f"brain hard[] loaded: {len(out)} hard + {len(claim)} claim-surface->vision (banned-terms v{ver})", file=sys.stderr)
    except Exception as e:
        record_force_unclear(
            f"WARNING: banned-terms.json component load failed ({e}); force-UNCLEAR all creative rows"
        )
        out = []; claim = []
    return out, claim
BRAIN_HARD, BRAIN_CLAIM_SURFACE = _load_brain_hard()

# ---- DE-CODE on-CREATIVE -> UNCLEAR-for-Adam-review (NOT FAIL) ----
# LIVE-SOURCED from cannabis-coding-signals.json de_code_hard_remove.patterns (single source, mc owns it).
# surface_handling.creative (#154 2026-06-22) = UNCLEAR-Adam-review: Adam owns the on-image de-code call
# (accepted-risk framing), so the creative-grep FLAGS UNCLEAR, never hard-FAIL. family-grown is NOT in this
# set (it's adam_accepted_risk) so it never flags. The copy-gate uses surface_handling.copy = HARD-REMOVE.
# On any load failure, fall back to LAST_KNOWN_DECODE. The brain clone path is the per-run /tmp/brain default.
LAST_KNOWN_DECODE_UNCLEAR = [
 r"\b(lab[- ]?tested|test results|third[- ]?party tested|independently tested|tested before it ships|certificate of analysis|\bcoa\b)\b",
 r"\bfarm[- ]?direct\b",
]
LAST_KNOWN_DECODE_HARD_FAIL = [
 r"\b(ships?|shipping|available|delivery|sold|sells?|buy|buys|order(s|ing)?|gets?|purchas\w+)\b[^.\n]{0,20}\b(eligible|select|certain|legal)\s+states\b|\beligible states\b|\bstate list\b|\bwhere (it'?s )?legal\b",
]
LAST_KNOWN_DECODE = LAST_KNOWN_DECODE_HARD_FAIL + LAST_KNOWN_DECODE_UNCLEAR
def _load_decode_creative():
    # Production sources cannabis-coding-signals.json from the per-run FRESH brain clone (SKILL.md:
    # `cd /tmp && rm -rf brain && gh repo clone CLEAN-APPS-DEV/clean-green-marketing-brain brain`).
    # Resolve robustly across candidate paths; on a total miss fall back to LAST_KNOWN_DECODE LOUDLY
    # so an absent/failed clone can NEVER silently serve a stale de-code set (orch hardening 2026-06-23).
    candidates = [p for p in (
        os.environ.get("CODING_SIGNALS_JSON"),
        "/tmp/brain/agents/meta-compliance-agent/data/cannabis-coding-signals.json",
    ) if p]
    for path in candidates:
        try:
            d = json.load(open(path, encoding="utf-8"))
            pats = []
            for p in d["de_code_hard_remove"]["patterns"]:
                if not isinstance(p.get("pattern"), str) or not p["pattern"]:
                    continue
                handling = p.get("surface_handling") or {}
                if handling.get("creative") == "unclear":
                    pats.append(p["pattern"])
            if not pats:
                raise ValueError("no de-code patterns with surface_handling.creative == unclear")
            return re.compile("|".join(f"(?:{p})" for p in pats), re.IGNORECASE)
        except Exception as e:
            print(f"WARNING: de-code signals load failed for {path} ({e})", file=sys.stderr)
    # No live source resolved -> LOUD fallback (never silent). The fallback contains ONLY creative=unclear
    # spans. Eligible-states is creative=hard_fail and must stay unmasked so M-19f can fail it.
    for line in ("=" * 72,
                 "WARNING: creative-grep de-code signals NOT loaded from a live source.",
                 "  Using built-in LAST_KNOWN_DECODE_UNCLEAR fallback - may be STALE if the brain",
                 "  added creative=unclear de-code patterns. Ensure the fresh /tmp/brain clone exists or set",
                 "  CODING_SIGNALS_JSON to cannabis-coding-signals.json before the scan.",
                 "=" * 72):
        print(line, file=sys.stderr)
    return re.compile("|".join(f"(?:{p})" for p in LAST_KNOWN_DECODE_UNCLEAR), re.IGNORECASE)
DECODE_CREATIVE_RE = _load_decode_creative()

# ---- STRAIN LEXICON: strain alone -> UNCLEAR, strain + cannabis/M-2 corroborator -> FAIL ----
# Live data is owned by meta-compliance, but this floor must never weaken when the brain file is
# absent, malformed, or incomplete. Loaded strains are UNIONED with the inline floor.
LAST_KNOWN_STRAINS = [
    "blue dream", "gelato", "cherry do-si-dos", "cherry dosidos", "og kush", "sour diesel",
    "granddaddy purple", "girl scout cookies", "pineapple express", "durban poison",
    "northern lights", "wedding cake", "runtz", "zkittlez", "gorilla glue",
]

def _load_strains():
    path = brain_data_path("STRAIN_LEXICON_JSON", "strain-lexicon.json")
    strains = set(LAST_KNOWN_STRAINS)
    try:
        d = json.load(open(path, encoding="utf-8"))
        require_version(d, STRAIN_VERSION_FLOOR, "strain-lexicon")
        live = d.get("strains")
        if not isinstance(live, list):
            raise ValueError("strains is not a list")
        added = {s.strip().lower() for s in live if isinstance(s, str) and s.strip()}
        if not added:
            raise ValueError("strains empty")
        if len(added) < STRAIN_COUNT_FLOOR:
            raise ValueError(f"strain count {len(added)} below floor {STRAIN_COUNT_FLOOR}")
        strains |= added
        print(f"strain lexicon loaded: {len(added)} live + {len(LAST_KNOWN_STRAINS)} floor", file=sys.stderr)
    except Exception as e:
        record_force_unclear(
            f"WARNING: strain-lexicon.json component load failed ({e}); force-UNCLEAR all creative rows"
        )
    return sorted(strains, key=len, reverse=True)

def _phrase_re(phrase):
    parts = [re.escape(p) for p in re.split(r'\s+', phrase.strip()) if p]
    return r'(?<![a-z0-9])' + r'[\s-]+'.join(parts) + r'(?![a-z0-9])'

STRAIN_TERMS = _load_strains()
STRAIN_RE = re.compile("|".join(f"(?:{_phrase_re(s)})" for s in STRAIN_TERMS), re.IGNORECASE)
STRAIN_CORROBORATOR_RE = re.compile(
    r'\b(thc|thca|cbd|cannabinoids?|cannabis|marijuana|weed|hemp|flower|buds?|nugs?|'
    r'dispensar(y|ies)|strains?|coa|certificate of analysis|lab[- ]?tested|third[- ]?party tested|'
    r'farm bill|agriculture act|discree?t(ly)?|plain (box|mail|packaging|billing))\b',
    re.IGNORECASE,
)

def find_all(text, pats):
    hits=[]
    for label, rx in pats:
        for m in rx.finditer(text):
            # $-price guard for social-proof ("orders over $99")
            if label in ("M-6 social-proof#", "M-16a social-proof-count"):
                s=max(0,m.start()-12)
                if re.search(r'over \$|\$\d', text[s:m.end()+3]): continue
            hits.append((label, m.group(0)))
    return hits

def single_vision_only(names):
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

def verdict_for(rec):
    product = rec.get("product","flower")
    vis  = rec.get("vision_text","") or ""
    vis2 = rec.get("vision_text2","") or ""
    ocr  = rec.get("ocr_text","") or ""
    vo   = rec.get("vo_text","") or ""
    if "DOWNLOAD_FAIL" in vis or vis.strip().upper().startswith("SCAN ERROR"):
        return "SCAN ERROR", "1x1 inaccessible (404/expired) - needs re-share", [], []
    sources = {"vision": vis, "vision2": vis2, "ocr": ocr, "vo": vo}
    corpus = "\n".join(sources.values())
    union_raw_l  = flat(raw_norm(corpus))
    union_leet_l = flat(leet_norm(corpus))
    union_raw_full_l = union_raw_l

    # DE-CODE on-creative (surface_handling.creative #154) -> UNCLEAR-for-Adam-review, SPAN-LOCAL.
    # Capture the de-code phrases, then MASK their spans (blank them) OUT of the text BEFORE the hard
    # grep. This way a de-code phrase cannot trip a broader HARD rule (e.g. M-2 legality "legal" living
    # inside "where it's legal"), yet a STANDALONE hard claim - cannabis noun, Agriculture Act legality,
    # enforcement, or a SEPARATE "100% legal" - sits OUTSIDE every de-code span, survives the mask, and
    # correctly FAILs. The suppression is span-local (overlap-only), NOT row-scoped: only the de-code
    # span itself becomes UNCLEAR; co-occurring standalone hard violations still FAIL the row.
    decode_hits = [m.group(0) for m in DECODE_CREATIVE_RE.finditer(union_raw_l)]
    _blank = lambda m: " " * len(m.group(0))
    union_raw_l  = DECODE_CREATIVE_RE.sub(_blank, union_raw_l)
    union_leet_l = DECODE_CREATIVE_RE.sub(_blank, union_leet_l)

    fails=[]; unclears=[]; vision_adjudicate=[]

    masked_sources_raw = {k: flat(raw_norm(DECODE_CREATIVE_RE.sub(_blank, v))) for k, v in sources.items()}
    masked_sources_leet = {k: flat(DECODE_CREATIVE_RE.sub(_blank, leet_norm(v))) for k, v in sources.items()}

    def hit_sources(rx, source_texts):
        return [name for name, text in source_texts.items() if text and rx.search(text)]

    # single_vision_only is a module-level pure function (importable + unit-testable, incl. vision3-injection)

    def add_hard_hit(label, val, names):
        if single_vision_only(names):
            unclears.append(f"{label}(single-vision, uncorroborated):'{val}' - verify on image")
        else:
            fails.append(f"{label}:'{val}'")

    seen=set()
    for label, rx in HARD_ALPHA:
        for m in rx.finditer(union_leet_l):
            val = m.group(0)
            names = hit_sources(rx, masked_sources_leet)
            add_hard_hit(label, val, names)
            base = re.sub(r'[^a-z]','',val.split()[0]) if val else ''
            tok = val.strip().lower()
            if tok in SINGLE_TOKEN_BANS or base in SINGLE_TOKEN_BANS:
                w = tok if tok in SINGLE_TOKEN_BANS else base
                seen.add(w)
    for label, rx in HARD_DIGIT:
        for m in rx.finditer(union_raw_l):
            val = m.group(0)
            names = hit_sources(rx, masked_sources_raw)
            if single_vision_only(names):
                unclears.append(f"{label}(single-vision, uncorroborated):'{val}' - verify on image")
                continue
            if label=="M-2 delivery-time-guarantee" and re.fullmatch(r'(24|48|72)[- ]?hours?', val.strip()):
                # bare hours number: HARD only with a ship/deliver word in the text (else it could be product info)
                if not SHIPCTX.search(union_raw_l):
                    unclears.append(f"{label}(no ship context):'{val}' - verify"); continue
            fails.append(f"{label}:'{val}'")

    # brain-derived hard[] union pass (raw lowered text; dedup vs already-failed values)
    already = {f.split(":'",1)[1].rstrip("'") for f in fails if ":'" in f}
    for label, rx in BRAIN_HARD:
        for m in rx.finditer(union_raw_l):
            val = m.group(0)
            if val in already: continue
            already.add(val)
            names = hit_sources(rx, masked_sources_raw)
            add_hard_hit(label, val, names)

    # Strain lexicon floor/live union. A strain name alone is ambiguous because some names can be
    # ordinary product/flavor language. A strain plus any other cannabis/M-2 signal in the same record
    # is a hard M-2 corpus hit.
    strain_hits = list(dict.fromkeys(m.group(0) for m in STRAIN_RE.finditer(union_raw_full_l)))
    strain_corroborated = bool(STRAIN_CORROBORATOR_RE.search(union_raw_full_l))
    for sv in strain_hits:
        if strain_corroborated:
            fails.append(f"M-2 strain-name(corroborated):'{sv}'")
        else:
            unclears.append(f"M-2 strain-name(single-source):'{sv}' - verify on image")

    # claim_surface_only patterns on the creative-OCR surface: NOT a hard fail (mc 2026-07-03).
    # Emit as a vision-adjudication note (default packaging/incidental = exempt PASS; the vision pass
    # flips added-headline/overlay/mockup-listing to FAIL). Skip values already failed on another axis
    # (e.g. a "Clean Green Flower" mockup already M-2-failed on 'flower').
    for label, val in find_all(union_raw_l, BRAIN_CLAIM_SURFACE):
        if val in already: continue
        vision_adjudicate.append(f"{label}:'{val}'")

    # letterspace-collapsed evasion: also corroboration-gated
    readable = set(seen)
    for w in SINGLE_TOKEN_BANS:
        if re.search(r'\b'+re.escape(w)+r'\b', union_leet_l): readable.add(w)
    for line in leet_norm(corpus).splitlines():
        for w in letterspace_collapse_words(line):
            if w in SINGLE_TOKEN_BANS and w not in readable:
                unclears.append(f"{SINGLE_TOKEN_LABEL.get(w,'M-2')}(despaced,single-source):'{w}' - verify on image")

    if product == "gummies":
        for label, rx in GUM_HARD_ALPHA:
            for m in rx.finditer(union_leet_l):
                add_hard_hit(label, m.group(0), hit_sources(rx, masked_sources_leet))
        for label, rx in GUM_HARD_DIGIT:
            for m in rx.finditer(union_raw_l):
                add_hard_hit(label, m.group(0), hit_sources(rx, masked_sources_raw))
        for label, val in find_all(union_leet_l, GUM_AMBIG_ALPHA): unclears.append(f"{label}:'{val}'")

    for label, val in find_all(union_leet_l, AMBIG_ALPHA): unclears.append(f"{label}:'{val}'")
    for label, val in find_all(union_raw_l,  AMBIG_DIGIT): unclears.append(f"{label}:'{val}'")

    # DE-CODE on-creative -> UNCLEAR-for-Adam-review (surface_handling.creative). The de-code spans
    # were masked out of the text above BEFORE the hard grep, so these flags are span-local and never
    # suppress a co-occurring standalone hard violation. family-grown never matches (not in the set).
    for dv in dict.fromkeys(decode_hits):
        unclears.append(f"de-code on-creative (Adam review):'{dv}'")

    if rec.get("low_conf"): unclears.append("low-confidence read")
    for reason in AUTHORITY_FORCE_UNCLEAR:
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

def meta_reconcile(v, fails, meta):
    m = (meta or "").upper()
    if v == "PASS" and "DISAPPROV" in m:
        return "FAIL", " | Meta-DISAPPROVED (scan missed) - inspect", True
    if v == "FAIL" and fails and ("ACTIVE" in m or "APPROVED" in m):
        return "FAIL", " | Meta currently ACTIVE - retro-disapproval risk", False
    if v == "FAIL" and not fails and ("ACTIVE" in m or "APPROVED" in m):
        return "UNCLEAR", " | judgment-only call, Meta ACTIVE - human eye", False
    return v, "", False

if __name__ == "__main__":
    ts = sys.argv[2] if len(sys.argv) > 2 else "2026-06-10 PT"
    out=[]
    for line in open(sys.argv[1]):
        line=line.strip()
        if not line: continue
        rec=json.loads(line)
        v, ev, fails, unclears = verdict_for(rec)
        grep_fails = [f for f in fails if not f.startswith("M-19d")]
        v2, note, learn = meta_reconcile(v, grep_fails, rec.get("meta",""))
        if v2 != v or note:
            ev = ev + note; v = v2
        cell = f"{v} (creative v2.1 {ts}) - {ev}"
        if rec.get("asset")=="9x16": cell += " (9x16)"
        out.append({"row":rec["row"],"verdict":v,"cell":cell,"fileid":rec.get("fileid",""),
                    "evidence":ev,"meta":rec.get("meta",""),"asset":rec.get("asset",""),
                    "bud_plant":(rec.get("bud_plant","no") or "no").lower(),
                    "leaf_icon":(rec.get("leaf_icon","no") or "no").lower(),
                    "text_verdict":v})
    json.dump(out, open(sys.argv[1].replace(".jsonl","_verdicts.json"),"w"), indent=0)
    from collections import Counter
    c=Counter(o["verdict"] for o in out)
    print(f"{len(out)} verdicts:", dict(c))
