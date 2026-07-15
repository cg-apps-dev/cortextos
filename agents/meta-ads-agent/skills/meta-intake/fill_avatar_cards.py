#!/usr/bin/env python3
"""Auto-fill the Customer Avatar cell on the Meta Ads Upload Sheet from ClickUp.

Adam hard rule: the Customer Avatar comes ONLY from the ClickUp card's `Customer
Avatar` field (resolve_cards.py -> AVATAR_MAP) - NEVER guessed from the card name,
actor, angle, or creative. This sweep re-reads the card behind any sheet row that
has a blank Customer Avatar cell + a ClickUp Card ID, and fills the cell ONCE the
team has set the field on the card. It is the avatar analogue of
reconcile_writer_designer.py (which fills Writer/Designer) - same safe-direction
discipline:
  - only ever FILLS a blank Customer Avatar cell (never overwrites a set one),
  - only writes a value resolve_cards actually resolved from the FIELD (mapped
    AVATAR_MAP value); blank / "Multiple Avatars" / unmapped -> left blank (the
    card stays flagged via flag_avatar_cards.py for a human to set the field),
  - NEVER infers the avatar from the card name/creative.

Columns are HEADER-RESOLVED per tab at runtime (never hardcoded letters).
Dry-run by default; pass --write to apply.

Usage: python3 fill_avatar_cards.py [--write] [--since YYYY-MM-DD]
  --since limits to rows whose 'Added to Sheet' is on/after the date.
gog as adam@cleangreen.com.
"""
import os, sys, re, json, subprocess

SHEET = "1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"
ACCT = "adam@cleangreen.com"
HERE = os.path.dirname(os.path.abspath(__file__))
TABS = ["IMAGES (Flower)", "VIDEOS (Flower)", "IMAGES (Sleep Gummies)", "VIDEOS (Sleep Gummies)"]

def col_letter(i):
    s = ""; i += 1
    while i:
        i, r = divmod(i - 1, 26); s = chr(65 + r) + s
    return s

def gog_get(rng):
    out = subprocess.run(["gog", "sheets", "get", SHEET, rng, "-a", ACCT, "-j", "--results-only"],
                         capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(f"gog get {rng} failed: {out.stderr[:200]}")
    return json.loads(out.stdout or "[]")

def gog_batch(data):
    if not data: return 0
    out = subprocess.run(["gog", "sheets", "batch-update", SHEET, "--data-json=" + json.dumps(data), "-a", ACCT],
                         capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise RuntimeError(f"gog batch-update failed: {out.stderr[:300]}")
    return len(data)

def header_map(tab):
    row = gog_get(f"{tab}!1:1")
    hdr = row[0] if row else []
    return {(h or "").replace("\n", " ").strip().lower(): i for i, h in enumerate(hdr)}

def resolve_cards(card_ids):
    if not card_ids: return {}
    out = subprocess.run([sys.executable, os.path.join(HERE, "resolve_cards.py"), *card_ids],
                         capture_output=True, text=True, timeout=300)
    res = {}
    for ln in out.stdout.splitlines():
        try:
            o = json.loads(ln); res[o["card"]] = o
        except Exception: pass
    return res

def cid_of(url):
    m = re.search(r"/t/([A-Za-z0-9]+)", url or "") or re.search(r"([A-Za-z0-9]{6,})$", url or "")
    return m.group(1) if m else ""

def main():
    write = "--write" in sys.argv
    since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else None
    all_writes, residual = [], []
    for tab in TABS:
        H = header_map(tab)
        need = {"added": "added to sheet", "avatar": "customer avatar", "card": "clickup card id"}
        idx = {}
        missing = [name for k, name in need.items() if name not in H]
        if missing:
            print(f"  WARN {tab}: headers not found {missing} - skipping"); continue
        for k, name in need.items(): idx[k] = H[name]
        lo, hi = min(idx.values()), max(idx.values())
        rows = gog_get(f"{tab}!{col_letter(lo)}2:{col_letter(hi)}")
        off = {k: v - lo for k, v in idx.items()}
        g = lambda r, i: (r[i].strip() if 0 <= i < len(r) and r[i] else "")
        cand = []
        for ridx, r in enumerate(rows):
            added, av, card = g(r, off["added"]), g(r, off["avatar"]), g(r, off["card"])
            if since and (not added or added[:10] < since): continue
            if av: continue                       # already filled
            cid = cid_of(card)
            if not cid: continue                  # no card -> nothing to resolve
            cand.append({"row": ridx + 2, "card": cid})
        res = resolve_cards(sorted({x["card"] for x in cand}))
        acol = col_letter(idx["avatar"])
        for x in cand:
            av = (res.get(x["card"], {}) or {}).get("avatar", "")
            if av:
                all_writes.append({"range": f"{tab}!{acol}{x['row']}", "values": [[av]]})
            else:
                residual.append({"tab": tab, "row": x["row"], "card": x["card"]})
    print(f"{'FILLED' if write else 'WOULD FILL'}: {len(all_writes)} avatar cells")
    for w in all_writes: print("  ", w["range"], "=", w["values"][0][0])
    if write and all_writes:
        print(f"applied {gog_batch(all_writes)} cells")
    print(f"RESIDUAL (field still blank/unmapped - stays flagged for team): {len(residual)} rows")
    json.dump(residual, open("/tmp/fill_avatar_residual.json", "w"))

if __name__ == "__main__":
    main()
