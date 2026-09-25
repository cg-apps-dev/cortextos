---
type: runbook
scope: fleet
process: usage-cred-remint
executing_owner: the-orchestrator (drives) + Adam (browser-approves, one action per account)
date: 2026-09-25
author: the-sop-keeper
tags: [runbook, fleet, auth, usage-credential, monitoring, re-mint, pkce]
---

# RUNBOOK - Usage-credential re-mint (PKCE-over-Telegram variant)

**What this re-mints:** the per-account **usage-monitoring credential** (the PKCE / `oauth/accounts.json` credential the usage monitor uses to read each account's 5h/7d spend). **Time:** ~2 minutes per account. **Touches usage-monitoring creds ONLY** - it does NOT touch any agent's runtime setup-token, so no agent's inference breaks while you do this.

## Credential class (why this is its own runbook)

The usage credential is a **distinct credential class** from the runtime token - do not confuse the three ([[reference_runtime-token-vs-usage-credential]]):

- **Runtime token** (`.env CLAUDE_CODE_OAUTH_TOKEN`, `sk-ant-oat01` from `claude setup-token`) - RUNS the agent. Re-minting/rotating THAT is a different procedure: `playbooks/fleet/switch-agent-account.md` (Re-mint section).
- **Usage/PKCE credential** (`oauth/accounts.json`) - reads the usage API only; does NOT run an agent. **This runbook.**
- **API key** (`sk-ant-api03`) - not used by the fleet.

Because it is a separate class, this lives in its own runbook and is cross-linked from `switch-agent-account.md` and the `agent-auth` skill - not folded into either.

## When to run it (trigger signature)

Run this when a usage credential has hit its refresh-token wall:

- **TRIGGER SIGNATURE:** the usage dashboard shows the account **UNREACHABLE** AND a manual usage fetch returns **HTTP 400 refresh-reject**. The usage credential's refresh token has a **~27-30 day life**; at that wall the chain can no longer refresh and the monitor goes blind for that account.
- **INSTRUMENT WARNING - do NOT diagnose from the CLI refresh path:** `cortextos bus refresh-oauth-token` reads a **legacy field** and errors `no refresh_token` **even on healthy accounts** - this is a known instrument artifact, not evidence of a dead credential. **The real signal is the dashboard UNREACHABLE + HTTP 400 refresh-reject.** Never build a re-mint decision on the CLI `no refresh_token` error alone (it fires on healthy accounts too).

(An access-token `expires` field a few hours out is NORMAL - the access token auto-refreshes off a healthy refresh token. Only the refresh-token wall - the 400 - needs a re-mint.)

## The two rules that matter

1. **One account at a time, start to finish.** There is only ONE pending-auth slot fleet-wide - starting a second account before completing the first WIPES the first. Complete each account (both commands + earned-green) before moving to the next.
2. **Finish within ~10 minutes of starting an account** - the authorize code expires. If a step errors or the code lapses, just re-run `add-usage-account <account>` to re-arm a fresh flow.

## The PKCE-over-Telegram flow (settled variant, executed 2026-09-24)

This variant splits the work: **the operator runs BOTH commands; the human's only action is to browser-approve and send the code back over Telegram.** The human never touches a terminal.

**Step A - operator starts the flow** (terminal):
```
cortextos bus add-usage-account <account>
```
It prints a long authorize URL (with a `state` fragment) and the exact completion command. **Send the human the authorize URL over Telegram.**

**Step B - human approves in a browser** logged into THAT SAME account (e.g. the iCloud Apple-ID Claude login for an icloud account; the team seat for `cg-team-seat`):
- Approve. The callback page shows a **code**, typically in the form `<code>#<state>`.
- The human **sends the whole `<code>#<state>` string back over Telegram**.

**Step C - operator completes** (terminal), pasting the code **whole, in quotes, exactly as sent**:
```
cortextos bus complete-usage-auth <account> "<code>#<state>"
```
- **Sanity-check before pasting:** the `<state>` fragment after the `#` must match the `state` in the authorize URL printed in Step A. A mismatch means the code is from a different/stale run - re-run `add-usage-account <account>` and redo B-C.
- Success prints: `Usage credential stored for <account>: <fingerprint> (expires ...)`.

## Earned green (verify - "stored" is NOT the finish line)

`Usage credential stored` means the mint wrote; it does NOT by itself prove the monitor recovered. **The earned-green check is:**
```
cortextos bus check-all-usage
```
- **DONE-WHEN:** it prints a **RECOVERED** alert for the account (the monitor picked the fresh credential up and the account fetches clean). A bare "stored" without a RECOVERED is not yet done.
- The monitor auto-picks-up new creds on its next **5-minute** cycle - **nothing to restart.**

## Order + skipping

- Do **blind-now** accounts (dashboard UNREACHABLE) first, then accounts near the wall.
- **Skipping an optional/benched account:** if an account has zero runtime consumers and the human skips it, consider `cortextos bus set-account-benched <account>` so its dead usage cred does not keep re-alerting UNREACHABLE. (Check first whether the UNREACHABLE card actually bothers the operator before benching.)

## If something errors

- **"State mismatch"** / **"Token exchange failed (HTTP ...)"** -> the code was stale or from a different run. Re-run `add-usage-account <account>` and redo B-C promptly.
- **"Pending auth is for account X, not Y"** -> a different account was started in between (single pending slot). Re-run `add-usage-account` for the account you actually want.
- Any account retries independently; a failure on one does not affect the others.

## Bank-to-store step (PENDING Adam C1 - do NOT execute yet)

> **GATED - not yet approved.** A store-bank step (from the 2026-09-08 class-fix) is proposed to be added here, but it is **pending Adam C1 approval** and the orchestrator's dispatch of the exact spec - tracked in **task_1788966198277**. Until that lands, this section is a placeholder: **do not** bank usage creds to any store as part of this runbook. The ungated spec is deliberately NOT folded in as if approved. When C1 lands, the orchestrator dispatches the exact step and this section is filled via the reviewed-branch flow.

## Related

- [switch-agent-account.md](switch-agent-account.md) - RUNTIME setup-token switch/re-mint (a DIFFERENT credential class); its Re-mint section cross-links here.
- `agent-auth` skill - the auth model + the three-credentials distinction; cross-links here for the usage-cred class.
- Base flow of record: claude-dev deliverable `RUNBOOK-usage-cred-reauthorize-2026-09-11.md` (agent-dir, untracked) - this runbook supersedes it as the tracked fleet home and adds the settled PKCE-over-Telegram variant + earned-green + trigger-signature + instrument warning.
