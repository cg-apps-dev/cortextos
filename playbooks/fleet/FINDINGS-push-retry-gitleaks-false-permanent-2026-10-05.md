# FINDINGS: push-retry-lib bare `gitleaks` token false-classifies a transient broken-pipe as PERMANENT (no retry)

Task: task_1791217642750 (G3 TRANSIENT_RE widening) | Author: security-agent | 2026-10-05 | Status: ROOT-CAUSE CONFIRMED (empirical), fix pending build+test+two-touch+gated-deploy

## Summary
The daily-backup wake-gate work (G3) asked: "verify the 10-03 broken-pipe signature before adding it to PUSH_RETRY_TRANSIENT_RE." Verifying the specimens revealed the broken-pipe non-retry has TWO causes, and the PRIMARY one is not a missing transient pattern - it is a FALSE-POSITIVE in PUSH_RETRY_PERMANENT_RE. Shared lib `tools/push-retry-lib.sh` is consumed by BOTH daily-backup.sh (step-1 code push) and backup-agent-state.sh (step-2), so this affects both backup legs.

## The 4 broken-pipe specimens (daily-backup-launchd.log, byte-exact)
- 2026-08-31 L5766-5775 (rc=128), real-refs push: `Read from remote host github.com: Operation timed out` / `client_loop: send disconnect: Broken pipe` / `send-pack: unexpected disconnect while reading sideband packet` / `fatal: the remote end hung up unexpectedly`. -> DID retry (log: "TRANSIENT DNS/network failure - retrying").
- 2026-10-03 L11205, L11257, L11270 (rc=1), nothing-to-push path: `Connection to github.com closed by remote host.` / `client_loop: send disconnect: Broken pipe` / `error: failed to push some refs`. -> did NOT retry (step 1 exit=1 immediately).

## Root cause (empirically confirmed 2026-10-05, classifier run against the exact specimen text)
The classifier checks PERMANENT first (push-retry-lib.sh L69), then TRANSIENT (L74).

1. PRIMARY - PERMANENT false-match on bare `gitleaks`: the nothing-to-push path emits the BENIGN informational line `pre-push: no refs on stdin (...); skipping shape scan, gitleaks tree scan still runs.` PUSH_RETRY_PERMANENT_RE contains the bare token `gitleaks`, which matches that line -> classified PERMANENT -> NO RETRY. Confirmed: `grep -oiE "$PERMANENT_RE"` on the 10-03 block returns `gitleaks`.
   - The bare token is REDUNDANT for the real-block case: a genuine gitleaks secret-block emits `pre-push: BLOCKED - gitleaks found a potential secret`, which PERMANENT_RE ALREADY matches via its `pre-push: BLOCKED` alternative. So the bare `gitleaks` token adds no real-block coverage and only introduces this FP.
2. SECONDARY - TRANSIENT_RE gap: even with #1 fixed, the 10-03 text has no transient match (`connection timed out|connection refused|failed to connect|...|operation timed out` do not cover `Connection to ... closed by remote host` / `Broken pipe` / `remote end hung up`).

WHY 08-31 retried but 10-03 did not: 08-31 was a REAL-refs push (no "nothing to push" line) so its output never contained "gitleaks", AND it carried `Operation timed out` which IS in TRANSIENT_RE. 10-03 was nothing-to-push (emits the "gitleaks tree scan still runs" line) AND carried only broken-pipe shapes. The differentiator is the nothing-to-push informational line, not the network error itself.

## Fix plan (both changes to tools/push-retry-lib.sh; build on scratchpad, NEVER-PROBE-LIVE)
A. Narrow the PERMANENT `gitleaks` token to an actual block/scanner-failure signature, e.g. `gitleaks found|gitleaks not found.*refus` (drop the bare word). Verify a REAL gitleaks block (`pre-push: BLOCKED - gitleaks found a potential secret`) STILL classifies PERMANENT (it does, via both the narrowed token AND the existing `pre-push: BLOCKED`), and the benign "gitleaks tree scan still runs" line does NOT.
B. Add the transient disconnect class to PUSH_RETRY_TRANSIENT_RE: `broken pipe|closed by remote host|the remote end hung up|unexpected disconnect|connection reset by peer`. These are genuine mid-transfer network drops (self-heal like the DNS class).

## Test requirements (before deploy)
- Parity harness: classify ALL 4 specimens -> all 4 must now classify TRANSIENT (retry).
- NEGATIVE control (critical, security): a real gitleaks secret-block MUST still classify PERMANENT (not retried); a non-fast-forward/auth failure MUST still classify PERMANENT. A genuine persistent network outage still exhausts + alerts.
- BOTH-consumer: run the parity harness for daily-backup.sh step-1 AND backup-agent-state.sh step-2 (shared lib; they must not diverge).
- Consider a dedup/suppress window for repeating identical failure pages (the 10-03 run logged the same broken-pipe page 3x across hours).

## Class: proxy-not-detector (propagate the pattern)
This is a textbook instance of the fleet rule "a trigger that also describes the HEALTHY case is a proxy, not a detector" (org knowledge, 2026-07-28). The bare `gitleaks` token was meant to detect a gitleaks BLOCK, but it matches `gitleaks tree scan still runs` - a line the HEALTHY (nothing-to-push success) path emits every run. A classifier token must match the FAILURE signature, never a word that also appears on the healthy path. The fix (narrow to `gitleaks found|gitleaks not found.*refus`) restores it to a detector. When auditing any classifier RE, test each token against the HEALTHY-path output too, not only the failure output - a token that fires on both is a proxy. Same family as the wake-gate's own "a trigger that also describes the healthy case is a proxy" check.

## Negative control is the half that prevents trading false-permanent for fail-open
Narrowing the PERMANENT classifier must NOT let a real secret-block slip to the transient/retry path. The mandatory negative control (a real `pre-push: BLOCKED - gitleaks found a potential secret` STILL classifies PERMANENT, via both the narrowed token and the existing `pre-push: BLOCKED` alternative) is what keeps this a false-permanent fix and not a new fail-open. Verify it explicitly before deploy.

## Deploy note (for the approval text when staged)
Present to Adam as ONE backup-reliability arc with the wake-gate: the wake-gate reachability pre-gate DEFERS the run on a pre-push no-network condition (the common DarkWake case); THIS push-retry fix RETRIES a mid-push network drop (broken pipe during transfer, after a successful pre-gate probe). Complementary, neither subsumes the other - so Adam can weigh them together.

## Severity / risk
RELIABILITY defect (false-alarm + lost backup increment until manual re-fire), not a leak. The fix is security-SENSITIVE because it touches the PERMANENT classifier that (correctly) refuses to retry a secret-block - the negative control is mandatory. LOW deploy risk once tested (Backblaze DR continuous; retrying a mis-classified permanent only costs ~16min before it alerts anyway).

## Relation to the wake-gate
Complementary: the wake-gate reachability PRE-GATE (approval_1791138743_m5dwk, pending Adam) DEFERS the whole run when the network is down BEFORE the push, so it already prevents the connect-fail class from false-alerting. This push-retry fix handles the case where the network drops MID-PUSH (broken pipe during transfer, after a successful pre-gate probe) - the retry outlasts the blip. Both are needed; neither subsumes the other.

---

## BUILD + VERIFICATION (2026-10-05, scratchpad, NEVER-PROBE-LIVE)
Built on scratchpad `g3-push-retry/` (NOT the live lib): `push-retry-lib.sh` (fix) + `test-push-retry-lib.sh` (harness) + `push-retry-lib.BUGREPRO.sh` (original REs + hook, for reproduce-then-confirm).

**Fix diff (two RE lines + one test-only hook):**
- TRANSIENT_RE += `broken pipe|closed by remote host|the remote end hung up|unexpected disconnect|connection reset by peer`
- PERMANENT_RE: bare `gitleaks` -> `gitleaks found|gitleaks not found.*refus`
- added generic `PUSH_RETRY_FORCE_OUT`/`_RC` injection hook so the harness drives the REAL push_retry_run classify+retry path (not a re-implementation = avoids the mirror-fixture trap). Test-only; no live behavior change.

**Harness discriminator:** inject a static output, set MAX=3/BACKOFF=0/LOGFILE, count `push-retry attempt` lines -> 1 = NOT retried (permanent/fall-through), 3 = retried (transient exhausted). Behavioral, through the real code path.

**Results:**
- FIXED lib: 15/15 PASS under BOTH `bash` AND `sh` (the backup-agent-state.sh POSIX runtime). No divergence.
- REPRODUCE-THEN-CONFIRM: same harness vs the UNFIXED classifier (BUGREPRO) FAILS exactly at the crux - 10-03 nothing-to-push -> att=1 (the bug), `connection reset`/`unexpected disconnect` not matched, benign line matches bare `gitleaks` in PERMANENT_RE. 08-31 still PASSES on unfixed (it carries `Operation timed out`, already in TRANSIENT_RE) - matches the findings' why-08-31-retried-but-10-03-didn't exactly. So the test genuinely discriminates (not passing for the wrong reason).
- NEGATIVE CONTROLS all green: real secret-block, scanner-missing, non-FF, auth-fail, 403, permission-denied all stay PERMANENT (att=1); secret-block + broken-pipe co-occurring stays PERMANENT (permanent-precedence holds through the real path).

**FAIL-OPEN question A, empirically closed against the REAL artifact (not assumed):** read `.git/hooks/pre-push` + `scripts/hooks/pre-push` (byte-identical). EVERY block path (`exit 1`) emits either `pre-push: BLOCKED` (L82/99/101/116/144/169/175) or `pre-push: gitleaks not found - refusing` (L76) - BOTH covered by the narrowed PERMANENT_RE. The ONLY bare-`gitleaks` line is L72 `...gitleaks tree scan still runs.` which is the HEALTHY nothing-to-push info line, not a block. => narrowed PERMANENT_RE misses NO real block; the bare token was purely redundant+harmful. Fail-open risk = nil.

**Considered residual (C, documented not blocking):** `the remote end hung up` is a legitimate transient in our real data (the 08-31 specimen) but could in principle co-occur with a server-side rejection that lacks a PERMANENT token. This is NOT a security fail-open: secret-blocks are LOCAL pre-push outputs that always carry `pre-push: BLOCKED` (proven above), and our backup repo has no server-side rejection rules beyond non-FF (already in PERMANENT_RE). Worst case = a wasted ~16min retry then alert on an exotic server rejection. Accepted.

**Two-touch:** codex peer-review attempted but codex daemon stalled/timed out repeatedly today (degraded `codex doctor`, auth OK) - routed the independent two-touch to claude-dev-agent instead (author != reviewer). 

**STATUS: BUILT + SELF-PROVEN. Pending: independent two-touch (claude-dev), then gated deploy. NOT deployed live.

**APPROVAL SCOPE-HYGIENE (orch ruling 2026-10-05):** the wake-gate "arc" is a FRAMING, NOT a scope-merge into the already-pending approval_1791138743_m5dwk. A pending approval's scope must NOT grow after creation (an approval that changes meaning post-ping = mislabeled consent). So: (a) if Adam approves wake-gate BEFORE this retry fix is blessed -> the retry fix gets its OWN approval that references the arc; (b) if BOTH are ready and wake-gate is still undecided -> create ONE new combined arc approval and close m5dwk with a superseded-by pointer. Never silently widen the live one. Backblaze DR continuous = no data-risk while gated.
