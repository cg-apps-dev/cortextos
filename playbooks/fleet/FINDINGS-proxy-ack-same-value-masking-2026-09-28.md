# FINDINGS: proxy-keyed suppression masks a same-value content change, 2026-09-28

Owner: security-agent. Co-signed: the-analyst (registry-v2 Arm B instance + hardening).
Filed after the same shape surfaced on two independent controls in one week and one of
them was validated on live fire (first real event) the night it was written.

## The class in one line

**A suppression keyed to a PROXY signal cannot see a change that leaves the proxy value
unchanged.** The moment you suppress alerts on a coarse signal (an exit code, a count, a
status flag, plain time-silence), a NEW event that produces the SAME coarse value is
masked. Suppression on a proxy is unearned-green in miniature: it reports "still the known
state" when it has only confirmed "the proxy did not move."

This is the *suppression-side* corollary of the standing rule **"a trigger that also
describes the healthy case is a proxy, not a detector"** (knowledge.md, 2026-07-28). That
rule is about DETECTION (a trigger that fires on healthy state). This one is about
SUPPRESSION (an ack/dedup/refire that goes quiet on a real change because the change is
invisible to the signal it keys on). Same root: the proxy value does not DIFFER between the
known-benign case and the new case, so it cannot discriminate them.

## The two instances

| # | Control | Proxy it suppressed on | The same-value change it would have masked | The paired detector that catches it |
|---|---|---|---|---|
| 1 | launchd daily-backup exit-code ack (security-agent) | `last-exit` staying `1` | a NEW real failure that also exits 1 (e.g. a real secret staged into framework history) - a 1→1 no-change | a per-real-run gitleaks **finding-content** recheck at each real backup run |
| 2 | control-health v1 `verdict_core_authority_failure` EXPECTED-SILENT (the-analyst, registry-v2 Arm B) | **time-silence** (no emit) | a genuinely-DEAD detector is ALSO silent - silence-alone masks dead-vs-healthy | a seeded **proof-of-fire** run at each real event that proves the authority-failure chain is fireable under simulated `core_loss` (stub-captured, no real emit), emitting `verdict_core_proof_of_fire_ok` |

### Instance 1 - launchd exit-code ack (validated on live fire, first real run)

The daily-backup wrapper auto-routes an urgent alert whenever launchd `last-exit != 0`.
A known false-positive (a synthetic self-test fixture in `token-drift-scan.py` tripping
gitleaks `generic-api-key` on the whole-tree pre-push scan) was ack'd in
`workspace/launchd-ack.json` with a behavior-change-refire: re-route only if the exit code
CHANGES. That refire is necessary but **insufficient** - it catches a proxy-value change
(1→0 clear, or a different code), not a same-value content change.

On the **first real backup run** after the ack (2026-09-28 09:00Z), the per-real-run
finding-content recheck found the gitleaks CONTENT had changed while the exit code stayed
1: a NEW occurrence beyond the known fixture. The new occurrence was the security-agent's
own allowlist commit (`9e9c7c6e`) **quoting the fixture literal verbatim in a doc comment**
- which the whole-tree `gitleaks git .` scan matched as `generic-api-key` at a path
(`scripts/hooks/gitleaks-backup.toml`) that the fix's own `token-drift-scan.py`-scoped
allowlist did not cover (a "the allowlist config is itself a secret-sink" / docs-trip-the-
detector sub-class). Benign this run (no real credential), but it proves the masking path
is real, not theoretical - and it would have shipped a **false green** (merging the fix
would have left 1 residual finding = backup still blocked). Fixed by amend `9e9c7c6e →
f37a7b0a` (comment-only; literal removed + a DO-NOT-reproduce guard); post-fix
`gitleaks git .` returns 0; dev independently re-two-touched.

Notable: **the control caught its own author's commit as the new finding source.** A
control that fires on its creator is a control that actually discriminates.

### Instance 2 - control-health Arm B (the-analyst)

control-health v1 marked `verdict_core_authority_failure` as EXPECTED-SILENT keyed on
time-silence - but a dead detector is silent too, so silence-alone cannot tell dead from
healthy. Arm B added the paired content/liveness detector: a seeded proof-of-fire run at
each real event (daily) that actually proves the executed authority-failure chain is
fireable under simulated `core_loss` (stub-captured, no real emit), emitting
`verdict_core_proof_of_fire_ok`. Never the silence alone.

**Sub-instance, same class one layer down:** Arm B's own ok-beat originally used
`check=False` - a proof that PASSES while its liveness beat silently fails to land is
unearned-green in miniature (proxy = return status; detector = actual bus landing).
Hardened to `check=True` (delivery-verified) so the proof cannot pass on an undelivered
beat. Caught in Codex review.

## The structural fix

1. **A suppression keyed to a proxy MUST be paired with a content/liveness detector on the
   axis the proxy cannot see** - checked at each REAL event when real events are frequent
   (instance 1: a per-real-backup-run content recheck), OR, when real events are rare or
   absent, a SEEDED positive on a cadence that MANUFACTURES the condition (instance 2: a
   daily seeded proof-of-fire that points `BANNED_TERMS_JSON` at a missing file to force the
   authority-failure chain). The proxy is a fine ROUTE signal; the failure is using it as
   the sole LIVENESS signal under suppression, and **the fix is an affirmative check whose
   CADENCE DOES NOT DEPEND ON REAL EVENTS OCCURRING.**
   - **The dormant-branch trap (why seeded-on-cadence is not merely an alternative):** an
     event-triggered detector goes DORMANT if its triggering event becomes rare or frozen -
     during a launch-pipeline freeze real authority checks may not fire for days, and if the
     backup job itself stops running, instance 1's per-real-run recheck silently stops
     covering too. When events can go absent, seed the condition on a cadence so the detector
     stays live regardless. (the-analyst, from Arm B under the current freeze.)
2. **The detector confirms a positive, not an absence.** A seeded proof-of-fire, a
   content fingerprint compared to a known baseline, a delivery-verified beat - an
   affirmative token from the thing checked, not "the proxy didn't move." (Ties to the
   fleet affirmative-token rule.)
3. **Make the ack self-documenting about what it does and does NOT cover.** The launchd ack
   entry was annotated with its coverage boundary + who owns the axis it can't see, so a
   future reader (or the same author later) sees the gap without re-deriving it. A stated
   `LIMIT` on the suppression, per the guardrail template.
4. **Split ownership cleanly:** the proxy owner suppresses the route; the content owner
   watches the axis the proxy can't see and pings to lift the suppression early if content
   moves. (launchd: analyst owns the exit-code route + ack; security owns the finding-
   content recheck.)

## LIMIT

Verified on two controls: the launchd exit-code / gitleaks-content case (security-agent,
2026-09-28, live-fire validated) and control-health Arm B time-silence / proof-of-fire
case (the-analyst, same week). The pattern is specifically about proxy-keyed
**suppression** (acks, dedup, behavior-change-refire, EXPECTED-SILENT), not detection
triggers in general - that is the parent proxy-vs-detector rule this corollary hangs off.
It says nothing about whether a given proxy is a good ROUTE signal (it usually is); only
that a proxy must not be the sole LIVENESS signal once you suppress on it. Says nothing
about controls with no suppression layer.

## Cross-links

- knowledge.md - "a trigger that also describes the HEALTHY case is a proxy, not a
  detector" (2026-07-28); "silence from an instrument is not evidence about the world."
- knowledge.md - "list-tasks --project ... rc=1 + empty stdout = UNMEASURED, not zero"
  (same same-value-masking family, consumer-side).
- playbooks/fleet/FINDINGS-frozen-log-tail-false-codered-2026-07-29.md (adjacent:
  instrument silence read as a negative result).
- registry-v2 Arm B (the-analyst) - the proof-of-fire liveness detector + the check=True
  delivery-verified hardening.
- security-agent CHANGELOG 2026-09-28 (the 9e9c7c6e → f37a7b0a self-trip amend) and
  task_1790566814538 (the per-real-run content-recheck gate this validated).
