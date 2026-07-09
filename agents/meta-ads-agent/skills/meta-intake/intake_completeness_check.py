#!/usr/bin/env python3
"""
intake_completeness_check.py - machine-checkable post-intake completeness gate.

Enforcement (NOT prose) for the "every image row must have a col-A =IMAGE preview"
hard rule + the other required intake/vision columns. Run this BEFORE flipping a
ClickUp card to posted-to-sheet. On the bearer/no-engine gog path (engine.py not
available) this is the backstop that the engine's built-in col-A step would provide.

Root-cause it closes (2026-07-09, Adam accuracy directive via sop-keeper): a manual
gog intake wrote rows without the col-A =IMAGE preview and the verify step never
asserted it, so blank previews reached the sheet. This gate fails loud on that.

Checks per row (header-resolved by NAME, never hardcoded letters):
  - PREVIEW (col A): FORMULA render must start with "=IMAGE("; the embedded
    thumbnail file-id must curl 200 image/* (so it actually renders, not just present).
  - Code, ClickUp Card ID, 1x1, 9x16: non-blank.
  - Actor Age Bracket, Gender: non-blank (vision completion gate, Adam 2026-06-04).
Copy/avatar/funnel are Stage-2 lanes and are NOT gated here (separate check).

Usage:
  python3 intake_completeness_check.py "<Tab>" <row1,row2,...> \
      [--ss <spreadsheet_id>] [--account <email>] [--no-thumb]
Exit code 0 = all rows complete; 1 = one or more rows incomplete (details on stdout).
"""
import sys, subprocess, re, argparse, urllib.request

SS_DEFAULT = "1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"
ACCT_DEFAULT = "adam@cleangreen.com"

# Required column HEADER NAMES (resolved live against row 1). PREVIEW is col A by
# position (its header label varies: "PREVIEW"/"Preview"), so it is checked by index 0.
REQUIRED_HEADERS = ["Code", "ClickUp Card ID", "1x1", "9x16", "Actor Age Bracket", "Gender"]


def gog_get(ss, rng, account, render=None):
    cmd = ["gog", "sheets", "get", ss, rng, "-a", account, "-p"]
    if render:
        cmd += ["--render", render]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout.rstrip("\n")
    return out


def col_letter(i):
    n, s = i, ""
    while True:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


def thumb_ok(fileid):
    url = f"https://drive.google.com/thumbnail?id={fileid}&sz=w1000"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req, timeout=20) as r:
            ct = r.headers.get("Content-Type", "")
            return r.status == 200 and ct.startswith("image/"), f"{r.status} {ct}"
    except Exception as e:
        return False, f"fetch-error {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tab")
    ap.add_argument("rows", help="comma-separated row numbers")
    ap.add_argument("--ss", default=SS_DEFAULT)
    ap.add_argument("--account", default=ACCT_DEFAULT)
    ap.add_argument("--no-thumb", action="store_true", help="skip the thumbnail 200 fetch (formula-only)")
    a = ap.parse_args()
    rows = [int(r) for r in a.rows.split(",") if r.strip()]

    # Resolve required header -> column letter live
    hdr = gog_get(a.ss, f"{a.tab}!1:1", a.account).split("\t")
    hmap = {}
    for name in REQUIRED_HEADERS:
        idx = next((i for i, h in enumerate(hdr) if h.strip() == name), None)
        if idx is None:
            print(f"HALT: required header '{name}' not found in row 1 of '{a.tab}' - column renamed/removed?")
            sys.exit(2)
        hmap[name] = col_letter(idx)

    all_ok = True
    for row in rows:
        problems = []
        # col A preview (FORMULA render)
        a_formula = gog_get(a.ss, f"{a.tab}!A{row}", a.account, render="FORMULA")
        if not a_formula.startswith("=IMAGE("):
            problems.append(f"PREVIEW(A) missing/not =IMAGE [{a_formula[:30] or 'blank'}]")
        elif not a.no_thumb:
            m = re.search(r"id=([A-Za-z0-9_\-]+)", a_formula)
            if not m:
                problems.append("PREVIEW(A) =IMAGE has no id=<fileid>")
            else:
                ok, detail = thumb_ok(m.group(1))
                if not ok:
                    problems.append(f"PREVIEW(A) thumbnail not rendering [{detail}]")
        # required non-blank cells
        for name, letter in hmap.items():
            v = gog_get(a.ss, f"{a.tab}!{letter}{row}", a.account)
            if v == "No data found" or not v.strip():
                problems.append(f"{name}({letter}) blank")
        if problems:
            all_ok = False
            print(f"row {row}: INCOMPLETE -> " + "; ".join(problems))
        else:
            print(f"row {row}: complete")

    print(f"\nRESULT: {'ALL COMPLETE' if all_ok else 'INCOMPLETE - do NOT flip card to posted'}")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
