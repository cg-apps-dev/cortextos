# FINDINGS: the staged PM2 `LimitLoadToSessionType=Aqua` fix INVERTS on a no-auto-login box

**Date:** 2026-08-22
**Author:** claude-dev-agent
**Trigger:** the-orchestrator proposed green-lighting an Adam-present Mon-Wed window to apply the staged PM2 Aqua-session durable fix BEFORE Adam left for ~a week unreachable (Burning Man), reasoning "unattended power-blip reboot with the plist key absent = fleet down until he returns."
**Verdict:** BLOCKED the pre-departure apply. The premise is backwards for this machine. Human task (approve fleet-restart timing for the Aqua fix) closed as premise-inverted.

---

## The one load-bearing fact

**Auto-login is OFF on this machine.**
- `defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser` -> not set
- `/etc/kcpassword` -> does not exist

On an unattended reboot, the machine sits at the login window. No GUI (Aqua) session is created until a human physically logs in.

## The mechanism

`LimitLoadToSessionType=Aqua` restricts a LaunchAgent to load ONLY inside an Aqua (GUI login) session. It HOLDS the job until such a session exists.

- **Key ABSENT (current state):** launchd loads PM2 in the pre-login sessionless context, so the fleet comes UP. This is not theory. It is exactly what the Jul 19 2026 boot did: PM2 loaded ~100s after boot with no Aqua session and ran sessionless for 9 days until Adam logged in Jul 28 (load-bearing evidence: PM2 restarts=0 + `kern.boottime` Jul 19, measured 2026-07-29). So an unattended reboot today brings the fleet back UP (sessionless).
- **Key PRESENT (the staged fix):** on a headless reboot with no auto-login, no Aqua session is ever created, so PM2 does NOT load until a human logs in. The fleet would be DOWN for the entire unattended window.

**Therefore the premise "key absent = fleet down until return" is inverted for a no-auto-login box:**
absent = up-sessionless; present = down-until-login. Applying the staged fix right before a no-operator week would CREATE the exact catastrophe it was meant to prevent.

## Two compounding reasons not to rush it

1. **Never reboot-tested.** Only a reboot distinguishes whether the fix behaves - an in-session bounce inherits the live Aqua session and passes regardless (documented gate, 2026-07-29). The B2 reboot gate never ran. Shipping unproven session semantics immediately before a no-operator week is peak-regret timing.
2. **The problem it targets may already be moot.** The classic sessionless breakage was a locked login keychain. The fleet moved to bearer setup-tokens in `.env` (not keychain) on 2026-07-24, so sessionless PM2 likely runs fine now. Whether sessionless degrades anything today was never pinned - and matters before spending any window on this.

## The surviving constraint the inverted remedy was hiding: gog needs an unlocked login keychain

The source spec (task_1785358840915, 07-29, "durable gog/keychain fix") bundled a REAL problem with the
now-inverted remedy. The remedy (Aqua key on PM2) is dead. The **problem statement survives** and is
verified still-live 2026-08-22:
- gog stores its OAuth creds in the macOS **login keychain**: `security find-generic-password -s gogcli`
  resolves to `login.keychain-db`, service `gogcli`.
- It runs on the full keychain-backed token - `gog auth list` shows ~22 scopes (ads, analytics, gmail,
  calendar, drive, sheets, ...). The file backend only ever carried 3 scopes (docs, drive, sheets - 07-29).
- The login keychain only unlocks with a GUI (Aqua) login. On a headless sessionless reboot it stays
  locked, gog sees no tokens ("No tokens stored", exit 0 - the 07-29 empirical before/after), and every
  gog-dependent task breaks: Facebook Assets Tracker reads, analyst meeting-notes ingest, any
  Gmail/Drive/Sheets/Ads pull.

**This is NOT covered by the 07-24 bearer migration** - that fixed `CLAUDE_CODE_OAUTH_TOKEN` (agent runtime
auth). gog is a separate keychain consumer, untouched. So "sessionless is moot now" is true for agent
auth and FALSE for gog.

## Correct direction (the real re-spec - post-Burning-Man, no urgency)

The gog constraint is the DECIDING variable, because the candidate directions split on exactly it:

1. **LaunchDaemon** (PM2 as a system daemon): fleet comes UP on a headless reboot, BUT the user login
   keychain is still locked without a GUI login, so **gog is blind until Adam logs in**. Trades
   fleet-down-until-login for fleet-up-but-gog-blind-until-login. Possibly acceptable (agents run, gog
   tasks wait), but a conscious call.
2. **Enable auto-login**: an Aqua session at boot unlocks the login keychain, so **fleet up AND gog works**
   - the only path that fully preserves gog. Cost: physical / data-at-rest security (machine boots into an
   unlocked session; login keychain auto-unlocks) - security-agent should weigh this.
3. **Decouple gog from the session**: move gog to a file / encrypted-file keyring re-authed with ALL
   scopes. If the file backend can hold all ~22 scopes, the session dependency evaporates and both
   LaunchDaemon and even no-fix become viable. 07-29 showed file=3 scopes, but that was a reduced re-auth,
   not a proven ceiling - needs a scope-capacity test.

**Sequencing (decided with the-orchestrator 2026-08-22): run avenue 3's scope-capacity test FIRST.** It is
the cheapest node - no reboot, no fleet disruption - and it can collapse the whole decision tree: if all
~22 scopes fit an encrypted-file backend, the session dependency evaporates and avenues 1/2 (and the
security data-at-rest review, and the Adam pick) may never be needed. Only engage security-agent on the
auto-login trade-off if the decouple fails and auto-login is still on the table.

**ISOLATION CAVEAT on the scope-capacity test (load-bearing):** run it in a throwaway GOG config/HOME or a
temp keyring. A naive re-auth-to-file would OVERWRITE the live 22-scope keychain cred the fleet depends on
right now and cause the exact gog outage under study. Non-destructive, isolated, restore-clean.

Any chosen path **MUST be validated at a real machine reboot with Adam present** (the only test that
distinguishes - an in-session bounce inherits the live session and passes regardless). Do not apply blind.

Keyless PM2 provably survives an unattended reboot with the fleet up (gog degraded until login), so there
is no urgency - this is a durability/correctness improvement, not a save.

## Separable note (so this doesn't get bundled wrongly)

The watchdog activation (heartbeat-staleness) and the telegram/DNS daemon-side crash-prevent fix (`b663ad5a`) are **daemon-bounce-activated, not reboot-gated, and are ALREADY LIVE** in the running daemon (pid started 2026-08-20 on the 08-14 dist that contains both; DNS runbook records SWAPPED-TO-LIVE 08-14, RESOLVED via self-cure 08-20). They never rode the Aqua reboot question and need no window.

## Pattern

Verify the live artifact and the load-bearing precondition (auto-login state) before scheduling a fix - a spec written months earlier can encode a premise the current machine inverts. A "fix" whose direction depends on an unverified environment fact can convert the failure it targets into the failure it causes.
