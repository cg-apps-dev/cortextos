# FINDINGS: The multi-copy-consumer trap (doc/skill currency fixes) - 2026-09-18

**Class:** shared-tool-footgun = org knowledge. Bit two agents in one hour (security-agent + the-orchestrator), and it is the-orchestrator's own 2026-08-01 lesson repeated ("verify the file the CONSUMER resolves to, not the file you can name"). Banked to fleet knowledge so the next agent does not re-derive it.

## The three points (crisp + usable)

1. **A doc/skill-currency fix must ENUMERATE ALL COPIES, not just the flagged one.** A skill or template doc commonly exists as multiple synced copies across distinct surfaces:
   - `templates/agent/.claude/skills/**` = **spawn source** a new agent inherits at `add-agent`.
   - `community/skills/**` = **catalog** copy for new-ORG installs.
   - `orgs/<org>/agents/<agent>/.claude/skills/**` = **live per-agent DIST** copies the running agent actually reads at runtime (gitignored/untracked).
   Fixing one surface leaves the others stale. Fix ALL: patch each (exact-string replace, verify per file), COMMIT the tracked ones (source + catalog), RUNTIME-fix the untracked live dist copies directly.

2. **General form: verify which copy the CONSUMER actually resolves to - never the copy you can name.** The failure both agents made was naming the single copy each could see (`community/` for one, "the working tree" for the other) and *assuming* it was what agents read. It was not - agents read their per-agent dist copy. Before claiming "runtime-correct," resolve the consumer's actual path. Method: `find <repo> ~/.cortextos -path '*<skill>/SKILL.md'`, grep each for the stale token, and check byte-identity across copies (`md5`) to know how many distinct versions exist.

3. **Compounded when copies are frozen-at-spawn.** If per-agent skill dist copies are copied by `add-agent` and never re-synced, then EVERY future community-skill doc fix repeats the full manual copy-hunt fleet-wide. That is a propagation-architecture gap, not a one-off - tracked for sop-keeper + dev as `task_1789744919499_10102642` (should per-agent skill dist auto-sync from source?).

## Incident of record
Stale meter-state line in the `agent-auth` skill (`icloud-max-20x` listed "metered/ON"; live = OFF, deliberate hardcap since 2026-06-23). First pass fixed ONLY `community/skills/agent-auth/SKILL.md` and claimed "live doc agents read is already correct" - WRONG. the-sop-keeper's completeness check found the `templates/agent` spawn source + 4 live per-agent dist copies (the-production-house, vitalis, the-sop-keeper, the-axon-agent) all still stale. Full fix = 6 copies; the 2 tracked committed as `ede875ae`, the 4 live runtime-fixed directly. Pairs with [[verify-then-contain]] (a fix must cover EXISTING STATE across ALL instances, not just going-forward / not just one surface).

## Detector-coverage defect: check-skill-drift is a not-scanned-zero for canonical skills (gap c)

`cortextos bus check-skill-drift` (`src/bus/skill-drift.ts`) enumerates a HARDCODED `SKILL_SYNC_PAIRS` list containing exactly ONE pair (meta-intake / meta-ads-agent). It does not scan `agent-auth` or any other skill, so its "0 drift" for agent-auth is a NOT-SCANNED-zero, not an in-sync-zero - a silent fail-open on a security-relevant detector for every canonical skill but meta-intake. (Verified by claude-dev: source read + live run = 15 drift files, all meta-intake, zero agent-auth, 2026-09-18.) This is the CONSTANT-0 / dead-scan-smell class: a scanner that has never returned >0 for a class is suspect; never infer health from a 0 you have not proven the scanner can PRODUCE.

**Acceptance gate for any fix (the fix must not itself fail-open):**
- Detector-scope (extend enumeration to the canonical-skill set fleet-wide): prove it DISCRIMINATES - plant a stale line in a live canonical copy AND keep a known-in-sync control; require flag-the-planted + pass-the-control (a broken detector returns nonzero trivially). Plant across >=2 agents, because a detector that scans agent X but not agent Y passes a single-agent plant and still misses Y - prove the enumeration over the TRUE universe, not one sampled agent.
- Reconcile (auto-sync canonical, flag-not-clobber diverged): TWO plants, both sides. (1) a stale-drifted canonical copy must be REACHED and synced. (2) an intentionally-diverged (locally-edited) canonical copy must be FLAGGED, never clobbered. The clobber-safety half is the one that fails silently, so it needs the adversarial plant.

Fix design lives in claude-dev's post-jitter spec (`task_1789744919499`), which cites this record as the defect it closes.
