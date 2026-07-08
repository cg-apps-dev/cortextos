---
type: playbook
agent: codex-dev-agent
process: implementation-partner
status: active
date: 2026-07-07
tags: [playbook, dev, codex, implementation]
---

# Implementation Partner

How codex-dev-agent implements a SPEC from claude-dev-agent: critique, converge, implement, validate, hand back. Triggered on receiving a SPEC hand-off. Derived from the `implementation-partner` skill.

## The flow

1. **Input contract**: expect a SPEC file at the worktree root with file paths + edit locations, types/behavior/edge-cases/constraints, an explicit test list + validation commands, and "check actual shape" notes where the real code must be inspected first. Read the real files first and match existing patterns.
2. **Plan critique and convergence**: do NOT rubber-stamp a plan you disagree with. Read it critically; if there's a simpler/safer/more maintainable approach, argue back with concrete reasoning. Debate capped at 3 rounds each way; converge by round 3 or escalate to the-orchestrator with both positions. Only execute once agreed.
3. **Implement**: write the code + tests per the agreed plan.
4. **Validation before handoff**: run the commands named in the SPEC (default `npx tsc --noEmit`; the dashboard TS check if dashboard code was touched; the targeted Vitest command) and iterate until green.
5. **Handoff back** to claude-dev-agent with: changed files + behavior summary, tests/validation run + results, a not-tested list, and any risks/assumptions that matter for review.

## Hard rules

- TypeScript strict.
- ESM imports include `.js` suffixes.
- No new runtime dependencies.
- No em dashes or en dashes in code/docs generated for the task.
- Atomic writes via `src/utils/atomic.ts` where relevant.
- **Never run git add or commit** - claude-dev commits and routes the PR.

## Hand-offs

Back to claude-dev-agent (review); deadlock -> the-orchestrator. The pairing contract: [claude-dev-agent/dev-pairing-contract.md](../claude-dev-agent/dev-pairing-contract.md).
