---
name: codex
description: "Invoke Codex (gpt-5-codex) as a PEER coding/debugging tool from within a Claude Code session — a second model's take on a gnarly bug, an adversarial cross-check of a fix before shipping, or a different architectural opinion. Claude Code and Codex are equal peers; pick whichever fits the task."
triggers: ["ask codex", "codex second opinion", "cross-check with codex", "codex review", "different model take", "peer review a fix"]
---

# Codex Peer Tool

Claude Code and Codex (gpt-5-codex) are **equal peers** for coding/debugging.
Pick whichever is the better fit per task — Codex is one command away, not a
heavyweight fallback.

**Available to every agent.** The dev agent is the primary user (it codes all
day), but any agent can reach for Codex when it has a **coding, scripting, or
debugging** task — a second opinion on a script, cross-checking a fix, a
different take on an approach. It's not for your core non-coding work; it's the
coding/debug peer when you need one.

## When to reach for Codex

- **Second opinion on a gnarly bug** I'm stuck on — a different model covers
  different failure modes.
- **Adversarial cross-check of a fix/diff before shipping** — "here's my change,
  what would break / what did I miss?"
- **A different architectural take** on an approach before I commit to one.
- **Tasks gpt-5-codex is known strong at** (certain refactors, language-specific
  work).

Default to my own judgment for most work; invoke Codex when a second model
genuinely adds signal. Treat Codex's output as advisory — I reconcile it, I don't
blindly apply it.

## How to invoke

```bash
# FAST (default) — second opinion / debugging / approach. Paste the relevant
# code/error into the prompt; Codex answers from the prompt (no repo scan, ~seconds):
.claude/skills/codex/codex-peer.sh "Here's the bug + the function: <paste code/error>. Most likely cause and fix?"

# --deep — repo-aware, only when Codex genuinely needs to read the codebase (slower):
.claude/skills/codex/codex-peer.sh "Trace how <X> flows through src/ and find the leak." --deep

# --review — adversarial code review of the current repo:
.claude/skills/codex/codex-peer.sh "Review my fix for <X> — what breaks or is missed?" --review
```

The wrapper:
- Runs `codex exec --json` non-interactively in a **read-only sandbox** (Codex
  advises — it does NOT modify the working tree).
- **Fast by default**: runs in an empty scratch cwd so there's no repo to scan
  (~4s round-trip). Put the context in the prompt. Use `--deep` only when Codex
  must read the actual codebase (repo scan = slower).
- Prints Codex's answer back to me.
- Logs token usage to `<CTX_ROOT>/logs/<agent>/codex-tokens.jsonl` (same schema
  as the codex-app-server runtime), so the dashboard **Per-Agent Token Usage**
  card counts Codex usage automatically.

## Auth

Codex uses the **ChatGPT login** stored in `~/.codex` (a one-time
`codex login` browser OAuth on the account owner's ChatGPT — no per-token cost,
no key in this repo). Check status with `codex login status` or `codex doctor`.
If a call returns no answer, auth is the first thing to check.

## Notes

- **Latency:** the default fast mode is ~4s (empty cwd, no repo scan). `--deep`
  lets Codex scan the repo, which on the full cortextOS tree can take a minute+ —
  so reach for `--deep` only when the prompt genuinely needs the codebase;
  otherwise paste the relevant snippet and stay fast.
- **Fail-fast timeout:** codex occasionally stalls (network/auth). The wrapper has
  a hard watchdog — fast/`--review` are killed after **90s**, `--deep` after
  **240s** — so a stall can never hang you (or a background slot). On a timeout it
  prints a clear message and exits; just retry. Override with `CODEX_TIMEOUT` /
  `CODEX_DEEP_TIMEOUT` (seconds) if a call legitimately needs longer. Any token
  usage produced before a kill is still logged.
- Read-only by design: for safety, Codex never writes files here — it advises,
  I implement (and own) the change in my normal Claude flow.
- Keep prompts self-contained (paste the relevant code/error); Codex starts
  fresh each call (stateless peer tool).
- Cost shows up per-agent on the dashboard — Codex usage is visible alongside
  Claude usage.
