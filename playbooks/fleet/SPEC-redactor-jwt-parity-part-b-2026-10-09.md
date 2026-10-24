# SPEC — openai-3-gap Part B: JWT cross-redactor parity

- **Task:** task_1790786913875_99014697 `[DEV]` (openai-3-gap + JWT-parity-test)
- **Author:** claude-dev-agent (plan) — 2026-10-09
- **Chain:** claude-dev specs → codex impl (branch-only) → claude-dev raw review → security-agent cert (positive-control against the tracked sha-pinned corpus)
- **Class:** security redactor coverage. Under-redaction is the only dangerous failure; over-redaction is safe.

## Problem (verified at the artifact)

The fleet has two in-flight redactors with divergent coverage:
- `src/pty/redact.ts` `redactSecrets`: redacts JWT (`[REDACTED_JWT]`), sk-ant (`[REDACTED_SK_ANT]`), openai svcacct/proj/admin (`[REDACTED_OPENAI]`).
- `src/daemon/fast-checker.ts` `redactSecrets` (L95-99): redacts sk-ant, openai svcacct/proj/admin, and `CLAUDE_CODE_OAUTH_TOKEN=` — but has **NO JWT pattern**.

Part A (merged to main) closed the openai 3-gap on all four surfaces (both gitleaks configs at-rest, both redactors in-flight). The **only remaining gap is JWT in fast-checker**: a JWT that `redact.ts` scrubs in the PTY path passes the fast-checker path uncaught. This is the original-finding family (16 real `authjs.session-token=eyJ...` JWTs leaked to stdout). Security-verified 2026-10-09.

**Why JWT specifically matters (security-confirmed, add to test notes): JWT is redactor-ONLY.** The gitleaks configs have NO JWT/`eyJ` detection rule at all — gitleaks is blind to JWTs by design. So a JWT has no at-rest scanner backstop; the in-flight redactor is its **sole** defense. A JWT reaching a fast-checker-path sink (with no JWT redaction) therefore had zero coverage. This is exactly why closing the fast-checker JWT gap is load-bearing, not cosmetic — unlike sk-ant/openai, there is no second layer to catch a JWT.

## Invariant — REDACTION parity, not DETECTION parity

**fast-checker must catch ≥ what redact.ts catches; the two need NOT be byte-identical.** For a redactor, over-match never leaks and is safe; under-match is the only risk. Therefore:
- **DO** add JWT coverage to fast-checker (the real under-match gap).
- **DO NOT** tighten fast-checker's intentionally-loose sk-ant/openai forms (`sk-ant-[word]+`, `sk-(svcacct|proj|admin)-[word]+`) to redact.ts's strict 40+-anchored forms. The loose forms over-redact short/bodyless prose, which is correct-and-safer for a redactor. (redact.ts's strict form is intentionally gitleaks-matching for the detect↔redact reasoning; that is a separate concern.)

## Fix (one line)

Adopt redact.ts's JWT pattern **verbatim** into `fast-checker.ts` `redactSecrets`, using fast-checker's existing placeholder convention:

```
.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_TOKEN]')
```

eyJ-anchored, 3 base64url segments, linear (no catastrophic backtrack). Security-verified it coexists with sk-ant/openai with no cross-corruption (those suffixes contain no dots, so JWT_PATTERN cannot match inside them) and is order-independent for these families. Place it alongside the existing `.replace` chain.

## Fixture (single source of truth, sha-pinned)

- Security authored + self-verified the 5-family corpus. Authoring copy (provenance-only, gitignored agent dir): `orgs/clean-green-marketing/agents/security-agent/tools/redactor-parity-corpus.json`, **sha256 `7b83329d95a375de202f56c6c1d11116dd4b4024443606d142ecc13cccda2af9`** (claude-dev independently verified).
- codex **copies it byte-identical** to the tracked path **`tests/unit/redactor-parity-corpus.json`** and asserts `sha256 == 7b83329d…` in the test setup (fail the test if it drifts). The tracked copy is the authority; CI/fresh-clone needs it (the agent-dir copy is gitignored).
- Structure: `positives[7]` (jwt, sk-ant oat01/ort01/admin01, openai svcacct/proj/admin), `negatives_shared[3]`, `negatives_symmetric_prose[2]`, `negatives_asymmetric[3]`, plus an `_assertion_model` block documenting the rules inline.

## Parity test — `tests/unit/redactor-parity.test.ts`

Imports BOTH `redactSecrets` (from `src/pty/redact.ts` and `src/daemon/fast-checker.ts`), loads the tracked fixture, asserts its sha, then per bucket:

1. **positives (7) — SYMMETRIC coverage floor:** for each, BOTH redactors' output must NOT contain the secret body (assert the distinctive body substring is absent — JWT sig segment / the 40+ char body). This is the safety floor.
2. **negatives_shared (3) — JWT non-matches** (`a.b.c`, `v1.2.3`, truncated `eyJ` alone): BOTH `output === input`.
3. **negatives_symmetric_prose (2)** (bare `sk-ant`, `the sk-ant token`): BOTH `output === input`.
4. **negatives_asymmetric (3)** (`sk-ant-oat01` suffixless, `sk-proj-abc`, etc.): `redact.ts` → `output === input` (strict form, no 40+ body); `fast-checker` → **NO-LEAK only** (assert no `[A-Za-z0-9_-]{40,}` secret body survives — do NOT assert output changed; the loose form may over-redact the bodyless prefix and that is accepted-expected).

**The test MUST bite:** confirm it FAILS on current fast-checker (positive JWT case under the fast-checker redactor) and PASSES after the one-line fix. Include that as the proof-of-fire note.

## Security allowlist dependency (ATOMIC with the fixture — security's lane)

The fixture holds shape-valid synthetic secrets, so it WILL trip gitleaks (fleet + backup pre-push gate), injection-scan, and transcript-sink. Security lands **path-scoped** allowlist entries for exactly `tests/unit/redactor-parity-corpus.json` (gitleaks fleet + backup toml, injection-scan, transcript-sink baseline) + a positive-control that a real secret OUTSIDE the fixture still fires. **These MUST be in the same merge as the fixture** or the first daily-backup after merge trips the pre-push secret gate. Landing mechanism (fold diffs into the branch vs security commits onto the branch) is being coordinated; the branch must not merge without them.

## Gates & ship flow

branch (new, e.g. `feat/redactor-jwt-parity`) → `npx tsc --noEmit` + vitest (new parity test + the two existing redact tests `tests/unit/pty/redact.test.ts`, `tests/unit/daemon/fast-checker-redact.test.ts`) all green → claude-dev raw review (sha-verify landed fixture == authored) → security cert against the tracked sha-pinned path → PR via the-orchestrator → Adam. No push/PR without Adam. Branch-only; no stage/commit of unrelated paths.

## Open questions for codex

1. Placeholder: fast-checker uses `[REDACTED_TOKEN]` for all its families; keep JWT → `[REDACTED_TOKEN]` (consistent) rather than redact.ts's `[REDACTED_JWT]`. Confirm no downstream consumer keys on the specific placeholder text.
2. Fixture sha assertion in-test: read the tracked JSON, hash it, assert == the pinned sha, so a drifted/edited fixture fails loudly rather than silently weakening the corpus.
