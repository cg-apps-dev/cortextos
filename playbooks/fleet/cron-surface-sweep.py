#!/usr/bin/env python3
"""Bearer-killer sweep of the CRON-PROMPT surface (the 6th surface).
Cron prompts live outside the repo, so file greps never see them, and
list-crons truncates them (~60 chars) so mid-prompt traps stay invisible.
Usage: python3 cron-surface-sweep.py <agent-name>
"""
import json, os, re, subprocess, sys

agent = sys.argv[1] if len(sys.argv) > 1 else ""
root = os.path.expanduser("~/.cortextos")
# Self-locate: the documented path (CTX_ROOT/state/AGENT/crons.json) is stale.
hits = subprocess.run(["find", root, "-name", "crons.json", "-path", "*" + agent + "*"],
                      capture_output=True, text=True).stdout.split()
if not hits:
    sys.exit("no crons.json found for agent: " + agent)
path = hits[0]
print("surface:", path)

data = json.load(open(path))
raw = data if isinstance(data, list) else data.get("crons", data)
crons = raw if isinstance(raw, list) else list(raw.values())

CLASSES = {
    "a claude.ai-bridge": r"mcp__claude_ai_",
    "b composio-entry":   r"COMPOSIO_MULTI_EXECUTE_TOOL|mcp__composio",
    "c UPPER-action":     r"\b(GOOGLESHEETS|GOOGLEDRIVE|SLACK|GMAIL|CLICKUP|NOTION)_[A-Z_]+",
    "d prose-bridge":     r"(?i)composio|claude\.ai bridge|claude ai connector|bridge mcp",
    "e lower-action":     r"\b(clickup|slack|gmail|notion|googlesheets|googledrive)_[a-z_]{3,}",
}
DELEGATES = r"(?i)read .*SKILL\.md|follow its instructions|\.claude/skills/"

for c in crons:
    prompt = c.get("prompt") or ""
    layer = "SKILL-DELEGATING (no 2nd layer)" if re.search(DELEGATES, prompt) else "concrete/inline"
    found = [(k, m.group(0)) for k, pat in CLASSES.items() for m in re.finditer(pat, prompt)]
    print("\n" + str(c.get("name")) + ": " + layer)
    print("  " + ("REVIEW: " + str(found) if found else "clean"))
# NOTE: hits need eyeball triage. A remediated prompt re-flags forever because
# the NO-BRIDGE prohibition line contains the banned names, and own-cred
# filenames (slack_client.py) match class-e. Distinguish INSTRUCTION-to-use
# from PROHIBITION-naming from own-cred-filename before acting.
