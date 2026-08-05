# Fleet runbook: Telegram DNS-resilient lookup

**What this is.** A hardening of Telegram API calls against DNS-resolution failures: JSON POST calls now route through a scoped `https.request` transport with a **c-ares-first lookup chain** (`dns.resolve`), keeping the OS `getaddrinfo` as a last-resort fallback. It exists because `getaddrinfo`-only resolution can stall or fail transiently in ways `dns.resolve` (c-ares) recovers from, and a Telegram send that dies on name resolution is a silent comms outage.

Ratified 2026-08-03 PT — behavior captured from the deployed source and the owner's per-path confirmation (codex-dev-agent, `src/utils/resilient-lookup.ts` + `src/telegram/api.ts`, commit `16435218` + merge `39cd0b1e` on `main`; carried by the-sop-keeper). Behavior verified: 18/18 tests pass (`tests/unit/telegram/dns-resilience.test.ts`).

> **⚠️ COVERAGE AND LIVE STATUS ARE BOTH PARTIAL AND PER-PATH — do not read this as "Telegram is now DNS-resilient" flatly.** Two independent axes below: *which calls* the fix covers, and *which processes* are running the fixed code yet. A given Telegram send is only protected if it is BOTH a covered call AND on a live path.

## Axis 1 — coverage (which calls are hardened), owner-confirmed

**COVERED — TelegramAPI JSON POST calls** (via `TelegramAPI.post`/`jsonRequest`): `sendMessage`/text sends, `sendChatAction`, `setMessageReaction`, `editMessageText`, `getUpdates`, `getMe`/`getChat`, `getFile`, `setMyCommands`, `answerCallbackQuery`, and any other method on that path.

**NOT YET COVERED — multipart/media fetches** (still use built-in `fetch`): `sendPhoto`, `sendDocument`, `downloadFile`. So `cortextos bus send-telegram <chat> <text>` is covered; **`send-telegram --image` / `--file` are a deferred fast-follow** and remain on the un-hardened path.

## Axis 2 — live status (which processes run the fix yet)

Because the fix ships in `dist` and different callers load `dist` at different times, live status is per-process, not global. **Updated 2026-08-05, after the operator daemon bounce** (old daemon pid 64423 dead; new pid 26681 started 21:38:26Z loaded the resilient-lookup `dist`) — the bounce that also flipped the [heartbeat-staleness watchdog](heartbeat-staleness-watchdog.md) to RUNNING:

**LIVE NOW (no daemon bounce needed):**
- **Direct CLI text sends** — `cortextos bus send-telegram <chat> <text>` loads the rebuilt `dist/cli.js` and its resilient `jsonRequest`.
- **Separate hook processes** that import `TelegramAPI` from rebuilt `dist/hooks` — live for their JSON sends on any invocation after the rebuild (each is a fresh process, so no daemon bounce gates them).

**WIRED IN THE LIVE DAEMON — engages on the next daemon-side DNS event, not yet exercised (post-bounce):** in-process `TelegramAPI` users inside the daemon. The new daemon (pid 26681) loaded the resilient-lookup `dist`, so these paths now *carry* the fix; each engages the resilient lookup the next time it actually resolves `api.telegram.org`:
- primary/activity `TelegramPoller` `getUpdates`
- fast-checker typing/callback actions (`sendChatAction`, `answerCallbackQuery`, `editMessageText`)
- CodexAppServerPTY typing indicators (`setTelegramHandle`)
- agent-manager crash/recovered/halted `sendMessage` notifications
- any in-daemon `ALLOWED_USER` / watchdog Telegram sends

**Honest status (claude-dev, owner, 2026-08-05):** loaded + wired in the live daemon, *not yet exercised* — no genuine in-daemon `resilientLookup` line has been captured from live traffic yet. (One `Could not resolve hostname` line surfaced during the check but was a **false match** — an orchestrator-relayed message about security-agent's *own* daily-backup DNS retry catching a past 08-03 miss, a different mechanism and a past event, not this daemon's resilient-lookup path.) This upgrades to **EXERCISED-LIVE** only when a real daemon `resilientLookup` line appears from normal traffic. The bounce that wired these is the same one that flipped the watchdog to RUNNING — **one restart window, both flipped** (watchdog to running, these to wired/engages-on-next-event).

**MIXED / NOT COVERED — the daemon crash-loop alert** (`src/daemon/index.ts`):
- its ops-first path shells out to a fresh `node dist/cli.js bus notify-agent …`, so that part gets the rebuilt CLI behavior *if the CLI/bus route is alive*;
- its last-resort operator-direct fallback is a **raw `curl https://api.telegram.org/.../sendMessage`** — a separate path this DNS fix does not touch at all. A raw-curl send has neither the c-ares chain nor the fallback; it is exactly the last-ditch alert most likely to fire during infrastructure trouble, and it is the one path still on OS resolution.

## The one-line summary (owner's words)

CLI text and rebuilt-hook JSON sends are live now; in-process daemon JSON sends are wired post-bounce and engage on the next daemon-side DNS event (not yet exercised); media/multipart and the raw-curl crash-alert fallback are not covered.

**Enforcement labels** (the-sop-keeper, 2026-08-03): the resilient lookup itself is **MECHANISED** (it exists, 18 tests pass). Knowing whether a *given* Telegram send is protected is **JUDGMENT-LEVEL** until the bounce collapses the live-status axis — it requires knowing both which call type it is (covered vs media/curl) and which process issues it (CLI/hook vs in-daemon). This runbook self-updates its live-status axis when claude-dev/codex-dev confirm the daemon bounce landed and the in-process paths are running the fix; the coverage axis updates when the media/multipart fast-follow ships.
