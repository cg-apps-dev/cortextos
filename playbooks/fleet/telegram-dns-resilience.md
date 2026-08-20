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

**EXERCISED-LIVE (heavily) since the 08-05 bounce — updated 2026-08-13:** in-process `TelegramAPI` users inside the daemon. These paths loaded the resilient-lookup `dist` at the 08-05 bounce and have since been exercised **heavily** — far past the earlier "wired, not yet exercised" status this section carried:
- primary/activity `TelegramPoller` `getUpdates`
- fast-checker typing/callback actions (`sendChatAction`, `answerCallbackQuery`, `editMessageText`)
- CodexAppServerPTY typing indicators (`setTelegramHandle`)
- agent-manager crash/recovered/halted `sendMessage` notifications
- any in-daemon `ALLOWED_USER` / watchdog Telegram sends

**Status by resolution path (claude-dev, owner, 2026-08-13) — DO NOT read "exercised-live" as "all safe"; the two paths behaved very differently:**
- **ASYNC path — EXERCISED-LIVE and SAFE.** The resilient lookup's async resolution path has fired heavily in the daemon: the **~1.3M caught `[telegram-poller] Poll error` logs ARE the resilient lookup engaging** on real DNS/network events, surfacing the error as a catchable socket error → `req.on('error', reject)` (`telegram/api.ts`) → the poller's `try/catch` → logged + retried. This is the "exercised-live" upgrade the earlier status waited on — it arrived, and on the async path the fix works as designed. (The earlier 08-05 note held off on this because the one `Could not resolve hostname` line seen then was a false match — an orchestrator-relayed message about security's own backup retry, not this daemon's path; the async engagement is now unambiguous from the poll-error volume.)
- **CACHE-HIT path — EXERCISED-LIVE *and* a FLEET-CRASH HAZARD.** The cache-hit branch invoked the `dns.lookup`-style callback **synchronously**, so `net`'s `internalConnect` ran inside the lookup's synchronous stack before the socket `error` handler was attached — a synchronous connect error (ENETUNREACH on a transient network blip) escaped to `process` `uncaughtException` and **exited the whole daemon, crashing every hosted agent together.** This is the **confirmed root cause of the 2026-08-08 and 2026-08-12 fleet crashes** (crash stack: `net internalConnect ← emitLookup ← resilient-lookup.ts` cache-hit cb; the "config-reload restarts" logged those days were PM2 recovering from these crashes). On this path the "resilience" mechanism was itself the crash cause.
- **Fix status — RESOLVED; the self-cure fired 2026-08-20.** `b663ad5a` (on `main`) defers both cache-hit cb calls via `process.nextTick`, so the connect error surfaces as a catchable socket error instead of a fatal `uncaughtException` (matching the always-safe async path). The crash recurred **four times** — 08-08 / 08-12 / 08-14 / 08-20, `resilient-lookup.ts:158` cache-hit cb each time; the accelerating rate **and** cost (the crash-burn was eating the me-com usage-cap headroom) killed the earlier "rare exposure (2 / ~2 months), PM2 recovers clean" deferral. claude-dev swapped the staged fixed `dist` live on 08-14 (`nextTick=1` on disk, `.bak` kept), but the running daemon stayed on its OLD in-memory build until a respawn. **That respawn came on 2026-08-20 and self-cured exactly as designed:** the 4th crash (`2026-08-20T11:05:35Z`) killed the old daemon, and PM2 respawned it **onto the fixed `dist`** (new daemon `pid 10933`; `process.nextTick` present in the bundled `dist/daemon.js`, verified `nextTick=1`) — so the cache-hit path is no longer fatal, **the crash-loop is broken, and the vuln is resolved in-process — no manual bounce was needed.** *(Instrument note, worth keeping: the crash was confirmed at every step by the crash-history **stack trace** — `resilient-lookup.ts:158` — which is the authoritative crash observable. That is NOT pm2 `unstable_restarts`, a rapid-cycle **rate** counter that read 0 and briefly softened the read toward "clean restart" — the wrong instrument for crash-detection. Verify a crash by its stack trace, not a restart-rate counter; the watchdog + crash-history were right.)* Owner: claude-dev; tracked under `task_1786534248882`.

**MIXED / NOT COVERED — the daemon crash-loop alert** (`src/daemon/index.ts`):
- its ops-first path shells out to a fresh `node dist/cli.js bus notify-agent …`, so that part gets the rebuilt CLI behavior *if the CLI/bus route is alive*;
- its last-resort operator-direct fallback is a **raw `curl https://api.telegram.org/.../sendMessage`** — a separate path this DNS fix does not touch at all. A raw-curl send has neither the c-ares chain nor the fallback; it is exactly the last-ditch alert most likely to fire during infrastructure trouble, and it is the one path still on OS resolution.

## The one-line summary (owner's words)

CLI text and rebuilt-hook JSON sends are live now; in-process daemon JSON sends are EXERCISED-LIVE (async path heavily + safe) — but the cache-hit path was the confirmed root cause of four fleet crashes (08-08, 08-12, 08-14, 08-20) — now RESOLVED: `b663ad5a`'s fixed `dist` was swapped live 08-14, and the 4th crash (08-20 11:05:35Z) self-cured by respawning the daemon onto that fixed `dist` (nextTick=1 verified), breaking the crash-loop; media/multipart and the raw-curl crash-alert fallback are not covered.

**Enforcement labels** (the-sop-keeper, 2026-08-03): the resilient lookup itself is **MECHANISED** (it exists, 18 tests pass). Knowing whether a *given* Telegram send is protected is **JUDGMENT-LEVEL** until the bounce collapses the live-status axis — it requires knowing both which call type it is (covered vs media/curl) and which process issues it (CLI/hook vs in-daemon). This runbook self-updates its live-status axis when claude-dev/codex-dev confirm the daemon bounce landed and the in-process paths are running the fix; the coverage axis updates when the media/multipart fast-follow ships.
