# FINDINGS — ANTHROPIC_AUTH_TOKEN override caused the-orchestrator 25h outage (2026-07-27)

Owner: claude-dev-agent (root-caused the outage; fix dispatched to codex-dev-agent). Filed 2026-07-27.

## Symptom
the-orchestrator was effectively dead for ~25h: "acting stupid" / sluggish, then no
response overnight (Adam: "Are you on fable 5?" 07-26 17:27, "Hello?" 22:16, "Are you
online" 07-27 01:47, "?" 04:02). Every model call 429'd. Model switches, fresh-context
restarts, and TWO oauth-token swaps all failed to fix it.

## Root cause
`.env` contained `ANTHROPIC_AUTH_TOKEN=<old cg-team-seat token>`.
`ANTHROPIC_AUTH_TOKEN` **takes precedence over `CLAUDE_CODE_OAUTH_TOKEN`**. So the agent
silently billed the cg-team-seat account regardless of which OAuth bearer was deployed.
That account's monthly spend cap was exhausted → 429 on every call. The override was
invisible to every remedy that targeted the OAuth token.

## Why the swaps didn't fix it
`scripts/deploy-agent-token.sh` rewrites ONLY the `CLAUDE_CODE_OAUTH_TOKEN=` line (awk,
~line 106). It never inspects or strips `ANTHROPIC_AUTH_TOKEN`. So each swap replaced the
bearer that was already being ignored and left the override in place.

## How it got in
No fleet tooling WRITES `ANTHROPIC_AUTH_TOKEN` — grep of `*.sh/*.ts/*.js/*.json` across the
repo is EMPTY. It was a hand-placed legacy team-seat token present since at least
2026-07-11 (`.env.bak-premig-icloud`, `.env.bak-2026-07-11T16-35-51`). It survived the
icloud migration and every subsequent swap because nothing knew to strip it. Fix is
DETECT + STRIP + GUARD, not "stop a writer."

## Current state (verified 2026-07-27 ~17:13Z)
- `.env` and live PID env carry ONLY `CLAUDE_CODE_OAUTH_TOKEN` (override removed). ✓
- Now on the moonlight oauth token (…j3JwAA, shared with cro/strategist/sop-keeper/team-lead).
  May rebalance to icloud (analyst proves it healthy).
- cli verified no OTHER agent carries the override today.
- Stale token-bearing `.env.bak*` files remain in-tree under the orchestrator dir — covered
  by existing human task "BANK-THEN-SHRED the 18 in-tree .env.bak files" (preserve orphan
  tokens first). Do NOT unilaterally shred.

## Fix dispatched → codex-dev-agent (task_1785172699145_26035028, 2026-07-27)
1. Launch guard `enforceIsolatedClaudeCredentialEnv()` (`src/pty/agent-pty.ts` ~L412):
   refuse to spawn if `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` is set.
   Also review `getBaseEnv()` keepVars (~L385) which passes `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY`
   from the daemon parent into every spawned agent.
2. Token audit (`src/cli/doctor.ts`): flag any .env/process env carrying the override vars.
3. `scripts/deploy-agent-token.sh`: strip/comment override lines on swap (with warning).
4. Unit tests + `npm run build` + `npm test` from a clean shell. PR, no merge (approval).

## The durable lesson
`CLAUDE_CODE_OAUTH_TOKEN` is NOT the top of the precedence chain. `ANTHROPIC_AUTH_TOKEN`
(and `ANTHROPIC_API_KEY`) sit ABOVE it and silently redirect billing. A bearer agent can be
"correctly configured" and still be dead because a higher-precedence var points at a dead
account. When a bearer agent 429s and token swaps don't help, `grep -E '^ANTHROPIC_'` the
`.env` BEFORE touching the OAuth token again.
