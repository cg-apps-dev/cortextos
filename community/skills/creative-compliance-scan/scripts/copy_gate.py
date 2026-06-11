#!/usr/bin/env python3
"""Corrected gate: word-bans on leet-normalized text, NUMBER-bans on RAW text.
Fixes the digit-masking bug (leet 0->o/1->i/4->a... destroyed 420 + social-proof#)."""
import json, re
LEET=str.maketrans({'0':'o','1':'i','3':'e','4':'a','5':'s','@':'a','$':'s'})
def leetnorm(t): return re.sub(r'[ \t]+',' ',(t or "").lower().translate(LEET))
def rawnorm(t): return re.sub(r'[ \t]+',' ',(t or "").lower())

# WORD bans (run on leet text) - alpha de-obfuscation matters here
WORD_HARD=[
 ("em-dash", re.compile(r'—')),
 ("M-2 product", re.compile(r'\b(buds?|flowers?|cannabis|marijuana|weed|thca?|cbd|hemp|pre-?rolls?|hands?[- ]?roll(s|ed|ing|er)?|strains?|dispensar(y|ies)|nugs?|dank|ganja|reefer)\b')),
 ("M-2 legality", re.compile(r'\b(illegal(ly)?|legal(ly|ity)?|federally compliant|federally legal|farm bill|package seizure|\bdea\b)\b')),
 ("M-2 stealth", re.compile(r'no medical card|plain (box|mail|packaging)|\bdiscree?t(ly)?\b|\bmedical\b')),
 ("M-4 lab", re.compile(r'lab[- ]?tested|third[- ]?party tested|no chemicals')),
 ("M-25 scam", re.compile(r'\b(scam(med|my)?|rip-?off|fakes?|faking|faked|fraud(ulent)?|counterfeit|knock-?off|bogus|hoax)\b|too good to be true')),
 ("M-19e leaf-emoji", re.compile(r'🌿|🍃')),
 ("M-24 brand-claim", re.compile(r'clean ?green')),
 ("M-13 sleep-onset", re.compile(r'fall asleep|asleep all night|sleep through the night|slept through the night|drift off|wake up rested|stay(s|ed)? asleep|natural sleep aid|non[- ]?habit[- ]?forming|asleep by \d')),
 ("M-5 sideeffect", re.compile(r'no grogginess|no morning fog|without grog|zero grog|morning fog')),
 ("M-4 medical", re.compile(r'\binsomnia\b|\banxiety\b|\bstress\b|\bcure[sd]?\b|\btreat(s|ment|ed)?\b')),
]
# NUMBER bans (run on RAW text) - the bug fix
NUM_HARD=[
 ("M-2 4/20", re.compile(r'\b4\s*[:/]\s*20\b|\b420\b')),
 ("M-2 delivery-time-guarantee", re.compile(r'deliver\w*\s+in\s+\d+\s*(hours?|days?)|\d+[- ]?(hour|day)[- ]?(delivery|shipping)|\b(24|48|72)[- ]?hours?\b')),
 ("M-16 outcome-timing", re.compile(r'\b8\s*hours?\b|asleep in \d+\s*min|knocked? (you |me )?out in \d|results? in \d+\s*days?|out by \d+|asleep by \d+')),
]
NUM_REVIEW=[
 ("M-6 social#", re.compile(r'(?<![\$])\b\d[\d,]*[ ]*\+?[ ]*(?:\w+[ ]+)?(customers?|reviews?|people|orders?|families|sleepers?|users?|five[- ]star)\b')),
 ("rating#", re.compile(r'\b\d(?:\.\d)?\s*/\s*5\b|\b\d(?:\.\d)?\s*stars?\b')),
 ("vague-mass", re.compile(r'\b(thousands|hundreds|millions) of\b')),
 ("dur-attributed", re.compile(r'\b\d+\s*(hours?|nights?)\s+(straight|in a row)\b')),
]
WORD_REVIEW=[
 ("M-4 relief", re.compile(r'\brelief\b|feel like yourself|feel the difference|fixed (my|her|your) |changed (my|her|your) (life|evening|night)')),
 ("M-5 fog/grog", re.compile(r'\bfoggy\b|\bfog\b|\bgrog\b|grogg|clear morning')),
 ("M-20 comparison", re.compile(r'stronger than|more potent|higher.?quality than|not weak|not gas station|quality than')),
 ("M-8 press", re.compile(r'as seen (on|in)|as featured|featured (on|by)|recognized by')),
]
def scan(cells):
    lt=leetnorm("\n".join(cells)); rt=rawnorm("\n".join(cells))
    hard=[]; rev=[]
    for lbl,rx in WORD_HARD:
        m=rx.search(lt)
        if m: hard.append(f"{lbl}:'{m.group(0)}'")
    for lbl,rx in NUM_HARD:
        m=rx.search(rt)
        if m: hard.append(f"{lbl}:'{m.group(0)}'")
    for lbl,rx in NUM_REVIEW:
        m=rx.search(rt)
        if m:
            s=max(0,m.start()-12)
            if lbl=="M-6 social#" and re.search(r'over \$|\$\d', rt[s:m.end()+3]): continue
            rev.append(f"{lbl}:'{m.group(0).strip()}'")
    for lbl,rx in WORD_REVIEW:
        m=rx.search(lt)
        if m: rev.append(f"{lbl}:'{m.group(0)}'")
    return hard,rev

if __name__=="__main__":
    write=json.load(open('write_set.json'))
    hf=[]; rf=[]; clean=[]
    for row,r in write.items():
        h,rev=scan(r['headlines']+r['bodies'])
        for b in r['bodies']:
            if '\n' in b and '\n\n' not in b:
                rev.append("FORMAT paragraph-spacing:'body has single newlines only - needs blank lines between paragraphs'"); break
        for hl in r['headlines']:
            if '\n' in hl:
                rev.append("FORMAT headline-newline:'headline contains a newline'"); break
        if h: hf.append((int(row),r['product'],h))
        elif rev: rf.append((int(row),r['product'],rev))
        else: clean.append(int(row))
    print(f"CORRECTED GATE on {len(write)} write rows: clean={len(clean)} HARD={len(hf)} REVIEW={len(rf)}")
    flagged=sorted(set([x[0] for x in hf]+[x[0] for x in rf]))
    print("flagged rows:",len(flagged))
    print("HARD:"); [print("  ",x) for x in sorted(hf)]
    print("REVIEW:"); [print("  ",x) for x in sorted(rf)]
    json.dump({"clean":sorted(clean),"flagged":flagged}, open('gate2_split.json','w'))
