---
name: knowledge-base
description: "You are about to research a topic, answer a factual question about the org, or look up context about a person, project, or tool. Before searching the web or asking the user, query the knowledge base first — the answer may already exist from a previous research session. After you complete any substantial research, ingest your findings so future agents do not repeat the same work. The KB is the org's shared memory across all agents."
triggers: ["knowledge base", "kb", "search knowledge", "query knowledge", "ingest", "rag", "semantic search", "what do we know about", "check knowledge", "save to kb", "index documents", "search docs", "look up", "query kb", "kb query", "kb ingest", "store research", "preserve findings", "check existing knowledge", "has anyone researched", "kb setup", "initialize knowledge base"]
---

# Knowledge Base (RAG)

The knowledge base lets you search indexed documents using natural language — memory files, research notes, org knowledge. Query before searching externally. Ingest after completing research.

---

## Query (before starting research)

```bash
cortextos bus kb-query "your question" \
  --org $CTX_ORG \
  --agent $CTX_AGENT_NAME
```

Use this:
- Before starting any research task — check if knowledge already exists
- When referencing named entities (people, projects, tools) — check for existing context
- When answering factual questions about the org — query before searching externally

**Do NOT use this to resume by a specific identifier** (a task ID, a message ID, a filename, a nonce). Retrieval here is embedding-only — there is no lexical/exact-match path — so an identifier carries no semantic signal and a query for one does not fail, it returns a confident, non-empty list of the *wrong* results (measured: querying a real task ID returned an unrelated day's memory file, ranked as if it were a real match). **For "what was task_X / message_Y about," `grep` over `memory/` directly — exact, local, free.** Reserve `kb-query` for genuine semantic recall, where paraphrase is the point (meta-compliance-agent, 2026-07-29, reproduced 4/4 across distinct identifier types before generalizing).

---

## Ingest (after completing research)

```bash
# Ingest to shared org collection (visible to all agents)
cortextos bus kb-ingest /path/to/docs \
  --org $CTX_ORG \
  --scope shared

# Ingest to your private collection (only visible to you)
cortextos bus kb-ingest /path/to/docs \
  --org $CTX_ORG \
  --agent $CTX_AGENT_NAME \
  --scope private
```

Ingest after:
- Completing substantive research (always ingest your findings)
- Writing or updating MEMORY.md
- Learning important facts about the org, users, or systems

---

## List Collections

```bash
cortextos bus kb-collections --org $CTX_ORG
```

---

## First-Time Setup

If the knowledge base hasn't been initialized for this org:

```bash
cortextos bus kb-setup --org $CTX_ORG
```

Run this once per org. Check collections list first — don't re-initialize if already set up.

---

## Workflow Pattern

```
1. User asks question about <topic>
2. kb-query "<topic>" — check existing knowledge
3. If found → answer from KB, cite source
4. If not found → research externally
5. After research → kb-ingest findings
6. Answer user with fresh knowledge now in KB
```
