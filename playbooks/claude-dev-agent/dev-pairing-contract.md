---
type: playbook
agent: claude-dev-agent
executing_owner: claude-dev-agent + codex-dev-agent (shared)
process: dev-pairing-contract
status: active
date: 2026-07-07
tags: [playbook, dev, pairing, codex-first]
---

# Dev Pairing Contract

The working protocol between claude-dev-agent (plans + reviews) and codex-dev-agent (implements), per Adam's directive 2026-06-12, mirrored in both agents' IDENTITY.md. Purpose: maximize Codex execution (the cheap lane), keep Claude on planning + review, and let the debate rounds catch bad plans before they become code. Event-driven, per coding ticket.

## The 6-step protocol

1. **Claude-dev PLANS all work** - high-level planning, architecture, specs. Every coding task starts with this agent's plan.
2. **Codex-dev may ARGUE BACK** - the plan goes to codex-dev, which critiques it and may counter with a different approach.
3. **Debate is capped at 3 rounds each way.** By the end of round 3 the two MUST converge on one agreed path. If genuinely deadlocked, escalate to the-orchestrator with both positions stated - never proceed unagreed, never loop past 3.
4. **Codex-dev EXECUTES the agreed plan** - all code and tests are written by codex-dev.
5. **Claude-dev REVIEWS every line** - raw file reads, full review. Change requests go BACK to codex-dev to execute; the reviewer never silently fixes the code (small/security-sensitive direct-write exception only, logged).
6. **Iterate review -> fix until approved**, then normal ship flow: PR via the-orchestrator, Adam approves.

## Standing rules

- Branches only - one feature branch per ticket, never commit to main.
- Every change is a PR Adam reviews and approves (route via the-orchestrator).
- Build + typecheck (`npx tsc --noEmit`) + run tests before opening a PR; `npm run build` is the orchestrator's deploy step, not branch validation.
- Machine code is always reviewed (Adam standing rule, non-negotiable).
- Ask first before any significant action (low autonomy by Adam's preference).
- Log the Codex/Claude token split per build.
- Post-rebase integrity = `git range-diff <old-base>..<old-commit> <new-base>..<new-commit>` proving patch-identity (`=` lines), never tree-hash-unchanged; then re-validate on the NEW base - the base changed even though your files did not.

## Hand-offs

claude-dev -> codex-dev (spec) -> claude-dev (implementation review) -> the-orchestrator -> Adam (PR/approve). Deadlock -> the-orchestrator. Codex's execution-side detail is in [codex-dev-agent/implementation-partner.md](../codex-dev-agent/implementation-partner.md).
