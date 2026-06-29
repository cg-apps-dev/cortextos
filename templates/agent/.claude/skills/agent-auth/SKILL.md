---
name: agent-auth
description: "How cortextOS agents authenticate to Claude - the three auth modes (login/keychain, setup-token/bearer, API key), the connector-bridge pin, the per-account setup-token procedure, the one-at-a-time migration runbook, bearer-on-metered usage monitoring, and dead-auth troubleshooting. Use when provisioning a new agent, migrating an agent off login/keychain, diagnosing a please-run-/login or 401 or silent agent, or rotating an account's runtime token."
---

# Agent Authentication (Claude runtime auth)

The HARD RULE: **every persistent cortextOS agent authenticates via a fresh per-account `claude setup-token` (bearer), never interactive-login/keychain.** This skill is the how-to + troubleshooting behind that rule. The rule itself is in the platform `CLAUDE.md` (Agent authentication section) and `orgs/<org>/knowledge.md`.

## Why this exists (the incidents)
A 24/7 agent on interactive-login auth breaks on a timer, and we kept band-aiding it instead of changing the mode. The incidents that forced the rule (2026-06):
- **Two icloud keychain incidents** - login-mode agents on the icloud account went `401` / "please run /login" mid-session ~hours after a `claude login`, taking the agents down until a re-login (which only re-armed an 8h token that rotated out again).
- **The moonlight weekly-cap hang** - an agent silently wedged (stable PID, stale heartbeat) on an interactive prompt, looking "running" while doing nothing.
- **ROOT CAUSE = Claude Code OAuth refresh bug #31095:** interactive `claude login` stores an **8-hour access token + a refresh token it NEVER uses** → forces a re-login ~every 8h → any persistent login-mode agent breaks on that cycle, in-session AND at reboot. Re-login / minting another token never fixed it because it never changed the MODE.
- **The proof:** the infra agents already on bearer setup-tokens (claude-dev, analyst, security, orchestrator) rode through every incident untouched. Bearer is self-contained (we hold the token ~1yr), not native-app-rotated/relocated. So the durable fix is the mode, not another re-login.

---

## 1. THE AUTH MODEL (three modes + precedence)

| Mode | What it is | Token shape | Lifetime | Bridge connectors? | Use for agents? |
|---|---|---|---|---|---|
| **LOGIN / keychain** | `claude login` → native Claude Code app stores the OAuth token in the macOS Keychain item `Claude Code-credentials` | login-class `sk-ant-oat01` (carries `user:profile` scope) | **8h access token; refresh token NEVER used (#31095)** → rotates ~hours, relocates on CC app updates | **YES** - the claude.ai MCP bridge only works in login mode | **NO** - fragile, breaks in-session + at reboot |
| **SETUP-TOKEN / bearer** | `claude setup-token` minted AS an account → put in `.env` as `CLAUDE_CODE_OAUTH_TOKEN` | `sk-ant-oat01` (OAuth setup-token, lacks bridge scope) | **~1 year, self-contained** (we hold it; not native-app-rotated/relocated) | **NO** - bearer KILLS the claude.ai bridge | **YES - this is the rule.** Keychain-bypassed, reboot-stable |
| **API key** | `ANTHROPIC_API_KEY` env var | `sk-ant-api03` | account-managed | NO | Not used by the fleet (billing/behaviour differs); avoid unless a deliberate API-only service |

**Precedence** (what Claude Code actually uses at runtime): `CLAUDE_CODE_OAUTH_TOKEN` in the process env (bearer) takes precedence over the keychain login. Setting it = bearer mode = keychain bypassed AND the claude.ai bridge killed. `ANTHROPIC_API_KEY` is a separate path. So presence of `CLAUDE_CODE_OAUTH_TOKEN` in a live agent's process env is the definition of "this agent is on bearer / keychain-independent."

**Three credentials people confuse - they are NOT interchangeable** ([[reference_runtime-token-vs-usage-credential]]):
- **Runtime token** = the setup-token in `.env CLAUDE_CODE_OAUTH_TOKEN`. RUNS the agent (inference). `sk-ant-oat01`, minted `claude setup-token`.
- **Usage/PKCE credential** = in `oauth/accounts.json`, used ONLY to read `/api/oauth/usage` (per-account 5h/7d). Login-class (has `user:profile`). A setup-token gets 403 on the usage API. A valid usage-cred does NOT run an agent.
- **Stored access_token** = a cached short-lived token; not a runtime token.
A reused/stored/PKCE token put in `.env` will NOT run the agent (it is "dead for runtime"). Mint a FRESH setup-token AS the account.

---

## 2. THE CONNECTOR PIN (why some agents can't go bearer yet)

claude.ai MCP **bridge connectors only work in login mode**; bearer kills the bridge ([[reference_oauth-token-kills-connector-bridge]]). So an agent that NEEDS a bridge connector cannot go bearer until that connector is migrated to a credential we own.

| Bridge connector (login-only, dies on bearer) | Own-credential replacement (survives bearer) |
|---|---|
| AdManage (Meta ads) | Meta Marketing API - system-user token (`ads_management`) |
| Slack (claude.ai bridge) | Slack **bot token** (`xoxb-`) via a local `slack_client.py` |
| Sheets / Drive (bridge or Composio) | **`gog`** (own Google OAuth, e.g. `adam@cleangreen.com`) - `gog sheets get`/`batch-update`, `gog drive ls`/`get`/`download` |
| ClickUp (bridge) | ClickUp **REST** API (token) |
| Composio (workbench/MULTI_EXECUTE = claude.ai-hosted) | the underlying op's own-cred path (gog for Sheets/Drive, etc.) - Composio-via-bridge dies on bearer |
| (own-key **stdio** MCPs, e.g. TripleWhale/ZapPush with their own API keys) | **already survive bearer** - they are direct MCP, not the claude.ai bridge. No migration needed. |

**Migration order for a bridge-bound agent: migrate the connector to its own-credential API FIRST, prove it works, THEN switch the agent to bearer.** No agent stays on login "for the connector" as a permanent state - it is a migration backlog item. To tell bridge-vs-own-key: the global MCP config naming a connector as "claude.ai X" = bridge (dies on bearer); a stdio MCP with its own key in args/env = survives.

### Worked connector migrations (the migrate-first pattern in practice)
- **team-lead: Slack bridge → `SLACK_BOT_TOKEN` (DONE).** team-lead's only bridge dep was Slack. Migrated to a Slack **bot token** (`xoxb-`) driving a local `slack_client.py` (env-only token, never logged, post gated). VERIFY that proved the connector was replaced not just staged: read all 5 marketing channels (a) pre-migration and (b) post-restart with the claude.ai bridge DEAD - 5/5 both times. `not_in_channel` would have meant an invite gap (an Adam `/invite`, not a code bug). Then bearer (me.com). The pre-flight-vs-post-bridge-dead comparison is the gold-standard proof for any connector migration.
- **meta-ads: Composio → `gog` (DONE tonight).** meta-ads' intake engine + creative-compliance-scan ran through Composio (a claude.ai-bridge workbench) - dead on bearer. Migrated all Sheets/Drive ops to **`gog`** (own Google OAuth, `adam@cleangreen.com`): `sheets get` (read), `sheets batch-update --data-json` (ATOMIC multi-range, comma+formula-safe - the positional `update` would corrupt comma-laden values), `drive ls --parent --page` (paginated folder list), `drive get --fields thumbnailLink` (render-gate), `drive download` (OCR/whisper). Lessons worth keeping: (1) **gog `drive get` NESTS its result under a `"file"` key** - `d.get("thumbnailLink")` at top level is always None (a render-gate bug); use `(d.get("file") or d).get("thumbnailLink")`. (2) **Option-A "drop per-file Drive share"** held: `=IMAGE` renders NON-shared member-only shared-drive files via the sheet-owner's Drive-member access - proven headless (38 existing videos + a 1-cell non-shared-image test render, no `#REF`); the anon-thumbnail-endpoint failing was the WRONG proxy (anon ≠ member); a fresh sheet's `#REF` is the one-time desktop "allow external URL fetch" auth-block, not a sharing result. So no Drive token was needed.
- **meta-media-buyer (mmb): AdManage → Meta Marketing API (PARKED pattern).** mmb's AdManage (claude.ai bridge) → Meta **Marketing API** (a Business **system-user token**, `ads_management`, granted on all target ad accounts). Design choice surfaced: the Graph API has no clean "Ads-Manager draft" object, so the durable path is **create real PAUSED ads** (zero spend; Adam activates instead of "publish draft") rather than replicate an unsupported draft surface. Gated on Adam minting the credential + confirming the PAUSED-ads design. Same shape: migrate the connector first, then bearer.

---

## 3. PER-ACCOUNT SETUP-TOKEN PROCEDURE

**Account ↔ email map** (Clean Green fleet; the billing account name is what `list-agent-accounts`/`usage_account` use):
- `cg-team-seat` = adam@cleangreen.com (metered, extra-usage ON)
- `icloud-max-20x` = afolker@icloud.com (metered, extra-usage ON)
- `me-com-max` = afolker@me.com (NOT metered, extra-usage OFF)
- `moonlight-max` = the moonlight account (extra-usage OFF)

**Steps (per account):**
1. **(HUMAN GATE - Adam) mint a FRESH `claude setup-token` AS the target account.** Authenticate as THAT account identity (incognito/clean browser signed into that account, or pick it on the consent screen). Output: `sk-ant-oat01-...`. Must be fresh + minted-as-the-account (a reused/stored token is dead-for-runtime).
2. **Deliver the token via an ATTACHED FILE, never chat** (secret-handling). It goes straight into the agent `.env`.
3. **Apply - FLIP BOTH HALVES together** (so attribution can't cross-account-mislabel):
   - `.env`: set `CLAUDE_CODE_OAUTH_TOKEN=<the setup-token>` - exactly ONE active line (strip stale/commented/`#ROTATION-TEST#`/empty-placeholder token lines), file `chmod 600`.
   - `config.json`: set `usage_account` = the target billing-account name (the setup-token will NOT token-match `accounts.json`, so this override is what attributes the usage gate to the right account).
4. **Verify** (after the restart, §4): `cortextos bus list-agent-accounts` shows the agent on the target account (`SOURCE=token-match` or `override`); `cortextos bus list-oauth-accounts` shows the account's usage reads are honest + distinct (no mirror).

**Token hygiene (leak class):** tokens live ONLY in `.env` (0600) and the out-of-tree env backups. NEVER write a token to a `.rtf`, an export, chat, or any file that can ride into git or the agent-state backup. After applying from a delivered `.rtf`, **shred it** (`dd if=/dev/urandom` overwrite ×2 + `rm`). The backup excludes `*.rtf`, but the rule is: no token in any `.rtf` ever.

---

## 4. MIGRATION PROCEDURE (login/keychain → bearer)

The executable runbook is `claude-dev-agent/.../staging/specs/RUNBOOK-step2-setup-token-migration.md`. Core discipline:

- **ONE agent at a time, stabilize-before-moving.** Apply → restart → VERIFY (below) → only then the next. Never batch. Never move/restart agents during an auth wobble.
- **VALIDATION-FIRST:** start with a low-stakes / idle agent (pure token-swap, no connector change) to shake out the procedure before any heavy or business-critical agent.
- **RESTART = `stop` → wait 60s → `start`, NOT a plain `cortextos restart`.** Plain restart trips the daemon dedup / orphan-poller race ("start request deduped - already in registry"); the 60s wait clears the wedged in-flight registry entry. NOTE: a "deduped - already running" message can mean the recovery's first `start` ALREADY succeeded - check `cortextos status` for the agent showing `running` + fresh uptime before assuming it failed. ([[reference_daemon-orphan-poller-leak]])
- **The daemon re-reads `.env` even when it resumes claude via `--continue`** - so a stop→start gives the new bearer env AND preserves conversation history. Confirmed: `CLAUDE_CODE_OAUTH_TOKEN` appears in the live PID env post-restart though it was absent pre-migration.
- **BURST-429 at boot (don't panic):** concentrating many agents on ONE account and booting/restarting them near-simultaneously can trigger transient server-side `429`s - `"temporarily limiting requests (not your usage limit)"`. That is a **concurrency throttle, not a usage cap and not a bad token**; it self-heals as the boots stagger. The one-at-a-time discipline already mostly avoids it - if you see it mid-migration, wait it out, do not treat it as a cap or re-mint a token.

**VERIFY each agent before the next** (behavioral gates do NOT distinguish bearer from a still-valid keychain - the env-var proof is the distinguisher):
- (a) **boot-clean** - no "please run /login" / 401 in stdout after restart.
- (b) **inference** - the agent processes a turn / responds.
- (c) **attribution** - `list-agent-accounts` shows the target account (token-match or override); usage reads honest + distinct.
- (d) **tools** - a representative own-credential tool call succeeds (the agent's MCPs/direct-API tools are NOT the bridge); if it unexpectedly hits a claude.ai connector → STOP, hidden bridge dep, revert + flag.
- (e) **DEFINITIVE BEARER-PROOF (leak-safe, names only):** `CLAUDE_CODE_OAUTH_TOKEN` is present in the LIVE process env →
  ```
  ps eww -p <agent-claude-pid> | tr ' ' '\n' | grep -oE '^CLAUDE_CODE_OAUTH_TOKEN='
  ```
  `grep -o` on the `VAR=` pattern prints only the name+equals, NEVER the secret. Login agents have no such var; its presence proves bearer / keychain-independent (the #31095 failure mode is gone for that agent).

**Per-account capacity / load-balance** ([[reference_account-move-churns-global-gating]]):
- A setup-token for an account can serve MULTIPLE agents (each `.env` holds it; they share that account's 5h/7d cap).
- **Metered accounts** (extra-usage ON = a never-stop safety valve) take HEAVY agents. **Unmetered** (me-com OFF = a cap is a HARD STOP) take LIGHT agents only - never put a medium/heavy agent on a meter-OFF account.
- Spread agents across accounts so no single account is the bottleneck. Each assignment = a separate Adam setup-token mint AS that account.

---

## 5. MONITORING bearer-on-metered accounts (the 7d under-read)

**`/api/oauth/usage` `seven_day` (weekly_all) UNDER-READS bearer-on-metered burn.** After agents move to bearer on a metered account, their real burn surfaces in **`five_hour`** + **`extra_usage`/`spend.percent`**, NOT in the `seven_day` weekly_all (which can decouple - drop 25%→3% on the same unchanged window). The monitor (`src/bus/oauth.ts`) historically read ONLY `seven_day.utilization`, so it under-reads bearer accounts. ([[oauth-usage-api-mechanism]])

- **WATCH `five_hour`** = the reliable LIVE bearer-burn signal (the binding capacity signal).
- **WATCH `extra_usage`/`spend.percent`** as an OVERAGE-ONSET signal: flat = OK (it is a flat monthly balance, not a live tracker); **rising from flat = real overage beginning** (the metered safety valve actually engaging).
- **Do NOT alarm/gate on `seven_day` alone** - a 7d-low on a bearer account is NOT "safe", it is decoupled.
- DISCONFIRMED (do not re-pursue): the burn does NOT move to `seven_day_oauth_apps` - that sub-bucket reads NULL; summing the per-family 7d sub-buckets is a no-op fix.
- The exact internal reason `seven_day` reclassifies is Anthropic-billing-internal / not API-determinable - it does not block the fix (watch 5h + spend, not 7d-alone).

---

## 6. TROUBLESHOOTING (dead auth)

**Symptoms of a dead LOGIN-mode token:** "Please run /login", `401`, socket closed mid-session, OR a "silent" agent - stable PID + stale heartbeat (looks running, actually wedged on a TTY `/login` prompt or an Anthropic server-side rate-limit). ([[reference_agent-stuck-on-interactive-prompt]])

**Before restarting ANY login-mode agent: verify the keychain is healthy FIRST.** Restarting onto a dead/stale keychain token makes it worse. `security find-generic-password -s "Claude Code-credentials"` (exit 44 = item absent; -25308 = perm denied). NOTE the **native-CC keychain RELOCATION** (Claude Code 2.1.161 moved OAuth creds off the legacy `Claude Code-credentials` item) - an "absent" keychain item may be relocation, not loss, and is NOT a reason to re-auth; it is an in-house code concern ([[reference_native-cc-keychain-relocation]]). The durable answer to ALL of this is: stop band-aiding login mode - migrate the agent to a bearer setup-token (§3/§4).

**Cred-type confusion (the #1 procedure error):** setup-token ≠ usage/PKCE cred ≠ stored access_token (§1). "I have tokens but they don't work for runtime" almost always = the wrong cred type (a usage/PKCE cred, or a stale/reused token) in `.env`. Fix = mint a FRESH `claude setup-token` AS the account.

**Restart deduped + agent down:** the daemon orphan-poller race - `stop` → wait 60s → `start`; a 2nd cycle if needed; a full daemon restart only as a last resort (it bounces the whole fleet - coordinate first). ([[reference_daemon-orphan-poller-leak]])

**Connector "broke" after a bearer migration:** expected if the agent had a hidden claude.ai-bridge dependency - bearer kills the bridge. Migrate that connector to its own-credential API (§2), don't revert to login.

---

## Cross-references
- HARD RULE (structural): platform `CLAUDE.md` → Agent authentication section; org `knowledge.md` → HARD RULE - AGENT AUTHENTICATION (6 points).
- Runbook: `RUNBOOK-step2-setup-token-migration.md`. Findings: `FINDINGS-agent-auth-durable.md`. Monitoring fix: `SPEC-usage-monitor-7d-decouple-fix.md`.
- Memories: runtime-token-vs-usage-credential, oauth-token-kills-connector-bridge, oauth-usage-api-mechanism, native-cc-keychain-relocation, daemon-orphan-poller-leak, account-move-churns-global-gating, agent-auth-bearer-endstate.
