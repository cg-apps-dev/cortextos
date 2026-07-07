#!/usr/bin/env python3
"""Flag ClickUp cards that are missing a Brief Writer so the team assigns it.

Adam 2026-06-28: for the UGC/video residual (no writer convention), comment on the
card naming the missing Brief Writer, tag @leeza, and set status -> Agent Flagged.
Idempotent: skips the comment if this agent's marker comment already exists; only
sets the status if it is not already the flagged status (resolved by name from the
card's own list, never hardcoded).

Usage: python3 flag_writer_cards.py [--write] <card_id> [<card_id> ...]
       (dry-run prints intended actions; --write performs them)
"""
import os, sys, json, urllib.request

TOKEN = ""
for line in open("/Users/adamfolker/cortextos/orgs/clean-green-marketing/secrets.env"):
    if line.startswith("CLICKUP_API_TOKEN="):
        TOKEN = line.split("=", 1)[1].strip()
H = {"Authorization": TOKEN}
LEEZA_ID = 4660837
MARKER = "🤖 META-AGENT AUTO-FLAG"

def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    hdr = dict(H)
    if data is not None: hdr["Content-Type"] = "application/json"
    req = urllib.request.Request("https://api.clickup.com/api/v2"+path, data=data, headers=hdr, method=method)
    return json.load(urllib.request.urlopen(req, timeout=30))

def get_task(cid):
    return api(f"/task/{cid}?include_subtasks=true")

def get_comments(cid):
    try: return api(f"/task/{cid}/comment").get("comments", [])
    except Exception: return []

def already_marked(cid):
    # Writer-SPECIFIC idempotency: a card may already carry an unrelated AUTO-FLAG
    # comment (e.g. a compliance flag). Only skip if the MISSING_WRITER_DESIGNER
    # comment is already present.
    for c in get_comments(cid):
        txt = c.get("comment_text") or ""
        if "MISSING_WRITER_DESIGNER" in txt:
            return True
    return False

def flagged_status_name(task):
    """Resolve the card's own 'agent flagged' status string (rename/space-proof)."""
    list_id = (task.get("list") or {}).get("id")
    if not list_id: return None
    try: statuses = api(f"/list/{list_id}").get("statuses", [])
    except Exception: return None
    for s in statuses:
        if "agent flagged" in (s.get("status","").lower()):
            return s.get("status")
    return None

def comment_card(cid, name):
    # Rich comment with a real @mention tag for Leeza + the marker + reason.
    body = {
        "comment": [
            {"text": f"{MARKER}\nMISSING_WRITER_DESIGNER: Brief Writer is unset on this card. "
                     f"Please assign the brief writer so this ad's Writer can be filled on the "
                     f"Meta AdsUpload sheet. "},
            {"text": "@Leeza Bogdanova", "type": "tag", "user": {"id": LEEZA_ID}},
        ],
        "assignee": LEEZA_ID,
        "notify_all": False,
    }
    return api(f"/task/{cid}/comment", "POST", body)

def set_status(cid, status):
    return api(f"/task/{cid}", "PUT", {"status": status})

def main():
    write = "--write" in sys.argv
    cards = [a for a in sys.argv[1:] if not a.startswith("--")]
    for cid in cards:
        t = get_task(cid)
        name = t.get("name","")[:50]
        cur = (t.get("status") or {}).get("status","")
        fs = flagged_status_name(t)
        marked = already_marked(cid)
        actions = []
        if not marked: actions.append("COMMENT(+@leeza)")
        if fs and cur != fs: actions.append(f"STATUS->{fs!r}")
        if fs is None: actions.append("NO-FLAG-STATUS-ON-LIST(skip)")
        print(f"{cid} {name!r} cur={cur!r} -> {', '.join(actions) or 'nothing (already done)'}")
        if write:
            if not marked:
                try: comment_card(cid, name); print("   commented")
                except Exception as e: print(f"   COMMENT ERR: {e}")
            if fs and cur != fs:
                try: set_status(cid, fs); print(f"   status set -> {fs}")
                except Exception as e: print(f"   STATUS ERR: {e}")

if __name__ == "__main__":
    main()
