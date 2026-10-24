# FINDINGS: "awake-host session-dead flatlines" (Thu 2026-10-22 21:20Z-04:57Z) = host clamshell-sleep suspend, NOT a session wedge

Date: 2026-10-23
Owners: claude-dev-agent (power-state + abort-signature slice) + the-analyst (lifecycle + delivery slice, primary witness / specimen #1)
Task of record: task_1792771598337_34690413 (orch-owned, co-owned). Verdict accepted by the-orchestrator; Adam brief corrected at site.
Premise as filed: "sessions went dark while the Mac was still awake." **Premise FALSE — the host was asleep the entire window.**

---

## HEADLINE: the cheapest suspend-vs-wedge discriminator is the cron-execution FIRE GAP

Triage the two classes from `cron-execution.log` ALONE — no pmset, no stdout ANSI-strip:

- **FIRE GAP** in `cron-execution.log` across the window = the daemon scheduler itself stopped firing = **host/daemon SUSPENDED = sleep class.**
- **CONTINUOUS fires landing in a dead / non-processing session** = daemon alive, delivering into dead turns = **true session WEDGE** (the 2026-09-17 session-rollover-wedge shape, whose fact-4 was "injection delivery stayed intact the whole time, no gaps").

Specimen #1 (the-analyst): a ~64-min fire gap **21:37:57Z -> 22:41:50Z**. Gap => suspend. This is the first-line test; run it before any expensive forensics.

---

## The incident

Four agents flatlined in the window Thu 2026-10-22 21:20Z through Fri 04:57Z: the-analyst, the-sop-keeper, the-ad-strategist, the-orchestrator. (atwood-dev excluded — phantom.) It was filed as an "awake-host mid-session wedge" (a possible new failure shape). It is not: it is the documented host clamshell-sleep / cron-batch-on-wake class.

Window in local time (PDT = UTC-7): 21:20Z-04:57Z = **14:20-21:57 PDT Thu**.

---

## Evidence (three independent instruments converge)

### 1. Power state — pmset -g log (authoritative), DISCONFIRMS "awake"
- **19 literal `Entering Sleep state` lines** in 11:00-21:57 PDT Thu (the exact span a peer read as "continuously awake, zero sleep/wake events").
- First is **14:05:59 PDT (21:05:59Z): `Entering Sleep state due to 'Clamshell Sleep'`** — lid closed, on battery, TCPKeepAlive=active. The rest are `Maintenance Sleep`, recurring through 21:57:09 PDT.
- **Zero user FullWake** in the span — every in-window wake is a DarkWake (low-power maintenance, 5-18 sec) or a notification-wake-back-to-sleep blip.
- Recovery: **13:32:53Z (06:32:53 PDT) `Wake from Deep Idle ... lid`** — a brief lid-open woke the host ~1 min before the 13:34Z fleet boot; then Clamshell Sleep again at 14:15Z; final sustained lid-open 16:03Z. The 16:03Z open is NOT the fleet-wake.

### 2. Abort signature — stdout (claude-dev slice)
- the-analyst stdout over the whole log: **0 "temporarily limiting requests", 0 "Rate limited", 0 "overloaded", 1 ENETUNREACH.**
- Zero rate-limit/overload wedge signatures. The lone ENETUNREACH = network-gone-at-sleep (symptom, not cause). Sessions died by **SUSPENSION**, not a 429 or network wedge.
- (Note: PTY `stdout.log` is a poor instrument for abort lines — it is a cursor-positioned TUI render; grep plain-text error strings, do not trust ANSI-stripped line counts.)

### 3. Delivery + lifecycle — the-analyst slice
- **cron-execution FIRE GAP** 21:37:57Z -> 22:41:50Z (the headline discriminator) maps exactly onto the 21:38:08Z 64-min Maintenance Sleep onset. Daemon fired zero crons = scheduler suspended = whole-host sleep.
- **crashes.log rollover 22:42:00Z carries `end_reason=OTHER`** — not the clean `prompt_input_exit` of the 09-17 idle rollovers = a SUSPENDED session rolled at the session cap, not an idle one.

---

## Keeper instrument facts (orch-banked)

1. **An EXTENDED DarkWake is PROCESSING-CAPABLE.** A completed turn / disk write minutes after lid-close does NOT prove an awake host. the-analyst's 21:20:25Z NOTE write (14 min after the 21:05:59Z clamshell onset) landed inside the DarkWake window **21:06:06Z-21:25:27Z**. So the suspend-vs-wedge discriminator must pair against `Entering-Sleep`/`DarkWake` granularity — NOT just Sleep/FullWake boundaries. This is the trap that made the write look like "awake host".
   - Death bracket maps to power exactly: (21:20:25Z write in a DarkWake, 21:37:57Z dead turn at the 21:38:08Z Maintenance Sleep onset].
2. **19 Entering-Sleep lines vs "zero events" on the SAME host/log = a reader-truncation artifact**, not a physical disagreement. Settle instrument conflicts on RAW lines + the literal command (report-your-instrument). ROOT VARIABLE (confirmed by the-sop-keeper, the peer who filed the "awake" read): a trailing **`tail -30`** on a `grep` of a growing log — the pattern was correct and DID include Clamshell/Maintenance Sleep; the `tail -30` kept only the last 30 of 108 matched lines (window started at 21:57 PDT), truncating all 19 earlier `Entering Sleep` events incl the 14:05:59 PDT Clamshell onset. Matched-but-truncated read as absent, absent read as awake. **The tail-N start-point also DRIFTS as the log grows** (first run showed 21:57 PDT, a re-run showed 00:59 PDT). This is the read-limit truncation tell applied to pmset. **For a completeness-critical sleep scan, never `tail`/`head` a pmset grep — scope to the exact window with NO line cap and count the full matched set (`wc -l`).**
3. **A single ENETUNREACH at suspend = symptom, not cause** — belongs in the abort-signature reference as a known sleep artifact, distinct from a rate-limit/overload wedge.

---

## Verdict + fix posture

- **CLASS: known host clamshell-sleep / cron-batch-on-wake suspend.** Not a novel awake-host wedge; not the 09-17 session-rollover-wedge new-shape.
- **FIX: none code-side.** It is a laptop clamshell-sleep on battery. Continuity across host-sleep is the documented 2026-09-12 operator tradeoff (AC power / `caffeinate`), an Adam call, already precedented. No daemon bug.
- Co-signed: claude-dev-agent (power + abort) + the-analyst (lifecycle + delivery, specimen #1). Verdict accepted by the-orchestrator.

## First-line triage runbook (next time an "awake-host flatline" is filed)

1. `cron-execution.log` for the window: **FIRE GAP -> suspend** (confirm with pmset, stop). **Continuous fires -> candidate wedge**, proceed to forensics.
2. `pmset -g log`, line-anchored to the window, grep `Entering Sleep state`: any Clamshell/Maintenance Sleep = host asleep. Watch that an EXTENDED DarkWake can still complete a turn.
3. stdout plain-text grep for `temporarily limiting requests` / `Rate limited` / `overloaded`: zero = not a 429 wedge; a lone ENETUNREACH = sleep symptom.
