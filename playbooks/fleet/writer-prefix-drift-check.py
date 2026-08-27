#!/usr/bin/env python3
"""Detector: has a NEW card-allocator started, or a dormant one woken up?

Fires the card-identifier convention obligation (see naming-convention-new-producers.md).
The trigger is an EVENT nobody watches for - a new producer's first card - so this
converts it into a diff against a recorded baseline.

BASELINE recorded 2026-07-25 (uncapped sweep, 9 lists, 1171 tasks):
    MB 565, LB 7, MG 4      <- any change means an allocator moved
    LB tops at IMG_215, MG tops at IMG_177, MB past 565
    Non-MB surface: 138,139,162,164,165,166,172,173,177,215 (all killed-or-posted = dormant)

FIRES IF: a prefix appears that is not in the baseline, OR LB/MG counts move off 7/4.
Either means a new allocator started or a dormant one resumed -> the prefixed-name
convention must be in onboarding BEFORE more cards land.

Usage: CLICKUP_API_TOKEN=... python3 writer-prefix-drift-check.py
"""
import os, json, re, urllib.request, urllib.parse
from collections import Counter

BASELINE = {"MB": 565, "LB": 7, "MG": 4}
# MB is the DOMINANT allocator - its count grows every week as a matter of normal
# operation, so growth there is NOT a signal. The risk this detector exists for is a
# SECOND writer entering the numbering space (new prefix) or a DORMANT one resuming
# (LB/MG growth). Excluding MB is deliberate; including it fires on ordinary work.
DOMINANT = "MB"
LISTS = ["901711558014","901711553702","901715106177","901715106274",
         "901715106224","901715106329","901711560388","901712123770","901712093295"]

tok = os.environ["CLICKUP_API_TOKEN"]
def get(url):
    r = urllib.request.Request(url, headers={"Authorization": tok})
    try: return json.load(urllib.request.urlopen(r, timeout=30))
    except Exception: return {}

seen = Counter()
for lst in LISTS:
    page = 0
    while True:
        q = urllib.parse.urlencode({"page": page, "subtasks": "false", "include_closed": "true"})
        d = get("https://api.clickup.com/api/v2/list/%s/task?%s" % (lst, q))
        tasks = d.get("tasks", [])
        if not tasks: break
        for t in tasks:
            m = re.match(r'^([A-Za-z]{2,4})_CG_(IMG|VID)_(\d+)', t.get("name") or "")
            if m: seen[m.group(1).upper()] += 1
        if d.get("last_page"): break
        page += 1

new_prefixes = sorted(set(seen) - set(BASELINE))
moved = {p: (BASELINE[p], seen.get(p, 0)) for p in BASELINE
         if p != DOMINANT and seen.get(p, 0) != BASELINE[p]}

print("observed:", dict(seen))
if new_prefixes:
    print("FIRE - NEW ALLOCATOR(S):", new_prefixes)
if moved:
    print("FIRE - DORMANT ALLOCATOR RESUMED (baseline -> now):", moved)
if not new_prefixes and not moved:
    dom = seen.get(DOMINANT, 0)
    print("no drift - obligation still dormant (%s at %d, growth expected and ignored)" % (DOMINANT, dom))
