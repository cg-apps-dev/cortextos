#!/usr/bin/env python3
"""Reconcile Writer/Designer initials on the Meta Ads Upload Sheet from ClickUp.

Adam HARD RULE 2026-06-28 (non-blocking): every row must carry Writer + Designer
initials. Intake never holds for a missing one; instead this sweep re-reads the
ClickUp card behind any sheet row with a blank Writer or Designer and fills the
cell once the team has assigned the person. It also applies the standing
conventions so convention-covered cards never need a human:

    MB_CG_IMG_*  ->  Writer = MB (Mason Blair),  Designer = TS (Tatsiana)

Deterministic + safe-direction: it only ever FILLS a blank cell (never overwrites
an existing initial), and only writes a value the resolver/convention actually
produced. Dry-run by default; pass --write to apply.

Usage:
    python3 reconcile_writer_designer.py [--write] [--since YYYY-MM-DD]
        --since limits to rows whose 'Added to Sheet' (col D) is on/after the date
        (default: no date filter - sweeps the whole active tab).

Reads the same deterministic resolver fields as resolve_cards.py (Brief Writer /
Designer-Editor custom fields -> initials). gog as adam@cleangreen.com.
"""
import os, sys, re, json, subprocess

SHEET = "1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"
ACCT = "adam@cleangreen.com"
HERE = os.path.dirname(os.path.abspath(__file__))

# Per-tab column letters (header-verified 2026-06-28). (added, id/code, writer, designer, cardid)
TABS = {
    "IMAGES (Flower)":        {"added":"D","writer":"R","designer":"S","card":"T","key":"P"},
    "VIDEOS (Flower)":        {"added":"D","writer":"T","designer":"U","card":"V","key":"P"},
    "IMAGES (Sleep Gummies)": {"added":"D","writer":"J","designer":"K","card":"L","key":"H"},
    "VIDEOS (Sleep Gummies)": {"added":"D","writer":"L","designer":"M","card":"N","key":"H"},
}

def col_to_idx(letter):
    i = 0
    for ch in letter: i = i*26 + (ord(ch)-64)
    return i-1

def gog_get(rng):
    out = subprocess.run(["gog","sheets","get",SHEET,rng,"-a",ACCT,"-j","--results-only"],
                         capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(f"gog get {rng} failed: {out.stderr[:200]}")
    return json.loads(out.stdout or "[]")

def gog_batch(data):
    if not data: return 0
    out = subprocess.run(["gog","sheets","batch-update",SHEET,"--data-json="+json.dumps(data),"-a",ACCT],
                         capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise RuntimeError(f"gog batch-update failed: {out.stderr[:300]}")
    return len(data)

def resolve_cards(card_ids):
    """Call resolve_cards.py -> {card_id: {'writer','designer','name'}}."""
    if not card_ids: return {}
    out = subprocess.run([sys.executable, os.path.join(HERE,"resolve_cards.py"), *card_ids],
                         capture_output=True, text=True, timeout=300)
    res = {}
    for ln in out.stdout.splitlines():
        try:
            o = json.loads(ln); res[o["card"]] = o
        except Exception: pass
    return res

def conv(name):
    """Standing conventions -> (writer, designer) defaults, '' where none."""
    if (name or "").startswith("MB_CG_IMG"):
        return "MB","TS"
    return "",""

def cid_of(url):
    m = re.search(r"/t/([A-Za-z0-9]+)", url) or re.search(r"([A-Za-z0-9]{6,})$", url or "")
    return m.group(1) if m else ""

def main():
    write = "--write" in sys.argv
    since = None
    if "--since" in sys.argv:
        since = sys.argv[sys.argv.index("--since")+1]

    all_writes, residual = [], []
    for tab, c in TABS.items():
        lo = min(col_to_idx(c[k]) for k in ("added","writer","designer","card","key"))
        hi = max(col_to_idx(c[k]) for k in ("added","writer","designer","card","key"))
        loL = chr(65+lo) if lo < 26 else None  # all our cols are A-Z single-letter
        rng = f"{tab}!{chr(65+lo)}2:{chr(65+hi)}"
        rows = gog_get(rng)
        ai, wi, di, ci = (col_to_idx(c["added"])-lo, col_to_idx(c["writer"])-lo,
                          col_to_idx(c["designer"])-lo, col_to_idx(c["card"])-lo)
        # collect candidate rows (blank W or D, has card)
        cand = []
        for idx, r in enumerate(rows):
            g = lambda i: (r[i].strip() if i < len(r) and r[i] else "")
            added, w, d, card = g(ai), g(wi), g(di), g(ci)
            if since and (not added or added[:10] < since): continue
            if (w and d) or not card: continue
            cand.append({"row":idx+2,"w":w,"d":d,"card":cid_of(card)})
        res = resolve_cards(sorted({x["card"] for x in cand if x["card"]}))
        for x in cand:
            rv = res.get(x["card"], {})
            cw, cd = conv(rv.get("name",""))
            new_w = x["w"] or rv.get("writer","") or cw
            new_d = x["d"] or rv.get("designer","") or cd
            if not x["w"] and new_w:
                all_writes.append({"range":f"{tab}!{c['writer']}{x['row']}","values":[[new_w]]})
            if not x["d"] and new_d:
                all_writes.append({"range":f"{tab}!{c['designer']}{x['row']}","values":[[new_d]]})
            if not new_w or not new_d:
                residual.append({"tab":tab,"row":x["row"],"card":x["card"],
                                 "need_w":not new_w,"need_d":not new_d,"name":rv.get("name","")})

    print(f"{'WOULD FILL' if not write else 'FILLED'}: {len(all_writes)} cells")
    for w in all_writes: print("  ", w["range"], "=", w["values"][0][0])
    if write and all_writes:
        n = gog_batch(all_writes); print(f"applied {n} cells")
    print(f"RESIDUAL (still blank after resolve+conventions): {len(residual)} rows")
    by = {}
    for r in residual:
        k = r["card"]; by.setdefault(k,{"name":r["name"],"tab":r["tab"],"rows":[],"need_w":False,"need_d":False})
        by[k]["rows"].append(r["row"]); by[k]["need_w"]|=r["need_w"]; by[k]["need_d"]|=r["need_d"]
    for cid,g in sorted(by.items(), key=lambda x:x[1]["tab"]):
        miss = "W+D" if g["need_w"] and g["need_d"] else ("WRITER" if g["need_w"] else "DESIGNER")
        print(f"  [{g['tab']}] rows {min(g['rows'])}-{max(g['rows'])} miss:{miss} {g['name'][:40]} t/{cid}")
    json.dump(residual, open("/tmp/reconcile_wd_residual.json","w"))

if __name__ == "__main__":
    main()
