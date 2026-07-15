#!/usr/bin/env python3
"""Reconcile Writer/Designer initials on the Meta Ads Upload Sheet from ClickUp.

Adam HARD RULE 2026-06-28 (non-blocking): every row must carry Writer + Designer
initials. Intake never holds for a missing one; instead this sweep re-reads the
ClickUp card behind any sheet row with a blank Writer or Designer and fills the
cell once the team has assigned the person. It also applies the standing
conventions so convention-covered cards never need a human:

    MB_CG_IMG_*  ->  Writer = MB (Mason Blair),  Designer = TS (Tatsiana)

The MB_CG_IMG convention keys off BOTH the resolved card name AND the sheet's
Code/Variant cell (Code like `IMG_565_V1` == the MB_CG_IMG series) so it still
applies when a row has no ClickUp Card ID (manual / card-less MB_CG_IMG rows).

Columns are HEADER-RESOLVED per tab at runtime (never hardcoded letters) - the
sheet's column layout drifts (the Flower tabs shifted +2 on ~2026-07; the
hardcoded-letter version silently misread and produced false residuals).

Deterministic + safe-direction: it only ever FILLS a blank cell (never overwrites
an existing initial), and only writes a value the resolver/convention actually
produced. Dry-run by default; pass --write to apply.

Usage:
    python3 reconcile_writer_designer.py [--write] [--since YYYY-MM-DD]
        --since limits to rows whose 'Added to Sheet' is on/after the date
        (default: no date filter - sweeps the whole active tab).

Reads the same deterministic resolver fields as resolve_cards.py (Brief Writer /
Designer-Editor custom fields -> initials). gog as adam@cleangreen.com.
"""
import os, sys, re, json, subprocess

SHEET = "1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"
ACCT = "adam@cleangreen.com"
HERE = os.path.dirname(os.path.abspath(__file__))

# The 4 active tabs. Per-tab the "key" header is the Code (images) or Variant # (videos).
TABS = {
    "IMAGES (Flower)":        "Code",
    "VIDEOS (Flower)":        "Variant #",
    "IMAGES (Sleep Gummies)": "Code",
    "VIDEOS (Sleep Gummies)": "Variant #",
}

def col_letter(i):
    s = ""; i += 1
    while i:
        i, r = divmod(i - 1, 26); s = chr(65 + r) + s
    return s

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

def header_map(tab):
    """Resolve {header_name_lower: index} from the tab's row 1 (drift-proof)."""
    row = gog_get(f"{tab}!1:1")
    hdr = row[0] if row else []
    return {(h or "").replace("\n", " ").strip().lower(): i for i, h in enumerate(hdr)}

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

def conv(name, code):
    """Standing conventions -> (writer, designer) defaults, '' where none.
    Keys off the card NAME or the sheet CODE. Designer '=WRITER' is a sentinel the
    caller resolves to the row's writer value."""
    n = (name or "")
    if n.startswith("MB_CG_IMG") or re.match(r"(MB_CG_)?IMG_\d+", code or ""):
        return "MB", "TS"
    # Self-finished dance / Gridbank short-form (team-lead 2026-07-13): editor-less
    # BY DESIGN (no editor step is the whole point of the format), so Designer = Writer
    # (whoever wrote it, not hardcoded Sam). Auto-fills the missing-designer default.
    # Exception is automatic: if a real Designer/Editor is ever set (card or sheet), it
    # wins by precedence (card/sheet designer is checked BEFORE this convention default).
    if re.search(r"short dancing ad|dancing ad|gridbank", n, re.I):
        return "", "=WRITER"
    return "", ""

def cid_of(url):
    m = re.search(r"/t/([A-Za-z0-9]+)", url) or re.search(r"([A-Za-z0-9]{6,})$", url or "")
    return m.group(1) if m else ""

def main():
    write = "--write" in sys.argv
    since = None
    if "--since" in sys.argv:
        since = sys.argv[sys.argv.index("--since") + 1]

    all_writes, residual = [], []
    for tab, keyname in TABS.items():
        H = header_map(tab)
        need = {"added": "added to sheet", "writer": "writer", "designer": "designer",
                "card": "clickup card id", "key": keyname.lower()}
        idx = {}
        missing_hdr = []
        for k, name in need.items():
            if name in H: idx[k] = H[name]
            else: missing_hdr.append(name)
        if missing_hdr:
            print(f"  WARN {tab}: headers not found {missing_hdr} - skipping tab")
            continue
        lo, hi = min(idx.values()), max(idx.values())
        rows = gog_get(f"{tab}!{col_letter(lo)}2:{col_letter(hi)}")
        off = {k: v - lo for k, v in idx.items()}
        g = lambda r, i: (r[i].strip() if i < len(r) and r[i] else "")
        cand = []
        for ridx, r in enumerate(rows):
            added, w, d, card, code = (g(r, off["added"]), g(r, off["writer"]), g(r, off["designer"]),
                                       g(r, off["card"]), g(r, off["key"]))
            if since and (not added or added[:10] < since): continue
            if w and d: continue          # already complete
            cand.append({"row": ridx + 2, "w": w, "d": d, "card": cid_of(card), "code": code})
        res = resolve_cards(sorted({x["card"] for x in cand if x["card"]}))
        wcol, dcol = col_letter(idx["writer"]), col_letter(idx["designer"])
        for x in cand:
            rv = res.get(x["card"], {})
            cw, cd = conv(rv.get("name", ""), x["code"])
            new_w = x["w"] or rv.get("writer", "") or (cw if cw != "=WRITER" else "")
            if cd == "=WRITER":            # self-finished dance: designer = the row's writer
                cd = new_w
            new_d = x["d"] or rv.get("designer", "") or cd
            if not x["w"] and new_w:
                all_writes.append({"range": f"{tab}!{wcol}{x['row']}", "values": [[new_w]]})
            if not x["d"] and new_d:
                all_writes.append({"range": f"{tab}!{dcol}{x['row']}", "values": [[new_d]]})
            if not new_w or not new_d:
                residual.append({"tab": tab, "row": x["row"], "card": x["card"],
                                 "need_w": not new_w, "need_d": not new_d,
                                 "name": rv.get("name", "") or x["code"]})

    print(f"{'FILLED' if write else 'WOULD FILL'}: {len(all_writes)} cells")
    for w in all_writes: print("  ", w["range"], "=", w["values"][0][0])
    if write and all_writes:
        n = gog_batch(all_writes); print(f"applied {n} cells")
    print(f"RESIDUAL (still blank after resolve+conventions): {len(residual)} rows")
    by = {}
    for r in residual:
        k = r["card"] or f"{r['tab']}:{r['name']}"
        by.setdefault(k, {"name": r["name"], "tab": r["tab"], "rows": [], "need_w": False, "need_d": False})
        by[k]["rows"].append(r["row"]); by[k]["need_w"] |= r["need_w"]; by[k]["need_d"] |= r["need_d"]
    for cid, gg in sorted(by.items(), key=lambda x: x[1]["tab"]):
        miss = "W+D" if gg["need_w"] and gg["need_d"] else ("WRITER" if gg["need_w"] else "DESIGNER")
        print(f"  [{gg['tab']}] rows {min(gg['rows'])}-{max(gg['rows'])} miss:{miss} {gg['name'][:40]} {cid}")
    json.dump(residual, open("/tmp/reconcile_wd_residual.json", "w"))

if __name__ == "__main__":
    main()
