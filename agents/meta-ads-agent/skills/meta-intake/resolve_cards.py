#!/usr/bin/env python3
# Deterministic ClickUp card-metadata resolver for the Meta Ads runner.
# Runs in the AGENT's OWN session (has REST token + filesystem). ALWAYS does GET /task/{id}
# (full, includes custom_fields) - never relies on the list/filter payload depth.
# Usage: python3 resolve_cards.py <card_id> [<card_id> ...]   -> prints one JSON object per line.
import os, sys, re, json, urllib.request

TOKEN = ""
for line in open("/Users/adamfolker/cortextos/orgs/clean-green-marketing/secrets.env"):
    if line.startswith("CLICKUP_API_TOKEN="):
        TOKEN = line.split("=", 1)[1].strip()
H = {"Authorization": TOKEN}

# Exact custom-field IDs (orchestrator-confirmed) - match by ID first, then by an
# EMOJI-AGNOSTIC name substring (the boards use DIFFERENT writer-field instances:
# the Static Image / Video Ads lists use "✍️ Brief Writer" (ef3d567f...), the Pod
# UGC lists use "📝 Brief Writer" (3ee60fe2...). Matching only the first id+emoji
# silently read writer=blank for every Pod UGC card -> false MISSING_WRITER flags
# 2026-06-28; fixed to id-set + substring.)
WRITER_FIELD_IDS = {
    "ef3d567f-ed7a-44c7-839a-9da86ad37239",   # ✍️ Brief Writer (Image/Video Ads lists)
    "3ee60fe2-773a-4969-9208-6ab48d0b9e01",   # 📝 Brief Writer (Pod 1/2 UGC lists)
}
DESIGNER_FIELD_IDS = {
    "9db33128-0e5a-461f-b968-c3fc48647709",   # 🎨 Designer/Editor
}
WRITER_NAME_SUBSTRS = ("Brief Writer",)
DESIGNER_NAME_SUBSTRS = ("Designer", "Editor")

# Customer Avatar (Adam 2026-07-06): pull the avatar from the card's "Customer Avatar" drop_down
# custom field and map its option name to the EXACT sheet-dropdown value. The card labels differ
# from the sheet's validation strings, so this is an explicit map (never a blind prefix-swap):
# strip "Flower: " -> "FCA=", "Gummies > Deep Sleep: " -> "DSCA=", with the semantic normalizations
# (Shop Switcher -> The Shop Switcher; Skeptic/First-Time -> The Skeptic 1st Time Online Buyer).
# "Multiple Avatars" is intentionally None -> ambiguous, do NOT auto-write (flag/leave for a human).
AVATAR_FIELD_NAME = "Customer Avatar"
AVATAR_MAP = {
    "Flower: Shop Switcher": "FCA=The Shop Switcher",
    "Flower: Skeptic / First-Time Online Buyer": "FCA=The Skeptic 1st Time Online Buyer",
    "Flower: Skeptic / First Time Online Buyer": "FCA=The Skeptic 1st Time Online Buyer",
    "Flower: Daily Unwind": "FCA=Daily Unwind",
    "Flower: Pain Relief": "FCA=Pain Relief",
    "Flower: Better Sleep": "FCA=Better Sleep",
    "Flower: Multiple Avatars": None,
    "Gummies > Deep Sleep: Tried Everything": "DSCA=Tried Everything",
    "Gummies > Deep Sleep: Racing Mind": "DSCA=Racing Mind",
    "Gummies > Deep Sleep: Wellness Stacker": "DSCA=Wellness Stacker",
    "Gummies > Deep Sleep: Better Mornings": "DSCA=Better Mornings",
    "Gummies > Deep Sleep: Multiple Avatars": None,
    # BOF/Promo avatar-category rollout (Adam 2026-07-15): promo/offer BOF creatives (not persona-specific).
    # Sheet dropdown values added by Adam ("yes add it to sheets"). Card labels use a bare "<Product>: BOF/Promo" prefix.
    "Deep Sleep: BOF/Promo": "DSCA=BOF/Promo",
    "Flower: BOF/Promo": "FCA=BOF/Promo",
}

def resolve_avatar(cf_list):
    """Return (sheet_avatar(s)_or_'', raw_card_label(s)_or_''). Reads the '🐵 Customer Avatars'
    field, which is a LABELS (multi-select) type - NOT a single drop_down (fixed 2026-07-14: the
    old code matched name=='Customer Avatar' + type=='drop_down' and silently missed the real
    'Customer Avatars' labels field, returning blank for cards that HAD avatars set).

    MULTIPLE avatars are ALLOWED (Adam 2026-07-14: "it is okay to set multiple customer avatars on
    the card and to have multiple on the sheet"). Resolve EVERY selected label via AVATAR_MAP and
    join the mapped sheet values with ', '. Emoji-agnostic match on the 'Customer Avatar' name
    substring. '' if unset. A label that only maps to None (e.g. '... Multiple Avatars') is skipped;
    if nothing maps, returns '' (row stays flagged for a human). NEVER infers from the card name."""
    for cf in cf_list:
        if "Customer Avatar" not in cf.get("name", "") or cf.get("type") != "labels":
            continue
        v = cf.get("value")
        if not v:
            continue
        ids = v if isinstance(v, list) else [v]
        opts = {o.get("id"): (o.get("label") or o.get("name")) for o in cf.get("type_config", {}).get("options", [])}
        raws, mapped = [], []
        for lid in ids:
            label = opts.get(lid)
            if not label:
                continue
            raws.append(label.strip())
            m = AVATAR_MAP.get(label.strip(), AVATAR_MAP.get(label))
            if m:
                mapped.append(m)
        mapped = list(dict.fromkeys(mapped))  # dedup, preserve order
        return (", ".join(mapped), ", ".join(raws))
    return ("", "")

def pick_initials(cf_list, ids, name_substrs):
    """Resolve a user-field's initials: by known field id first, then by an
    emoji-agnostic name substring. Returns '' only if genuinely unset everywhere."""
    for cf in cf_list:
        if cf.get("id") in ids:
            v = user_initials(cf)
            if v: return v
    for cf in cf_list:
        n = cf.get("name", "")
        if any(s in n for s in name_substrs):
            v = user_initials(cf)
            if v: return v
    return ""

def initials(name):
    parts = [p for p in (name or "").replace(".", "").split() if p]
    return "".join(p[0] for p in parts[:2]).upper() if parts else ""

def user_initials(cf):
    v = cf.get("value")
    if isinstance(v, list) and v:
        u = v[0]
        return initials(u.get("username") or u.get("email", ""))
    return ""

def get_task(cid):
    req = urllib.request.Request(f"https://api.clickup.com/api/v2/task/{cid}?include_subtasks=true", headers=H)
    return json.load(urllib.request.urlopen(req, timeout=30))

def resolve(cid):
    t = get_task(cid)
    name = t.get("name", "")
    txt = (t.get("text_content") or "") + " " + (t.get("description") or "")
    cf_list = t.get("custom_fields", [])
    # Writer / Designer - known field ids first, then emoji-agnostic name substring
    # (covers ✍️ Brief Writer AND 📝 Brief Writer across the different boards).
    w = pick_initials(cf_list, WRITER_FIELD_IDS, WRITER_NAME_SUBSTRS)
    d = pick_initials(cf_list, DESIGNER_FIELD_IDS, DESIGNER_NAME_SUBSTRS)
    # Folder
    folder = ""
    for cf in t.get("custom_fields", []):
        if "Drive Folder" in cf.get("name", "") and isinstance(cf.get("value"), str):
            m = re.search(r"/folders/([A-Za-z0-9_-]+)", cf["value"]); folder = m.group(1) if m else cf["value"]
    # Product (PRODUCT line + name token), tab
    m = re.search(r"PRODUCT\s*:\s*([^\n]+)", txt, re.I)
    pl = (m.group(1).strip() if m else "").lower()
    nm = name.lower()
    # Pod UGC cards carry the product in the NAME (e.g. "Shelby Sims 2 - Sleep Gummies - 4-15-26"),
    # not a PRODUCT: line - so detect gummies/flower from the name too (2026-06-04 Pod-board fix).
    sleep = any(k in pl for k in ("gumm", "sleep", "seep")) or any(k in nm for k in ("deepsleep", "deep sleep", "gummies", "gummy"))
    flower = "flower" in pl or "flower" in nm
    product = "Sleep Gummies" if sleep and not flower else ("Flower" if flower and not sleep else "AMBIGUOUS")
    # Description = card name minus 'MB_CG_IMG_<n> - ' prefix
    desc = re.sub(r"^MB_CG_IMG_\d+\s*-\s*", "", name).strip()
    if desc == name: desc = ""  # bare name -> blank
    avatar, avatar_raw = resolve_avatar(cf_list)
    return {"card": cid, "name": name, "product": product, "writer": w, "designer": d,
            "folder": folder, "description": desc, "avatar": avatar, "avatar_raw": avatar_raw,
            "status": t.get("status", {}).get("status")}

def get_list_statuses(list_id):
    req = urllib.request.Request(f"https://api.clickup.com/api/v2/list/{list_id}", headers=H)
    return json.load(urllib.request.urlopen(req, timeout=30)).get("statuses", [])

def resolve_completion_status(cid):
    """WRITE-TIME status resolution. Reads the card's LIVE list statuses and returns the
    board's completion status (`✅ Posted To Sheet`). This RESOLVE-FROM-LIVE-STATUSES pattern
    is rename-PROOF - keep it for any future status rename. RAISES if the board has no
    Posted-To-Sheet status, so a missed / un-renamed / re-renamed board fails LOUD rather than
    silently writing a stale status. (The legacy '✅ complete' fallback was dropped 2026-06-23
    after all 4 meta boards were renamed Complete -> Posted To Sheet, all-4 verified.)"""
    t = get_task(cid)
    list_id = (t.get("list") or {}).get("id")
    names = [s.get("status", "") for s in (get_list_statuses(list_id) if list_id else [])]
    for ln, orig in [(n.lower(), n) for n in names]:
        if "posted to sheet" in ln:
            return orig
    raise RuntimeError(f"card {cid}: no '✅ Posted To Sheet' completion status on its board "
                       f"(rename-proof fail-loud - board may be missed/renamed-again); statuses={names}")

def complete_card(cid):
    """Set the card to its resolved completion status (render-gate / ALL_DUP reconcile)."""
    target = resolve_completion_status(cid)
    body = json.dumps({"status": target}).encode()
    req = urllib.request.Request(f"https://api.clickup.com/api/v2/task/{cid}",
                                 data=body, headers={**H, "Content-Type": "application/json"}, method="PUT")
    urllib.request.urlopen(req, timeout=30)
    return target

if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--complete":
        for cid in args[1:]:
            try:
                print(json.dumps({"card": cid, "completed_status": complete_card(cid)}))
            except Exception as e:
                print(json.dumps({"card": cid, "error": str(e)}))
    else:
        for cid in args:
            print(json.dumps(resolve(cid)))
