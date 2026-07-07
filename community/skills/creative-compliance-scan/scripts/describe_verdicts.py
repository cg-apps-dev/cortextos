import json, re, sys
# Plain-English reason map (additive display layer; does NOT change detection/verdicts).
def reason(label, term):
    l = label.lower(); t = (term or "").lower()
    def has(*xs): return any(x in l or x in t for x in xs)
    if has("delivery-time","72 hour","48 hour","24 hour","72 hours","48 hours","24 hours"):
        return f'M-2: banned specific delivery-time claim ("{term}") - use "delivered fast", no number'
    if has("batch","lab-tested","lab tested","independently tested","third-party","test results","certificate of analysis","coa"):
        return f'M-2: lab/potency-testing language ("{term}") - implies controlled-substance testing'
    if "discreet" in t or "plain box" in t or "plain mail" in t:
        return f'M-2: "{term}" - concealment/discreet-shipping language'
    if "social-proof" in l or "16a" in l:
        return f'M-16a: specific customer/review count ("{term}") - use "thousands of" instead'
    if "no-medical-card" in l or "no medical card" in t:
        return f'M-2: "{term}" - controlled-substance implication'
    if "legal" in l or has("agriculture act","farm bill","illegal","dea"):
        return f'M-2: legality/legal-status claim ("{term}")'
    if "bud/flower" in l or "bud" == t or t in ("flower","flowers","cannabis","marijuana","weed","thc","thca","cbd","hemp","strain","strains","nug","nugs","dank","ganja","reefer"):
        return f'M-2: cannabis/product term ("{term}") on the creative'
    if "preroll" in l or "handroll" in l or "preroll" in t or re.search(r'\d\s*g\b', t):
        return f'M-2: strain/gram/preroll text on packaging ("{term}")'
    if "strain" in l or "strain" in t:
        return f'M-2: strain name/label shown ("{term}")'
    if "m-4" in l or "health" in l:
        return f'M-4: health/medical-benefit claim ("{term}")'
    if "m-5" in l:
        return f'M-5: side-effect-absence claim ("{term}")'
    if "m-8" in l or "press" in l:
        return f'M-8: unverified press/authority mention ("{term}")'
    if "m-13" in l:
        return f'M-13: sleep-outcome claim ("{term}") - gummies'
    if "m-12" in l:
        return f'M-12: diagnostic question ("{term}")'
    if "de-code" in l or "m-19" in l:
        m19 = re.search(r'm-19[a-z]?', l)
        code = (m19.group(0)[0].upper()+m19.group(0)[1:]) if m19 else "M-19f"
        return f'{code}: cannabis-coded/de-code phrasing ("{term}") - needs your review'
    if "m-25" in l or "scam" in l:
        return f'M-25: scam/fake/disparagement language ("{term}")'
    if "m-20" in l:
        return f'M-20: competitor-superiority claim ("{term}")'
    if "warning" in t or "urgent" in t or "m-16" in l:
        return f'M-16: fear/urgency trigger ("{term}")'
    # Fallback: derive the M-code from the label prefix so NO cell is ever a bare
    # terse label (Adam HARD RULE 2026-07-07). grep_verdict labels always lead with
    # their M-code (e.g. "M-2 dispensary", "M-19d", "M-16a social-proof-count"), so
    # this keeps M-code + a plain reason token + the exact phrase even for labels not
    # yet curated above (covers M-2 dispensary / M-2 no-chemicals / M-2 4/20 / M-19d).
    mc = re.match(r'\s*(M-\d+[a-z]?)\b', label, re.I)
    if mc:
        code = mc.group(1)[0].upper()+mc.group(1)[1:]  # preserve subletter case (M-19d, M-16a)
        desc = label[mc.end():].strip(" :-_/") or "flagged phrase"
        return f'{code}: {desc} ("{term}")'
    return f'{label}: flagged ("{term}")'

def parse_fail(f):
    m = re.match(r"^(.*?):'(.*)'$", f)
    if m: return m.group(1), m.group(2)
    return f, ""

# ---- CLI: translate a grep_verdict *_verdicts.json into human-readable col-B cells ----
# Additive DISPLAY layer only - never changes detection/verdicts (mc-owned grep_verdict.py).
# Usage: python3 describe_verdicts.py <verdicts.json> [YYYY-MM-DD]  -> prints {row: cell} JSON
def build_cell(o, ts):
    fails=[f for f in (o.get('evidence','')).split("; ") if f and ":'" in f]
    reasons=list(dict.fromkeys(reason(*parse_fail(f)) for f in fails))
    v=o.get('verdict','')
    if v=="PASS" or not reasons:
        body=o.get('evidence') or 'clean: no banned text/imagery'
        cell=f"{v} - {body}"
    else:
        cell=f"{v} - " + "; ".join(reasons)
    cell+=f" · scanned {ts} (VO audio+frames)" if o.get('asset')=="9x16" else f" · scanned {ts}"
    if o.get('asset')=="9x16": cell+=" (9x16)"
    # em-dash guard (fleet hard rule): never emit an em dash
    cell=cell.replace("—","-")
    return cell

if __name__ == "__main__":
    import json as _j
    data=_j.load(open(sys.argv[1]))
    ts=sys.argv[2] if len(sys.argv)>2 else "scan"
    out={str(o['row']): build_cell(o, ts) for o in data}
    print(_j.dumps(out, indent=0, ensure_ascii=False))
