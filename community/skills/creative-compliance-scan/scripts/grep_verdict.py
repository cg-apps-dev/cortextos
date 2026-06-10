#!/usr/bin/env python3
"""Deterministic verdict engine for creative-compliance-scan v2.1 (2026-06-10).
v2.1 fixes three audited defects of v2:
 (1) DIGIT FALSE-PASS: v2 leet-normalized (0->o,4->a,...) BEFORE matching, corrupting every
     digit pattern ("420"->"a2o", "60,000+ customers"->"6o,ooo+ customers"). v2.1 matches
     digit-bearing patterns on RAW lowered text; leet stays for alpha-only de-obfuscation.
 (2) FLOWER FALSE-FAIL: v2 FAILed on product words leaked from vision DESCRIPTIONS (category
     word "flower" on clean offer cards, rows 786-793). v2.1 requires CORROBORATION for
     single-token product bans: hit must appear in >=2 independent sources (vision pass 1,
     vision pass 2, OCR) to FAIL; single-source hit -> UNCLEAR (human eye), never FAIL.
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
  vision_text, [vision_text2 optional], ocr_text, bud_plant, leaf_icon, low_conf
"""
import json, re, sys

LEET = str.maketrans({'0':'o','1':'i','3':'e','4':'a','5':'s','@':'a','$':'s'})

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
 ("M-2 legality", re.compile(r'\b(illegal(ly)?|legal(ly|ity)|federally compliant|farm bill|agriculture act|package seizure|dea)\b')),
 ("M-2 no-medical-card", re.compile(r'no medical card')),
 ("M-2 plain-box/mail", re.compile(r'plain (box|mail|packaging|billing)')),
 ("M-2 discreet", re.compile(r'\bdiscree?t(ly)?\b')),
 ("M-2 medical(bare)", re.compile(r'\bmedical\b')),
 ("M-2/M-7 lab-claim", re.compile(r'lab[- ]?tested|third[- ]?party tested|certificate of analysis|\bcoa\b|no chemicals')),
 ("M-25 scam/fake", re.compile(r'\b(scam(med|my)?|rip[- ]?off|ripped off|fakes?|faking|faked|fraud(ulent)?|counterfeit|knock[- ]?off|bogus|hoax|swindle[ds]?|swindling|illegitimate)\b|too good to be true')),
]
# ---- DIGIT hard bans: matched on RAW lowered text (leet would corrupt them) ----
HARD_DIGIT = [
 ("M-2 4/20", re.compile(r'\b4\s*[:/]\s*20\b|\b420\b')),
 ("M-16 outcome-timing", re.compile(r'asleep in \d+\s*min|knocked? (you |me )?out in \d|results? in \d+\s*days?')),
]
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
 ("M-6 social-proof#", re.compile(r'(?<![\$])\b\d[\d,]*[ ]*\+?[ ]*(?:\w+[ ]+)?(customers?|reviews?|people|orders?|families|sleepers?|users?|five[- ]star)\b|\b\d(\.\d)?\s*/\s*5\b|\b\d(\.\d)?\s*stars?\b|\b\d+k\+?\s*(customers?|reviews?|people)\b|thousands of')),
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

def find_all(text, pats):
    hits=[]
    for label, rx in pats:
        for m in rx.finditer(text):
            # $-price guard for social-proof ("orders over $99")
            if label=="M-6 social-proof#":
                s=max(0,m.start()-12)
                if re.search(r'over \$|\$\d', text[s:m.end()+3]): continue
            hits.append((label, m.group(0)))
    return hits

def verdict_for(rec):
    product = rec.get("product","flower")
    vis  = rec.get("vision_text","") or ""
    vis2 = rec.get("vision_text2","") or ""
    ocr  = rec.get("ocr_text","") or ""
    if "DOWNLOAD_FAIL" in vis or vis.strip().upper().startswith("SCAN ERROR"):
        return "SCAN ERROR", "1x1 inaccessible (404/expired) - needs re-share", [], []
    sources = {"vision": vis, "vision2": vis2, "ocr": ocr}
    union_raw_l  = flat(raw_norm(vis+"\n"+vis2+"\n"+ocr))
    union_leet_l = flat(leet_norm(vis+"\n"+vis2+"\n"+ocr))

    fails=[]; unclears=[]

    # corroboration count per single-token product ban across independent sources
    def src_count(word):
        n=0
        for s in sources.values():
            if s and re.search(r'\b'+re.escape(word)+r'\b', leet_norm(s)): n+=1
        return n

    seen=set()
    for label, val in find_all(union_leet_l, HARD_ALPHA):
        base = re.sub(r'[^a-z]','',val.split()[0]) if val else ''
        tok = val.strip().lower()
        if tok in SINGLE_TOKEN_BANS or base in SINGLE_TOKEN_BANS:
            w = tok if tok in SINGLE_TOKEN_BANS else base
            if src_count(w) >= 2:
                fails.append(f"{label}:'{val}'")
            else:
                unclears.append(f"{label}(single-source, uncorroborated):'{val}' - verify on image")
            seen.add(w)
        else:
            fails.append(f"{label}:'{val}'")
    for label, val in find_all(union_raw_l, HARD_DIGIT):
        fails.append(f"{label}:'{val}'")

    # letterspace-collapsed evasion: also corroboration-gated
    readable = set(seen)
    for w in SINGLE_TOKEN_BANS:
        if re.search(r'\b'+re.escape(w)+r'\b', union_leet_l): readable.add(w)
    for line in leet_norm(vis+"\n"+vis2+"\n"+ocr).splitlines():
        for w in letterspace_collapse_words(line):
            if w in SINGLE_TOKEN_BANS and w not in readable:
                unclears.append(f"{SINGLE_TOKEN_LABEL.get(w,'M-2')}(despaced,single-source):'{w}' - verify on image")

    if product == "gummies":
        for label, val in find_all(union_leet_l, GUM_HARD_ALPHA): fails.append(f"{label}:'{val}'")
        for label, val in find_all(union_raw_l,  GUM_HARD_DIGIT): fails.append(f"{label}:'{val}'")
        for label, val in find_all(union_leet_l, GUM_AMBIG_ALPHA): unclears.append(f"{label}:'{val}'")

    for label, val in find_all(union_leet_l, AMBIG_ALPHA): unclears.append(f"{label}:'{val}'")
    for label, val in find_all(union_raw_l,  AMBIG_DIGIT): unclears.append(f"{label}:'{val}'")

    if rec.get("low_conf"): unclears.append("low-confidence read")

    fails = list(dict.fromkeys(fails)); unclears = list(dict.fromkeys(unclears))
    if fails:    v, ev = "FAIL", "; ".join(fails[:6])
    elif unclears: v, ev = "UNCLEAR", "; ".join(unclears[:5]) + "; needs human review"
    else:        v, ev = "PASS", "clean: no banned text, imagery clean"
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
