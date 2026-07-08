---
type: playbook
agent: the-orchestrator
process: account-onboarding
status: active
date: 2026-07-07
tags: [playbook, orchestrator, accounts, auth, onboarding]
---

# Account Onboarding

Onboarding a new Claude Max/Team plan account into the fleet + dashboard. Event-driven - run whenever Adam adds a Claude subscription account. Derived from `.claude/skills/account-onboarding/SKILL.md` (proven end-to-end 2026-06-10/11). See also the auth model in the `agent-auth` skill.

## The phases

0. **Plan purchase** (Adam, browser).
1. **Decide the account's role**: heavy compute lane (dev/analyst/security/orchestrator) -> token-auth (setup-token in .env), bridge suppressed; ad-ops lane (needs AdManage/Composio/Sheets MCPs) -> login-auth (keychain), bridge preserved.
2. **Mint + validate the session token** (if token-auth).
3. **Wire agents** (if token-auth): token line into each agent .env.
4. **Usage monitoring + dashboard**: add the login-class PKCE usage credential (scope user:profile - setup-tokens 403 on the usage API), one account at a time (PKCE links expire ~10 min); the launchd check-all-usage job auto-renders the dashboard card.
5. **Connector parity** (if the account may carry login-auth agents): claude.ai attach is only the outer layer; Composio's internal connected-accounts start empty; a connector change needs a fresh session (not --continue).
6. **Bench state + alerts**: at re-enlist, `set-account-benched <name> false` BEFORE assigning load, or it carries load with alerts suppressed.

## Hard rules

- **Confirm the plan is ACTIVE before minting any token** - a token minted while the workspace is still Free binds to the Free bucket forever.
- **Workspace matters, not email** - the token binds to whichever workspace is picked during browser auth; picking wrong bills the wrong bucket.
- **Extra-usage toggle is an explicit per-account decision** (ON = never-stop valve, monitor alerts on RISING; OFF = caps are hard walls). Record it.
- **Token reaches the orchestrator via file-attach only** - never echo, redact from output, delete the file after wiring.
- **Call-success is NOT bucket-binding proof** - the only ground truth is Adam's claude.ai usage page showing the probe burn; phrase claims as "proven from my side, yours to confirm".
- **Fail-closed on an unexpected granted scope set** (e.g. org:create_api_key) - never silent-store.

## Hand-offs

Adam owns purchase, browser auth, token mint, PKCE approve, connector attach, and the usage-page screenshot; the launchd usage job renders the dashboard card. Related lifecycle: [agent-migration.md](agent-migration.md).
