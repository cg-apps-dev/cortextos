# Meta Ads intake engine - local gog-backed runner.
# Deterministic, hardened (Codex-reviewed). Sheets+Drive via gog; ClickUp done by the agent outside.
import re
import json
import os
import subprocess
import datetime
from concurrent.futures import ThreadPoolExecutor
import resolve_cards
SHEET_ID = "1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"
GOG_BIN = os.environ.get("GOG_BIN", "gog")
GOG_ACCOUNT = os.environ.get("GOG_ACCOUNT", "adam@cleangreen.com")
# Per-file sharing is ON BY DEFAULT - the col-A =IMAGE preview and the sheet asset
# links require each Drive file to be anyone-with-link readable, or the sheet renders
# blank/access-page. Opt OUT only via an explicit off value (the Composio->gog port had
# stubbed this to a no-op, which shipped unshared files = blank previews every run).
GOG_SHARE_DISABLED = os.environ.get("META_INTAKE_GOG_SHARE", "").strip().lower() in {"0", "false", "no", "off"}

def _now_iso():
    """UTC ISO-8601 timestamp for the 'Added to Sheet' column (matches ADMANAGE col format)."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def _rc(args):
    cmd = [GOG_BIN, "-a", GOG_ACCOUNT, *args, "-j"]
    p = subprocess.run(cmd, text=True, capture_output=True)
    if p.returncode:
        msg = (p.stderr or p.stdout or "").strip()
        raise RuntimeError(f"{' '.join(cmd[:4])}: {msg}")
    try:
        return json.loads(p.stdout or "{}")
    except json.JSONDecodeError as ex:
        raise RuntimeError(f"{' '.join(cmd[:4])}: invalid JSON: {ex}")

def _sheet_range(tab, a1):
    return f"'{tab.replace(chr(39), chr(39) + chr(39))}'!{a1}"

def _fid(u):
    m = re.search(r'/d/([A-Za-z0-9_-]+)', u or "")
    return m.group(1) if m else None

def _flow_rebrand(text):
    """Adam 2026-06-18: rename the product word 'Flower'->'Flow' on sheet-written free
    text (Description/Video Script). Word-boundary so 'Flowers'/'Flowering' and account
    labels (e.g. 'JCG1 - Flow') are NOT affected."""
    if not text:
        return text
    import re as _re
    text = _re.sub(r'\bFlower\b', 'Flow', text)
    text = _re.sub(r'\bflower\b', 'flow', text)
    return text

def precondition():
    """Probe Sheets+Drive. Returns (ok, detail)."""
    try:
        _rc(["sheets", "get", SHEET_ID, _sheet_range("VIDEOS (Flower)", "A1:A1"), "--render", "FORMATTED_VALUE"])
    except Exception as ex:
        return False, f"SHEETS_FAIL:{ex}"
    try:
        _rc(["drive", "ls", "--query", "name contains 'UGC'", "--max", "1", "--fields", "files(id,name)"])
    except Exception as ex:
        return False, f"DRIVE_FAIL:{ex}"
    return True, "ok"

def _read(tab, a1):
    r = _rc(["sheets", "get", SHEET_ID, _sheet_range(tab, a1), "--render", "FORMATTED_VALUE"])
    return r.get("values", [])

def _read_formula(tab, a1):
    r = _rc(["sheets", "get", SHEET_ID, _sheet_range(tab, a1), "--render", "FORMULA"])
    return r.get("values", [])

CELL_ROW_RE = re.compile(r'(?<![A-Za-z0-9_])(\$?[A-Z]{1,3}\$?)(\d+)(?!\d)')

def _retarget_formula_row(formula, source_row, target_row):
    source = str(source_row)
    target = str(target_row)
    return CELL_ROW_RE.sub(lambda m: f"{m.group(1)}{target}" if m.group(2) == source else m.group(0), formula)

def _ad_name_formulas(tab, H, start, n):
    col = _col_letter(H["Ad Name"])
    before_start = max(2, start - 25)
    before = _read_formula(tab, f"{col}{before_start}:{col}{start - 1}") if start > 2 else []
    candidates = []
    for i, row in enumerate(before, before_start):
        if row and str(row[0]).strip().startswith("="):
            candidates.append((i, str(row[0]).strip()))
    if not candidates:
        after = _read_formula(tab, f"{col}{start + n}:{col}{start + n + 24}")
        for i, row in enumerate(after, start + n):
            if row and str(row[0]).strip().startswith("="):
                candidates.append((i, str(row[0]).strip()))
                break
    if not candidates:
        raise RuntimeError(f"missing Ad Name neighbor formula on {tab} near row {start}")
    source_row, source_formula = candidates[-1]
    return [[_retarget_formula_row(source_formula, source_row, start + i)] for i in range(n)]

def _headers(tab):
    """Live header map name->idx (0-based). Flags duplicate headers."""
    hdr = _read(tab, "A1:BZ1")  # widened from AZ (2026-07-06): the E-0828/E-0750 col insert pushed VIDEOS (Flower)'s Actor Age Bracket/Gender past AZ, making them invisible to _headers (set_actor_vision failed). BZ = 78 cols headroom.
    hdr = hdr[0] if hdr else []
    idx, dups = {}, []
    for i, h in enumerate(hdr):
        h = (h or "").strip()
        if not h: continue
        if h in idx: dups.append(h)
        else: idx[h] = i
    if dups: raise RuntimeError(f"DUP_HEADERS {tab}: {dups}")
    return idx

def _list_folder(fid):
    files, tok = [], None
    while True:
        a = ["drive", "ls", "--parent", fid, "--max", "1000", "--fields", "files(id,name,mimeType,modifiedTime),nextPageToken"]
        if tok: a += ["--page", tok]
        d = _rc(a)
        files += d.get("files") or []
        tok = d.get("nextPageToken")
        if not tok: break
    return files

def _col_letter(i):
    s = ""; i += 1
    while i: i, r = divmod(i-1, 26); s = chr(65+r)+s
    return s

def _max_nonempty(tab, key_idx):
    """ANTI-CLOBBER: full-column scan for max non-empty in the key (Code/Variant) column."""
    colL = _col_letter(key_idx)
    vals = _read(tab, f"{colL}1:{colL}5000")
    last = 0
    for r, row in enumerate(vals):
        if r == 0: continue
        if row and (row[0] or "").strip(): last = r+1
    return last

def _ids_on_tab(tab, asset_idxs):
    """All Drive file-ids already present in the asset columns (FILE-ID DEDUP authority)."""
    present = set()
    maxL = _col_letter(max(asset_idxs))
    vals = _read(tab, f"A1:{maxL}5000")
    for row in vals:
        for c in asset_idxs:
            if len(row) > c:
                f = _fid(row[c])
                if f: present.add(f)
    return present

def _preflight_empty(tab, start_row, n, input_idxs):
    """Assert target rows' INPUT cells are all empty before writing (hardening 2)."""
    maxL = _col_letter(max(input_idxs))
    vals = _read(tab, f"A{start_row}:{maxL}{start_row+n-1}")
    for r in range(n):
        row = vals[r] if r < len(vals) else []
        for c in input_idxs:
            if len(row) > c and (row[c] or "").strip():
                return False, f"row {start_row+r} col {_col_letter(c)} not empty"
    return True, "ok"

def _write_multi(tab, blocks):
    """ATOMIC multi-range write in ONE call (skips Ad Name col). blocks=[(a1,values2d),...].
    gog sheets batch-update uses JSON valueRanges, preserving comma-laden values."""
    data = [{"range": _sheet_range(tab, a1), "values": v} for a1, v in blocks]
    _rc(["sheets", "batch-update", "--data-json", json.dumps(data), "--input", "USER_ENTERED", SHEET_ID])

def _share(fids):
    """Make each Drive file anyone-with-link reader (per-file) so the col-A =IMAGE
    preview + sheet asset links render. ON by default; opt out with META_INTAKE_GOG_SHARE=off.
    Parallel, per-file-failure-tolerant. Returns (shared_count, total)."""
    total = len(fids)
    if GOG_SHARE_DISABLED:
        return 0, total
    unique = list(dict.fromkeys(fids))

    def share_one(fid):
        try:
            _rc(["drive", "share", fid, "--to=anyone", "--role=reader", "--force"])
            return 1
        except Exception:
            return 0

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = dict(zip(unique, ex.map(share_one, unique)))
    return sum(results.get(fid, 0) for fid in fids), total

def _thumbs(fids):
    def one(f):
        try:
            d = _rc(["drive", "get", f, "--fields", "id,thumbnailLink"])
            fm = d.get("file") or d
            return bool(fm.get("thumbnailLink"))
        except Exception:
            return False
    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(one, fids))

def _posted_to_sheet_status(card_id):
    """Return whether the card is already in a posted-to-sheet completion status."""
    status = (resolve_cards.resolve(card_id).get("status") or "").strip().lower()
    return "posted to sheet" in status

def _file_ids_for_rows(rows, fields):
    out = set()
    for row in rows:
        for field in fields:
            value = row.get(field)
            if value:
                out.add(value)
    return out

def _rows_for_card_id(tab, card_id, card_id_idx, asset_idxs):
    max_idx = max([card_id_idx] + list(asset_idxs or []))
    vals = _read(tab, f"A1:{_col_letter(max_idx)}5000")
    row_numbers, file_ids = [], set()
    for r, row in enumerate(vals[1:], start=2):
        cell = row[card_id_idx] if len(row) > card_id_idx else ""
        cell = (cell or "").strip()
        m = re.search(r'/t/([A-Za-z0-9]+)', cell)
        row_card_id = m.group(1) if m else (cell if re.fullmatch(r'[A-Za-z0-9]+', cell) else None)
        if row_card_id != card_id:
            continue
        row_numbers.append(r)
        for c in asset_idxs or []:
            if len(row) > c:
                fid = _fid(row[c])
                if fid:
                    file_ids.add(fid)
    return {"rows": row_numbers, "file_ids": file_ids}

def _reintake_guard(
    card_id,
    rows,
    fresh,
    present,
    id_fields,
    label_fn,
    complete_check=True,
    card_id_idx=None,
    tab=None,
    asset_idxs=None,
):
    """Guard new variants on already-present/already-complete cards unless confirmed."""
    if not fresh:
        return None
    row_ids = _file_ids_for_rows(rows, id_fields)
    present_ids = sorted(row_ids & present)
    posted = False
    if not present_ids and complete_check:
        posted = _posted_to_sheet_status(card_id)
    fresh_file_ids = _file_ids_for_rows(fresh, id_fields)
    guard = {
        "card": card_id,
        "status": "RE_INTAKE_GUARD",
        "reason": (
            f"card {card_id}: {len(fresh)} new variant file-id set(s) on an "
            "already-complete/partially-present card - confirm intake"
        ),
        "fresh": [label_fn(row) for row in fresh],
        "fresh_file_ids": sorted(fresh_file_ids),
        "present_file_ids": present_ids,
        "already_complete": posted,
    }
    if present_ids or posted:
        return guard
    if card_id_idx is None and tab:
        card_id_idx = _headers(tab).get("ClickUp Card ID")
    if tab and card_id_idx is not None and asset_idxs:
        prior = _rows_for_card_id(tab, card_id, card_id_idx, asset_idxs)
        if prior["rows"] and prior["file_ids"] != fresh_file_ids:
            prior_row_numbers = sorted(prior["rows"])
            guard["reason"] = (
                f"card {card_id}: already on {tab} rows {prior_row_numbers} "
                "with different assets - re-edit; confirm to supersede"
            )
            guard["prior_row_numbers"] = prior_row_numbers
            guard["prior_file_ids"] = sorted(prior["file_ids"])
            return guard
    return None

# ---------- IMAGE intake ----------
# Robust: extract <n>,<v> and the ratio INDEPENDENTLY so BOTH known orderings parse
# (prefix "1x1 - MB_CG_IMG_<n>_V<v>.jpg"  AND  suffix "MB_CG_IMG_<n>_V<v>_1x1.png"), any extension.
# Optional letters-only descriptive infix between the number and _V<v> so names like
# MB_CG_IMG_582_news_V1_1x1 / MB_CG_IMG_584_billboard_V2_9x16 still parse to (n, v).
# PURELY ADDITIVE: the infix group is non-greedy (zero tried first), so every name the
# old `MB_CG_IMG_(\d+)_V(\d+)` matched still matches identically; it only rescues names
# that previously fell to FILES_PRESENT_UNPARSEABLE. (2026-07-14: IMG_582 held off-sheet
# purely by the `_news_` infix - Adam: never withhold a finished creative for a nit.)
IMG_NV = re.compile(r'MB_CG_IMG_(\d+)(?:_[A-Za-z]+)*?_V(\d+)', re.I)
IMG_RATIO = re.compile(r'(?:^|[ _\-/])(1x1|9x16)(?:[ _\-./]|$)', re.I)

def intake_image_card(card_id, folder_id, tab, writer, designer, description, dry_run=True, confirm_reintake=False):
    """One image card -> rows (one per variant, 1x1+9x16). Returns a plan/result dict. dry_run=True => compute only, NO writes."""
    description = _flow_rebrand(description)
    H = _headers(tab)
    need = ["Code","Description","Writer","Designer","ClickUp Card ID","Ad Name","1x1","9x16"]
    for k in need:
        if k not in H: raise RuntimeError(f"missing header '{k}' on {tab}")
    files = _list_folder(folder_id)
    variants, unparsed = {}, []
    for f in files:
        if f.get("mimeType","").startswith("application/vnd.google-apps.folder"): continue
        nm = f["name"]
        if _is_axon_or_dnu(nm): continue
        mnv = IMG_NV.search(nm); mr = IMG_RATIO.search(nm)
        if not mnv or not mr: unparsed.append(nm); continue
        n, v, ratio = mnv.group(1), int(mnv.group(2)), mr.group(1).lower()
        variants.setdefault(v, {"n": n})[("p1" if ratio=="1x1" else "p9")] = f["id"]
    rows = []
    for v in sorted(variants):
        d = variants[v]
        if "p1" not in d or "p9" not in d:
            unparsed.append(f"V{v} missing 1x1 or 9x16"); continue
        rows.append({"code": f"IMG_{d['n']}_V{v}", "v": v, "p1": d["p1"], "p9": d["p9"]})
    if not rows:
        # SAFETY: distinguish genuinely-empty from files-present-but-unparseable. NEVER false-flag a real ad as "empty".
        nonfolder = [f["name"] for f in files if not f.get("mimeType","").startswith("application/vnd.google-apps.folder")]
        if not nonfolder:
            return {"card": card_id, "status": "EMPTY_FOLDER",
                    "reason": f"Drive folder {folder_id} empty - no files at all; add finished 1x1/9x16 assets or remove from Ready-to-Post."}
        return {"card": card_id, "status": "FILES_PRESENT_UNPARSEABLE",
                "reason": f"Drive folder {folder_id} HAS {len(nonfolder)} file(s) but NONE parse as 1x1/9x16 'MB_CG_IMG_<n>_V<v>' variants - likely a naming/rename issue, NOT empty. Needs review/rename.",
                "files_present": nonfolder, "unparsed": unparsed}
    # FILE-ID DEDUP
    present = _ids_on_tab(tab, [H["1x1"], H["9x16"]])
    fresh = [r for r in rows if r["p1"] not in present and r["p9"] not in present]
    dup = [r["code"] for r in rows if r not in fresh]
    if not fresh:
        return {"card": card_id, "status": "ALL_DUP", "dup": dup, "rows": [r["code"] for r in rows]}
    guard = _reintake_guard(
        card_id,
        rows,
        fresh,
        present,
        ("p1", "p9"),
        lambda r: r["code"],
        card_id_idx=H["ClickUp Card ID"],
        tab=tab,
        asset_idxs=[H["1x1"], H["9x16"]],
    )
    if guard and not confirm_reintake:
        return guard
    # ANTI-CLOBBER append + preflight.
    # Compute the append-start from the max non-empty row across the KEY col AND the asset cols,
    # so a Code-less-but-asset-present row (e.g. a 9x16-only OOH/billboard row, which has no Code/1x1)
    # is still respected and never clobbered. Keying on Code alone missed such rows (flower row 821,
    # the Times Square 9x16-only billboard) and produced a PREFLIGHT_FAIL. (fix 2026-06-10)
    start = max(_max_nonempty(tab, H["Code"]), _max_nonempty(tab, H["1x1"]), _max_nonempty(tab, H["9x16"])) + 1
    n = len(fresh)
    input_idxs = [H["Code"],H["Description"],H["Writer"],H["Designer"],H["ClickUp Card ID"],H["1x1"],H["9x16"], 0]
    ok, why = _preflight_empty(tab, start, n, input_idxs)
    if not ok:
        return {"card": card_id, "status": "PREFLIGHT_FAIL", "why": why, "would_start": start}
    plan = {"card": card_id, "status": "READY", "tab": tab, "start": start, "end": start+n-1,
            "rows": [{"row": start+i, "code": r["code"], "1x1": r["p1"], "9x16": r["p9"]} for i, r in enumerate(fresh)],
            "dup_skipped": dup, "unparsed": unparsed}
    if dry_run:
        return plan
    # BUILD cell blocks (col A preview = 1x1 thumbnail; Ad Name formula copied from a neighboring row)
    clickurl = f"https://app.clickup.com/t/{card_id}"
    colA = [[f'=IMAGE("https://drive.google.com/thumbnail?id={r["p1"]}&sz=w1000")'] for r in fresh]
    # contiguous data Code..ClickUp Card ID
    c0 = H["Code"]
    data = [[r["code"], description, writer, designer, clickurl] for r in fresh]  # Code,Desc,Writer,Designer,ClickUp (assumes contiguous E..I)
    # assets: 1x1 and 9x16 (write each col separately to be safe re: 4x5 gap)
    blocks = [("A%d" % start, colA),
              ("%s%d" % (_col_letter(c0), start), data),
              ("%s%d" % (_col_letter(H["Ad Name"]), start), _ad_name_formulas(tab, H, start, n)),
              ("%s%d" % (_col_letter(H["1x1"]), start), [[r["p1"] and f'https://drive.google.com/file/d/{r["p1"]}/view?usp=drive_link'] for r in fresh]),
              ("%s%d" % (_col_letter(H["9x16"]), start), [[f'https://drive.google.com/file/d/{r["p9"]}/view?usp=drive_link'] for r in fresh])]
    # "Added to Sheet" intake timestamp (col B as of 2026-06-04) - set-once: engine only ever writes
    # freshly-appended rows, so this never overwrites an existing stamp. Header-resolved; skip if absent.
    if "Added to Sheet" in H:
        ts = _now_iso()
        blocks.append(("%s%d" % (_col_letter(H["Added to Sheet"]), start), [[ts] for _ in fresh]))
    # verify Code..ClickUp is contiguous (else fall back to per-cell)
    if not (H["Description"]==c0+1 and H["Writer"]==c0+2 and H["Designer"]==c0+3 and H["ClickUp Card ID"]==c0+4):
        raise RuntimeError("Code..ClickUp not contiguous - abort, needs per-cell write")
    _write_multi(tab, blocks)
    shared, total = _share([x for r in fresh for x in (r["p1"], r["p9"])])
    plan["shared"] = f"{shared}/{total}"
    # READ-BACK mapping check
    maxL = _col_letter(max(H["9x16"], H["Ad Name"]))
    vb = _read(tab, f"A{start}:{maxL}{start+n-1}")
    rb = []
    for i, r in enumerate(fresh):
        row = vb[i] if i < len(vb) else []
        g = lambda c: (row[c] if len(row) > c else "")
        code_ok = g(H["Code"]).strip() == r["code"]
        a1_ok = bool(g(H["1x1"])); a9_ok = bool(g(H["9x16"]))
        adn_ok = (r["code"].split("_V")[0].replace("IMG_","") in g(H["Ad Name"]) or card_id in g(H["Ad Name"]))
        rb.append({"row": start+i, "code_ok": code_ok, "1x1": a1_ok, "9x16": a9_ok, "adname_ok": adn_ok})
    plan["readback"] = rb
    plan["all_ok"] = all(x["code_ok"] and x["1x1"] and x["9x16"] and x["adname_ok"] for x in rb)
    # RENDER-GATE
    th = _thumbs([r["p1"] for r in fresh])
    plan["rendered"] = (sum(th) == len(th))
    plan["render_detail"] = f"{sum(th)}/{len(th)} thumbnailLink present"
    return plan

# ---------- ACTOR VISION write (2026-06-04) ----------
# Per-ad actor age/gender classification is done by the AGENT (vision on a montage of the ad's
# video/image). After the agent classifies, it calls set_actor_vision()
# to persist the result. Columns resolved BY HEADER NAME (robust to future column shifts).
def set_actor_vision(tab, results):
    """results = [{'row': int, 'age': 'YOUNGER'|'OLDER'|'NO-ACTOR', 'gender': 'M'|'F'|'-', 'low_conf': bool}].
    Writes 'Actor Age Bracket' + 'Gender'. Low-confidence/borderline rows get a trailing ' ⚠' on the age
    so the human reviewer can confirm-in-context (Adam's rule: flag borderline, don't force). Idempotent-safe
    to re-run (overwrites only these two cells for the given rows)."""
    H = _headers(tab)
    for k in ("Actor Age Bracket", "Gender"):
        if k not in H: raise RuntimeError(f"missing header '{k}' on {tab} - run the 2026-06-04 structural change first")
    blocks = []
    for r in results:
        age = (r["age"] or "").strip()
        if r.get("low_conf") and age and age != "NO-ACTOR":
            age += " ⚠"
        blocks.append(("%s%d" % (_col_letter(H["Actor Age Bracket"]), r["row"]), [[age]]))
        blocks.append(("%s%d" % (_col_letter(H["Gender"]), r["row"]), [[(r.get("gender") or "-").strip()]]))
    if blocks:
        _write_multi(tab, blocks)
    return {"tab": tab, "rows_written": len(results)}

# ---------- VIDEO intake (2026-06-04) ----------
# Pod/UGC + Video-Ads video deliverables: finished assets live in a NESTED subfolder whose name
# varies by pod ("- Finished", "- Exports", "Finished Videos - After Edit", "Finished (Upload!)"…) -
# found fuzzily. Top-level files are raw source clips (Hook*.mov, Broll*, IMG_*) and are ignored.
# Finished naming is consistent across pods: "UGC-<n>- V<vv> - <Actor> - Hook <h> - <ratio>.mp4"
# (ratio = 4x5 | 9x16; trailing chars like "9x16-.mp4" and intra-folder dupes tolerated).
# One row per (variant, hook) ad, each needing BOTH 4x5 + 9x16. Same hard gates as intake_image_card:
# file-id dedup, anti-clobber append (key col = "Variant #"), per-file share, read-back, render-gate
# (9x16 thumbnailLink - video poster lags async, so gate on it). col-A = =IMAGE(9x16 thumbnail).
# AI-VO convention (2026-06-27) has NO <Actor> token ("AI #<n> - V<vv> - Hook <h> - <ratio>(_<dupe>)?.mp4"):
# the <Actor> group is OPTIONAL, guarded by (?!Hook\b) so it cannot swallow the Hook token; when absent
# the parse defaults actor="AI" (actor-vision age bracket = NO-ACTOR is set later by the agent vision pass).
VID_RE = re.compile(r'V(\d+)\s*-\s*(?:(?!Hook\b)(.+?)\s*-\s*)?Hook\s*(\d+)\s*-\s*[^/]*?(4x5|9x16)', re.I)
FINISHED_RE = re.compile(r'finish|export|upload|final', re.I)
DNU_RE = re.compile(r'do[ -]?not[ -]?use|\bdnu\b|\bunused\b|\barchive\b', re.I)
# AXON-named folders are the AXON platform, NOT Meta - EXCLUDED from Meta-intake folder-selection.
# Adam HARD RULE (2026-06-25): "Any folders named Axon should be ignored from the Meta Ads upload sheet."
# LEADING word-boundary (\baxon) = matches Axon at a word-START so the AXON platform is excluded even with no
# trailing separator ("Axon Finished" / "New Axon Re-edit" / "AxonFinished" / "Axon2"), WITHOUT false-dropping a
# UGC actor whose name merely contains the letters axon mid-word ("Jaxon" / "Saxon" - axon not at a word-start).
AXON_RE = re.compile(r'\baxon', re.I)
DISCLAIMER_RE = re.compile(r'disclaimer', re.I)  # Adam 2026-06-26: anything with a disclaimer is Axon (burned cannabis disclaimer = Pod 3 Axon, not Meta) - excluded flat from Meta intake, no carve-out.

def _is_axon_or_dnu(name):
    """True if a folder/file name is Axon-platform, Do-Not-Use, or disclaimer-named (excluded from Meta-intake collection)."""
    n = name or ""
    return bool(AXON_RE.search(n) or DNU_RE.search(n) or DISCLAIMER_RE.search(n))

def _find_finished_folder(folder_id):
    """Locate the nested finished/exports subfolder by newest PARSEABLE deliverable. Returns (id, name) or (None, None).
    EXCLUDES Do-Not-Use folders/files (DNU_RE) AND Axon-named folders/files (AXON_RE) - Axon = the AXON platform,
    NOT Meta (Adam hard-rule 2026-06-25); Meta-intake selects ONLY non-Axon, non-DNU Meta finished deliverables."""
    subs = [
        f for f in _list_folder(folder_id)
        if f.get("mimeType", "").endswith("folder") and not _is_axon_or_dnu(f.get("name", ""))
    ]

    def parseable_files(fid, depth=0):
        out = []
        for f in _list_folder(fid):
            name = f.get("name", "")
            if _is_axon_or_dnu(name):
                continue
            if f.get("mimeType", "").startswith("application/vnd.google-apps.folder"):
                if depth < 3:
                    out += parseable_files(f["id"], depth + 1)
                continue
            if VID_RE.search(name):
                out.append(f)
        return out

    winner, winner_modified = None, None
    for sub in subs:
        files = parseable_files(sub["id"])
        if not files:
            continue
        newest = max((f.get("modifiedTime") or "") for f in files)
        if winner_modified is None or newest > winner_modified:
            winner, winner_modified = sub, newest
    if winner:
        return winner["id"], winner["name"]

    fin = [f for f in subs if FINISHED_RE.search(f.get("name", ""))]
    if len(fin) == 1:
        return fin[0]["id"], fin[0]["name"]
    if len(fin) > 1:
        # prefer a 'finish/final/upload' folder over a bare 'export' when several match
        for f in fin:
            if re.search(r'finish|final|upload', f["name"], re.I):
                return f["id"], f["name"]
        return fin[0]["id"], fin[0]["name"]
    return None, None

def intake_video_card(card_id, folder_id, tab, writer, designer, video_script="", dry_run=True, confirm_reintake=False):
    """One video card -> rows (one per variant+hook, 4x5+9x16). dry_run=True => plan only, NO writes.
    Mirrors intake_image_card gates for the VIDEOS tabs."""
    video_script = _flow_rebrand(video_script)
    H = _headers(tab)
    need = ["Variant #", "Actor", "Hook #", "Writer", "Designer", "ClickUp Card ID", "Ad Name", "4x5", "9x16"]
    for k in need:
        if k not in H: raise RuntimeError(f"missing header '{k}' on {tab}")
    fin_id, fin_name = _find_finished_folder(folder_id)
    if not fin_id:
        fin_id, fin_name = folder_id, "(root)"   # no finished subfolder - try the root itself
    # RECURSE: finished exports are frequently in per-actor subfolders (Thomas/Mia/Sofia/Helen…)
    # INSIDE the finished folder. A flat list of the finished folder sees only those subfolders (no
    # files) and would false-flag EMPTY. Collect files from the finished folder AND nested subfolders.
    def _collect_files(fid, depth=0):
        out = []
        for f in _list_folder(fid):
            if f.get("mimeType", "").startswith("application/vnd.google-apps.folder"):
                if _is_axon_or_dnu(f.get("name", "")):
                    continue
                if depth < 3:
                    out += _collect_files(f["id"], depth + 1)
            else:
                if _is_axon_or_dnu(f.get("name", "")):
                    continue
                out.append(f)
        return out
    files = _collect_files(fin_id)
    variants, unparsed = {}, []
    for f in files:
        if f.get("mimeType", "").startswith("application/vnd.google-apps.folder"): continue
        m = VID_RE.search(f["name"])
        if not m:
            unparsed.append(f["name"]); continue
        v, actor, hook, ratio = int(m.group(1)), (m.group(2).strip() if m.group(2) is not None else "AI"), int(m.group(3)), m.group(4).lower()
        # KEY by (actor, v, hook): multi-actor cards (Tom/Mia, Thomas/Helen/Sofia) reuse the same V##/Hook##
        # numbers per actor, so keying by (v, hook) alone collides and drops every actor but one.
        d = variants.setdefault((actor, v, hook), {"actor": actor})
        d.setdefault("p4" if ratio == "4x5" else "p9", f["id"])   # dedup intra-folder: first wins
    rows = []
    for key in sorted(variants):
        actor, v, hook = key
        d = variants[key]
        if "p4" not in d or "p9" not in d:
            unparsed.append(f"{actor} V{v} Hook{hook} missing 4x5 or 9x16"); continue
        rows.append({"v": v, "hook": hook, "actor": actor, "p4": d["p4"], "p9": d["p9"]})
    if not rows:
        nonfolder = [f["name"] for f in files if not f.get("mimeType", "").startswith("application/vnd.google-apps.folder")]
        if not nonfolder:
            return {"card": card_id, "status": "EMPTY_FOLDER",
                    "reason": f"finished folder '{fin_name}' empty - add finished 4x5/9x16 assets or remove from Ready-to-Post."}
        return {"card": card_id, "status": "FILES_PRESENT_UNPARSEABLE",
                "reason": f"finished folder '{fin_name}' HAS files but NONE parse as 'V<vv> - <Actor> - Hook <h> - <ratio>' - naming/rename issue, needs review.",
                "finished_folder": fin_name, "files_present": nonfolder, "unparsed": unparsed}
    # FILE-ID DEDUP vs the tab
    present = _ids_on_tab(tab, [H["4x5"], H["9x16"]])
    fresh = [r for r in rows if r["p4"] not in present and r["p9"] not in present]
    dup = [f"V{r['v']}H{r['hook']}" for r in rows if r not in fresh]
    if not fresh:
        return {"card": card_id, "status": "ALL_DUP", "dup": dup}
    guard = _reintake_guard(
        card_id,
        rows,
        fresh,
        present,
        ("p4", "p9"),
        lambda r: f"{r['actor']} V{r['v']:02d} H{r['hook']}",
        card_id_idx=H["ClickUp Card ID"],
        tab=tab,
        asset_idxs=[H["4x5"], H["9x16"]],
    )
    if guard and not confirm_reintake:
        return guard
    # ANTI-CLOBBER append (key col = Variant #) + preflight. Like the image path, compute start from
    # max over the key col AND the asset cols so a Variant-less-but-asset-present row is never clobbered. (fix 2026-06-10)
    start = max(_max_nonempty(tab, H["Variant #"]), _max_nonempty(tab, H["4x5"]), _max_nonempty(tab, H["9x16"])) + 1
    n = len(fresh)
    input_idxs = [H["Variant #"], H["Actor"], H["Hook #"], H["Writer"], H["Designer"], H["ClickUp Card ID"], H["4x5"], H["9x16"], 0]
    ok, why = _preflight_empty(tab, start, n, input_idxs)
    if not ok:
        return {"card": card_id, "status": "PREFLIGHT_FAIL", "why": why, "would_start": start}
    plan = {"card": card_id, "status": "READY", "tab": tab, "finished_folder": fin_name, "start": start, "end": start + n - 1,
            "rows": [{"row": start + i, "variant": f"V{r['v']:02d}", "hook": f"H{r['hook']}", "actor": r["actor"]} for i, r in enumerate(fresh)],
            "dup_skipped": dup, "unparsed": unparsed}
    if dry_run:
        return plan
    # BUILD cell blocks. col-A preview = 9x16 thumbnail (video). Per-column writes (VIDEOS layout is
    # NOT a contiguous block like images - write each resolved col separately to avoid clobbering gaps).
    clickurl = f"https://app.clickup.com/t/{card_id}"
    def colvals(name, vals):
        return ("%s%d" % (_col_letter(H[name]), start), [[v] for v in vals])
    blocks = [("A%d" % start, [[f'=IMAGE("https://drive.google.com/thumbnail?id={r["p9"]}&sz=w1000")'] for r in fresh])]
    blocks.append(colvals("Variant #", [f"V{r['v']:02d}" for r in fresh]))
    blocks.append(colvals("Actor", [r["actor"] for r in fresh]))
    blocks.append(colvals("Hook #", [f"H{r['hook']}" for r in fresh]))
    blocks.append(colvals("Writer", [writer for _ in fresh]))
    blocks.append(colvals("Designer", [designer for _ in fresh]))
    blocks.append(colvals("ClickUp Card ID", [clickurl for _ in fresh]))
    blocks.append(colvals("Ad Name", [row[0] for row in _ad_name_formulas(tab, H, start, n)]))
    blocks.append(colvals("4x5", [f'https://drive.google.com/file/d/{r["p4"]}/view?usp=drive_link' for r in fresh]))
    blocks.append(colvals("9x16", [f'https://drive.google.com/file/d/{r["p9"]}/view?usp=drive_link' for r in fresh]))
    if "Video Script" in H and video_script:
        blocks.append(colvals("Video Script", [video_script for _ in fresh]))
    if "Added to Sheet" in H:
        ts = _now_iso()
        blocks.append(colvals("Added to Sheet", [ts for _ in fresh]))
    _write_multi(tab, blocks)
    shared, total = _share([x for r in fresh for x in (r["p4"], r["p9"])])
    plan["shared"] = f"{shared}/{total}"
    # READ-BACK
    maxL = _col_letter(max(H["4x5"], H["9x16"], H["Variant #"], H["Ad Name"]))
    vb = _read(tab, f"A{start}:{maxL}{start + n - 1}")
    rb = []
    for i, r in enumerate(fresh):
        row = vb[i] if i < len(vb) else []
        g = lambda c: (row[c] if len(row) > c else "")
        rb.append({"row": start + i, "variant_ok": bool(g(H["Variant #"])), "4x5": bool(g(H["4x5"])), "9x16": bool(g(H["9x16"])), "adname_ok": bool(g(H["Ad Name"]))})
    plan["readback"] = rb
    plan["all_ok"] = all(x["variant_ok"] and x["4x5"] and x["9x16"] and x["adname_ok"] for x in rb)
    # RENDER-GATE on the 9x16 (video poster builds async on Drive - gate on thumbnailLink present)
    th = _thumbs([r["p9"] for r in fresh])
    plan["rendered"] = (sum(th) == len(th))
    plan["render_detail"] = f"{sum(th)}/{len(th)} 9x16 thumbnailLink present"
    return plan
