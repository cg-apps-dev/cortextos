# Heartbeat Checklist — EXECUTE EVERY STEP. SKIP NOTHING.

This runs on your heartbeat cron (every 4 hours). Execute EVERY step in order.
Skipping steps = broken system.

## Step 1: Update heartbeat (DO THIS FIRST)

```bash
cortextos bus update-heartbeat "<1-sentence summary of current work>"
```

If this fails, your agent shows as DEAD on the dashboard. Fix it before anything else.

**Note:** `update-heartbeat` (Step 1) and `log-event heartbeat agent_heartbeat` (Step 4) are NOT interchangeable.
- `update-heartbeat` refreshes the dashboard status-string field (what the dashboard reads to know you're alive).
- `log-event heartbeat …` appends to the activity feed (JSONL append-only event log).

Both are required every cycle. Skipping Step 1 leaves your dashboard view stale even though you're firing events.

## Step 2: Check inbox

```bash
cortextos bus check-inbox
```

Process ALL messages. ACK every single one:
```bash
cortextos bus ack-inbox "<message_id>"
```

Un-ACK'd messages are re-delivered in 5 minutes.
Target: 0 un-ACK'd messages after this step.

## Step 3: Check task queue

```bash
cortextos bus list-tasks --agent $CTX_AGENT_NAME --status pending
cortextos bus list-tasks --agent $CTX_AGENT_NAME --status in_progress
```

- Pending tasks: pick the highest priority one and start it
- In-progress tasks older than 2 hours: complete them or update status with a note
- No tasks: check GOALS.md for objectives, then check with orchestrator

## Step 4: Log heartbeat event

```bash
cortextos bus log-event heartbeat agent_heartbeat info --meta '{"agent":"'$CTX_AGENT_NAME'"}'
```

## Step 5: Write daily memory

```bash
# memory-append.sh names the LOCAL-day file, stamps the timestamp, and writes
# the body VERBATIM (no shell expansion of backticks/$()). Preferred zero-
# expansion form: write the note to a file with the Edit/Write tool, then
# `./scripts/memory-append.sh -f <notefile> "Heartbeat Update"`.
./scripts/memory-append.sh "Heartbeat Update" <<'NOTE'
- WORKING ON: <task_id or "none">
- Status: <healthy/working/blocked>
- Inbox: <N messages processed>
- Next action: <what you will do next>
NOTE
```

## Step 6: Re-index memory to KB

```bash
# Re-ingest memory, then VERIFY it actually indexed. A silent failure here
# (e.g. a bad flag, or no GEMINI_API_KEY) means your memory never reaches the KB.
RESULT=$(cortextos bus kb-ingest ./MEMORY.md ./memory/$(date +%Y-%m-%d).md \
  --org $CTX_ORG --agent $CTX_AGENT_NAME --scope private 2>&1)
echo "$RESULT"
if echo "$RESULT" | grep -qE "Errors: [1-9]"; then echo "WARNING: Step 9 KB ingest ERROR (likely Gemini free-tier 429 daily embed-quota, 1000/day/project — blocks KB writes fleet-wide until daily reset/plan upgrade); flag the orchestrator."
# DO NOT collapse the next branch into a quiet retry: the warning prints BEFORE the retry deliberately -
# a silent retry makes a recoverable zero invisible, and an intermittent bug that is always survivable is
# never fixed (meta-compliance-agent, 2026-07-26). Retry evidence (0->34 chunks recovering) was observed
# under --force calls; this template's call has no --force, so transfer to this exact path is assumed, not
# demonstrated (the-ad-strategist, 2026-07-26) - retry-first is still the safer default either way.
# DO NOT add an "Ingest complete"-style closing-line pattern as a belt-and-suspenders alternative to the
# chunk-count regex below - that closing line prints on a ZERO-chunk run too, so it would silently re-open
# this exact hole (the-axon-agent, 2026-07-26, nearly shipped it). The zero-branch must stay ORDERED BEFORE
# the success branch - a success pattern evaluated first lets a zero run match it and never reach this check.
elif echo "$RESULT" | grep -qE "Ingested 0 new chunk|Added 0 chunk"; then
  echo "WARNING: Step 9 KB ingest stored ZERO CHUNKS on a run that may have real new content — a bare success word does not mean anything was stored (the-ad-strategist + meta-compliance-agent, 2026-07-25/26). Re-running once before treating this as a failure."
  RESULT=$(cortextos bus kb-ingest ./MEMORY.md ./memory/$(date +%Y-%m-%d).md \
    --org $CTX_ORG --agent $CTX_AGENT_NAME --scope private 2>&1)
  echo "$RESULT"
  if echo "$RESULT" | grep -qE "Ingested [1-9][0-9]* new chunk|Added [1-9][0-9]* chunk"; then echo "Step 9: KB ingest OK (after re-run)"
  else echo "WARNING: Step 9 KB ingest STILL zero after re-run — this is a genuine failure, not a no-op. Check for a stale content-hash/dedup or another cause (--force did not prevent this in the observed instances, so dedup is a weaker hypothesis than it sounds), then flag the orchestrator."; fi
elif echo "$RESULT" | grep -qE "Ingested [1-9][0-9]* new chunk|Added [1-9][0-9]* chunk"; then echo "Step 9: KB ingest OK"
else echo "WARNING: Step 9 KB ingest reported NO confirmation — memory may not be searchable. Check GEMINI_API_KEY; do NOT add a --collection flag (it does not exist)."; fi
```

## Step 7: Check GOALS.md

Read GOALS.md for any new objectives. If goals changed, create tasks:
```bash
cortextos bus create-task "<title>" --desc "<description>" --assignee $CTX_AGENT_NAME
```

## Step 8: Resume work

Pick your highest priority task and work on it.

```bash
cortextos bus update-task "<task_id>" in_progress
# ... do the work ...
cortextos bus complete-task "<task_id>" "<summary of what was produced>"
```

---

REMINDER: A heartbeat with 0 events logged and 0 memory updates means you did nothing visible.
Target: >= 2 events and >= 1 memory update per heartbeat cycle.
