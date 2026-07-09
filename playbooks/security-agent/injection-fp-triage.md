---
type: playbook
agent: security-agent
process: injection-fp-triage
status: active
date: 2026-07-09
tags: [playbook, security, injection, false-positive, baseline]
---

# Injection-Scan FP Triage + Baseline Maintenance

The standing loop that keeps the injection scanner's signal clean. The 12h zero-model `fleet-scan` (see [fleet/zero-model-monitors.md](../fleet/zero-model-monitors.md)) surfaces new findings; this agent triages each one and maintains the baseline so real signal never drowns in known-benign noise. Runs whenever a scan surfaces new keys - in practice multiple times daily.

## The loop

1. **Verify each new finding**: read the flagged content in place and classify - real signal vs false positive (typical FP class: attack-technique PROSE quoted for fidelity in this agent's own threat-intel/memory docs, inert strings never executed).
2. **Baseline confirmed FPs**: add the finding keys to the baseline so they never re-fire; re-scan to confirm clean.
3. **Log every baseline change to the CHANGELOG** - the baseline is an auditable artifact, never silently grown.
4. **Escalate the pattern, not just the instance**: a recurring FP class (e.g. a category the self-audit suppression does not cover) gets a durable suppression design bundled for orchestrator review during active hours - suppression scope changes are reviewed, never self-applied.
5. **Tell Adam when a scan alert reached him**: if the zero-model layer pinged, close the loop with the FP/real verdict.

## Safety rails

- Suppressions are scoped tight (rule + path), never blanket; real-secret rules stay active everywhere - prove it by planting a positive after any allowlist change.
- Constant-zero is a dead-scan smell: a scanner that never fires again after a baseline change is verified alive by a planted positive, not trusted silent.
