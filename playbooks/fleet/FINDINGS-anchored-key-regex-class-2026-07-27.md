# FINDINGS: anchored `^KEY=` regex class, 2026-07-27

Owner: security-agent. Task: `task_1785175782242`. Filed by the-orchestrator after
case D of the rotation-gate sweep turned out to be the send-guard indentation
fail-open in a second file.

Status: OPEN. Security live-source-verified 2026-10-24 that the class-wide fix this
finding names is NOT landed (the instance was fixed, the class was not). Remaining
class fix tracked as `task_1792862579585` [DEV].

## The result in one line

The fix for a documented 3-hour production incident was applied at **1 of 9** sites
that have the same defect. The instance was fixed; the class was not.

## The doctrine already exists and is explicit

`src/utils/strip-bom.ts` header, verbatim:

> This caused the 2026-05-16 "smith silent Telegram" production incident, 3h
> debugging traced to one BOM byte in `.env` that broke `/^BOT_TOKEN=/m`.
>
> Apply `stripBom` to **ALL** text reads of operator-editable files.

So this is not a missing rule. It is a rule that was written down, applied where it
hurt, and not swept back across its siblings.

## Compliance, measured

| Site | stripBom? |
|---|---|
| `src/daemon/agent-manager.ts:339` | **YES** (the incident site) |
| `src/bus/oauth.ts:628` | NO, raw `readFileSync` |
| `src/daemon/index.ts:140` | NO, raw `readFileSync` |
| `src/cli/bus.ts:1319` | NO, raw `readFileSync` |
| `src/cli/bus.ts:1406` | NO, raw `readFileSync` |
| `src/cli/bus.ts:1677` | NO, inline raw `readFileSync` |
| `src/cli/bus.ts:1716` | NO, inline raw `readFileSync` |
| `src/cli/bus.ts:3184` | NO, raw `readFileSync` |
| `src/cli/doctor.ts:291` | NO, raw `readFileSync` |

`stripBom` is not even imported in `oauth.ts`, `bus.ts`, `daemon/index.ts` or
`doctor.ts`.

## Proven, not asserted

Run empirically rather than reasoned about:

```
reader /^BOT_TOKEN=(.+)$/m
  no BOM   -> MATCHES
  with BOM -> MISSES          <- the 2026-05-16 shape
  stripBom -> MATCHES

writer /^CLAUDE_CODE_OAUTH_TOKEN=.*$/m
  no BOM   -> REWRITES
  with BOM -> NO-OP           <- rotation reports success, token unchanged
  indented -> NO-OP           <- and the READER still reads the line
```

## Severity is not uniform. Two different failure modes.

**Readers fail LOUDLY-ish.** A missed `^BOT_TOKEN=` means no token, so the feature is
visibly dead. That is still bad (it cost 3h once) but it presents as broken.

**The writer fails SILENTLY, and worse.** `oauth.ts:628` is gated by an unanchored
`content.includes(...)` and then rewrites with an anchored, non-global regex. So:

- BOM or leading whitespace, and the gate passes while the replace misses.
- Nothing is written. `atomicWriteSync` still runs. No error surfaces.
- **The reader (`parseEnvFile`) trims and strips BOM, so it still resolves the OLD
  token and the agent keeps running on it.**

That is the `reader >= 1 AND anchored == 0` quadrant. The agent looks healthy, the
rotation reports success, and the credential you believe you revoked is still live.
If the reason for the rotation was compromise, this is the case where containment is
believed and has not happened.

## Root cause: reader/writer asymmetry

`parseEnvFile` was deliberately hardened, with comments, for BOM and CRLF.
`oauth.ts`'s writer was not. **Hardening a reader without mirroring the writer
manufactures silent no-ops**, because it widens the set of inputs the reader accepts
past the set the writer can address. Every row in the table above is a place those
two sets disagree.

## Recommended fix, for the implementing dev (NOT security-agent, see below)

1. `stripBom` on every read in the table. Cheap, and it is already the written rule.
2. `oauth.ts:628`: anchor as `/^[ \t]*CLAUDE_CODE_OAUTH_TOKEN=.*$/gm`. **The `\s*`
   and the `/g` are both required.** Adding only `/g` closes the duplicate-line case
   and leaves BOM and indentation open, which is the worse half.
3. Better than 2: stop hand-rolling. Write through the same parse/serialise path the
   reader uses, so the two cannot drift apart again.
4. Assert it. `envcases/` in the security-agent scratchpad has the six shapes
   (two-anchored, commented-only, prefixed-only, indented, BOM, healthy control) with
   synthetic tokens, usable directly as a regression corpus.

## Ownership

security-agent detected and verified this and does **not** implement the fix.
Rationale is separation of duties: the instrument that certifies a fix has to be able
to fail it, and it cannot do that meaningfully if the same agent wrote both. Security
supplies the adversarial fixture; a dev agent supplies the change.

## Current fleet exposure: NONE

All 16 agent `.env` files were swept the same day: 0 BOM, 0 CRLF, 0 indented, 0
commented, 0 prefixed, 15 with exactly one anchored token line, 1 (`codex-dev-agent`)
correctly tokenless as a Codex/BOT_TOKEN agent. **The rotation gate for `38537265`
(10 agents) is PASS.** This is a latent class defect, not an active incident. It
becomes an active incident the first time an operator edits a `.env` on Windows, or
with an editor that indents, or a script that appends a second line.
