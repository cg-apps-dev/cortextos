---
name: memory
description: "You need to write or update memory. This happens at session start, heartbeat, session end, or when you learn something worth keeping. Memory is how you maintain continuity across restarts and context compactions — without it, every session starts blind."
triggers: ["memory", "remember", "write memory", "update memory", "session memory", "what was I working on", "resume", "working on", "memory file", "daily memory", "long-term memory", "memory protocol", "session start", "record progress", "note this", "save for later", "persist learning", "write to memory", "check memory", "read memory", "what did I do yesterday", "context snapshot", "state snapshot"]
---

# Memory

You have three memory layers. All are mandatory. Without memory, session crashes and context compactions leave the next session starting blind.

The purpose of daily memory is not to log activity — it is to capture enough context that you (or a fresh session) can resume intelligently without re-reading everything.

**Each entry should answer: "if my context was wiped right now, what would I need to know to resume intelligently?"**

---

## Layer 1: Daily Memory (memory/YYYY-MM-DD.md)

Session-scoped context journal. Written at key checkpoints, not continuously.

**Location:** `memory/$(date +%Y-%m-%d).md` in your agent workspace, named by your LOCAL day (not UTC). One local day is one contiguous file. Before 2026-08-28 this used `date -u`, which split a PT evening (17:00-24:00 PT = the next UTC day) across two files; that fragmentation is retired.

**Always write via `./scripts/memory-append.sh`** - it names the LOCAL-day file, stamps the timestamp, and writes the body VERBATIM (no shell expansion of backticks/`$()` in your note text, which a bare `cat >> file << HEREDOC` silently does). Two body sources: `-f <file>` (write the note to a file with the Edit/Write tool first = zero expansion surface, preferred) or a quoted-delimiter heredoc on stdin (`<<'NOTE'`). The `<label>` becomes `## <label> - <UTC> / <LOCAL>`.

### On session start
```bash
./scripts/memory-append.sh "Session Start" <<'NOTE'
- Status: online
- Crons active: <output of `cortextos bus list-crons $CTX_AGENT_NAME`>
- Inbox: <N messages or "empty">
- Current state: <where things stand — what is in progress, pending, or needs attention>
- Resuming: <what to do next and why, with enough context to act without re-reading everything>
NOTE
```

### Mid-work inline note (write immediately when something important happens)
```bash
./scripts/memory-append.sh "Inline note" <<'NOTE'
<key decision / discovery / user preference / non-obvious thing>
NOTE
```
Don't wait for the heartbeat. Use for: significant decisions, user preferences learned, non-obvious situations, anything you would want the next session to know. One line of body is enough.

### On heartbeat
```bash
./scripts/memory-append.sh "Heartbeat" <<'NOTE'
- Current focus: <what I am working on and why>
- Active threads: <anything in progress or being monitored — state of each>
- Key decisions: <decisions made since last entry with brief rationale>
- Context notes: <anything non-obvious — user preferences, environment state, blockers>
- Next: <what I am doing next>
NOTE
```

### On session end (before any restart)
```bash
./scripts/memory-append.sh "Session End" <<'NOTE'
- Status: [done/interrupted/context-full]
- Current state: [where things stand — specific enough that the next session can resume cold]
- Active threads: [anything in progress or mid-task with current state]
- Key decisions: [significant decisions from this session worth carrying forward]
- For next session: [what to do first and what context is needed]
NOTE
```

### Reading today's memory (on resume)
```bash
cat "memory/$(date +%Y-%m-%d).md" 2>/dev/null || echo "No memory for today yet"
```

---

## Layer 2: Long-Term Memory (MEMORY.md)

Persistent learnings that survive across all sessions. Not a log — a living document.

**Location:** `MEMORY.md` in your agent workspace

### When to update
- Patterns that work or don't work
- User preferences discovered
- System behaviors noted
- Important decisions and their reasons
- Corrections you received — things you did wrong
- Anything you'd want to know on the next fresh session

### Format
```markdown
## [Topic] — YYYY-MM-DD
<what you learned>
```

Update at every heartbeat and session end. Ingest to KB after updating.

---

## Layer 3: Knowledge Base (RAG/ChromaDB)

Re-ingest MEMORY.md and today's daily memory on every heartbeat so they stay semantically searchable:
```bash
cortextos bus kb-ingest ./MEMORY.md ./memory/$(date +%Y-%m-%d).md \
  --org $CTX_ORG --agent $CTX_AGENT_NAME --scope private
```

---

## Target

- Session start, every heartbeat, session end — minimum 3 entries
- Each entry captures context state, not just activity
- Update MEMORY.md at least once per week with durable learnings
