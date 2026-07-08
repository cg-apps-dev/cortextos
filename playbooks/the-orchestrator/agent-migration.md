---
type: playbook
agent: the-orchestrator
process: agent-migration
status: active
date: 2026-07-07
tags: [playbook, orchestrator, agent-lifecycle, migration]
---

# Agent Migration

Bringing an existing agent into the system (or renaming/re-homing one). Event-driven. Derived from `.claude/skills/agent-migration/SKILL.md`.

## The governing principle

**Knowledge transfers. Behavior does not.** Do NOT copy-paste files wholesale - rewrite them in clean v2 format.

## The phases

1. **Audit the source workspace**: identify the source location, catalog by category, present the audit to Adam (always, before executing).
2. **Create the new agent** (do NOT start it yet - pre-load files first).
3. **Extract knowledge (read before writing)**, per file with a keep/discard test:
   - MEMORY.md -> durable facts only (keep: user preferences, business facts, user-set workflow rules, contacts, account details, discovered patterns; discard: old file paths, old bus scripts, system internals, session state, error workarounds). Test: "Is this still true about the world, or a patch for an old system bug?"
   - GUARDRAILS.md -> selective port (keep only rules Adam set, not ones the agent added for an old bug).
   - USER.md -> port fully. IDENTITY.md -> port role/vibe/work-style. SOUL.md -> write fresh from the v2 template, only carry day/night hours + explicit autonomy rules. TOOLS.md -> use the v2 template. config.json -> extract crons (update skill paths, drop crons referencing old bus scripts).
4. **Copy files** (skills, CRM, meetings, documents) - never the .env/secrets (source fresh from Adam).
5. **Write bootstrap files** (goals.json, fresh SOUL.md).
6. **KB ingestion.**
7. **Boot + onboarding**: dispatch a workspace-orientation message, then migration-aware onboarding.

## Slug-rename addendum (same-system v2 rename)

- State-dir artifacts do NOT port: `${CTX_ROOT}/state/<old-slug>/.onboarded` - a new slug boots into first-boot/onboarding despite a full workspace. Port or recreate the flag BEFORE first start.
- Same bot token on old+new = Telegram 409 conflict: stop + DISABLE old, wait 60s+, then start new.
- config.json `agent_name` must be updated to the new slug.

## Hard rules

- Never copy .env/secrets - source fresh from Adam.
- Standard v2 skills are already in the template - don't overwrite with old versions.
- Always present the audit to Adam before executing.

## Hand-offs

Related: [account-onboarding.md](account-onboarding.md). agent-management's process gates here ("Migration Check REQUIRED" before writing any bootstrap files).
