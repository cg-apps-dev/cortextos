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
  - Image rows: Code, ClickUp Card ID, 1x1, 9x16, Actor Age Bracket, Gender: non-blank.
  - Video rows: Variant #, Actor, Hook #, ClickUp Card ID, 4x5, 9x16, Actor Age Bracket, Gender: non-blank.
  - Video rows: Ad Name rendered value must be non-empty, not a formula error, and contain Variant #.
Copy/avatar/funnel are Stage-2 lanes and are NOT gated here (separate check).

Usage:
  python3 intake_completeness_check.py "<Tab>" <row1,row2,...> \
      [--ss <spreadsheet_id>] [--account <email>] [--no-thumb]
Exit code 0 = all rows complete; 1 = one or more rows incomplete (details on stdout).
"""
import sys, subprocess, re, argparse, time, urllib.request

SS_DEFAULT = "1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"
ACCT_DEFAULT = "adam@cleangreen.com"

# Required column HEADER NAMES (resolved live against row 1). PREVIEW is col A by
# position (its header label varies: "PREVIEW"/"Preview"), so it is checked by index 0.
IMAGE_REQUIRED_HEADERS = ["Code", "ClickUp Card ID", "1x1", "9x16", "Actor Age Bracket", "Gender"]
VIDEO_REQUIRED_HEADERS = ["Variant #", "Actor", "Hook #", "ClickUp Card ID", "4x5", "9x16", "Actor Age Bracket", "Gender"]
FORMULA_ERROR_RE = re.compile(r"^(#REF!|#N/A|#ERROR!|#VALUE!|#NAME\?|Loading\.\.\.)", re.I)
TRANSIENT_ERROR_RE = re.compile(r"429|rate|quota|rateLimitExceeded|userRateLimit|backendError|internal|50[0-9]|try again", re.I)


def gog_get(ss, rng, account, render=None):
    cmd = ["gog", "sheets", "get", ss, rng, "-a", account, "-p"]
    if render:
        cmd += ["--render", render]
    last = None
    for attempt in range(3):
        last = subprocess.run(cmd, capture_output=True, text=True)
        if last.returncode == 0:
            return last.stdout.rstrip("\n")
        detail = (last.stderr or last.stdout or "").strip()
        if not TRANSIENT_ERROR_RE.search(detail) or attempt == 2:
            raise RuntimeError(f"gog read failed for {rng} (rc={last.returncode}): {detail[:200]}")
        time.sleep(1.5 * (attempt + 1))
    detail = ((last.stderr or last.stdout or "") if last else "").strip()
    raise RuntimeError(f"gog read failed for {rng} (rc={last.returncode if last else 'unknown'}): {detail[:200]}")


def col_letter(i):
    n, s = i, ""
    while True:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


def col_index(letter):
    n = 0
    for ch in letter:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def detect_schema(hdr):
    is_video = "Variant #" in hdr and "4x5" in hdr
    is_image = "Code" in hdr and "1x1" in hdr
    if is_video == is_image:
        return None
    return "video" if is_video else "image"


def required_headers_for(schema):
    return VIDEO_REQUIRED_HEADERS if schema == "video" else IMAGE_REQUIRED_HEADERS


def header_map(hdr, names):
    hmap = {}
    for name in names:
        idx = next((i for i, h in enumerate(hdr) if h.strip() == name), None)
        if idx is None:
            raise KeyError(name)
        hmap[name] = col_letter(idx)
    return hmap


def header_indexes(hdr, names):
    imap = {}
    for name in names:
        idx = next((i for i, h in enumerate(hdr) if h.strip() == name), None)
        if idx is None:
            raise KeyError(name)
        imap[name] = idx
    return imap


def thumb_ok(fileid):
    url = f"https://drive.google.com/thumbnail?id={fileid}&sz=w1000"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req, timeout=20) as r:
            ct = r.headers.get("Content-Type", "")
            return r.status == 200 and ct.startswith("image/"), f"{r.status} {ct}"
    except Exception as e:
        return False, f"fetch-error {e}"


def row_cells(row_text):
    if row_text == "No data found":
        return []
    return row_text.split("\t")


def check_row(tab, row, schema, hmap, getter, account, no_thumb=False, ss=None, imap=None):
    problems = []
    # col A preview (FORMULA render)
    a_formula = getter(ss, f"{tab}!A{row}", account, render="FORMULA")
    if not a_formula.startswith("=IMAGE("):
        problems.append(f"PREVIEW(A) missing/not =IMAGE [{a_formula[:30] or 'blank'}]")
    elif not no_thumb:
        m = re.search(r"id=([A-Za-z0-9_\-]+)", a_formula)
        if not m:
            problems.append("PREVIEW(A) =IMAGE has no id=<fileid>")
        else:
            ok, detail = thumb_ok(m.group(1))
            if not ok:
                problems.append(f"PREVIEW(A) thumbnail not rendering [{detail}]")

    values = {}
    cells = row_cells(getter(ss, f"{tab}!{row}:{row}", account))
    # required non-blank cells
    for name, letter in hmap.items():
        if schema == "video" and name == "Ad Name":
            continue
        idx = imap[name] if imap is not None else col_index(letter)
        v = cells[idx] if idx < len(cells) else ""
        values[name] = v
        if v == "No data found" or not v.strip():
            problems.append(f"{name}({letter}) blank")

    if schema == "video":
        ad_letter = hmap["Ad Name"]
        variant = values.get("Variant #", "")
        rendered = getter(ss, f"{tab}!{ad_letter}{row}", account, render="FORMATTED_VALUE")
        if not rendered.strip() or FORMULA_ERROR_RE.search(rendered.strip()) or variant not in rendered:
            problems.append(f"Ad Name({ad_letter}) blank/degenerate - does not contain Variant# '{variant}'")
    return problems


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
    try:
        hdr = gog_get(a.ss, f"{a.tab}!1:1", a.account).split("\t")
    except RuntimeError as e:
        print(f"HALT: read error on header row - {e}")
        sys.exit(2)
    schema = detect_schema(hdr)
    if not schema:
        print(f"HALT: could not auto-detect exactly one schema for '{a.tab}' - expected image(Code+1x1) or video(Variant #+4x5)")
        sys.exit(2)
    required = required_headers_for(schema)
    if schema == "video":
        required = [*required, "Ad Name"]
    try:
        hmap = header_map(hdr, required)
        imap = header_indexes(hdr, required)
    except KeyError as e:
        print(f"HALT: required header '{e.args[0]}' not found in row 1 of '{a.tab}' - column renamed/removed?")
        sys.exit(2)

    all_ok = True
    for row in rows:
        try:
            problems = check_row(a.tab, row, schema, hmap, gog_get, a.account, no_thumb=a.no_thumb, ss=a.ss, imap=imap)
        except RuntimeError as e:
            print(f"HALT: read error on row {row} - {e}")
            sys.exit(2)
        if problems:
            all_ok = False
            print(f"row {row}: INCOMPLETE -> " + "; ".join(problems))
        else:
            print(f"row {row}: complete")

    print(f"\nRESULT: {'ALL COMPLETE' if all_ok else 'INCOMPLETE - do NOT flip card to posted'}")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
