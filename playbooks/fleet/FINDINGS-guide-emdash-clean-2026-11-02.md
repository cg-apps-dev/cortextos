# FINDINGS - CRONS_MIGRATION_GUIDE.md em-dash clean (2026-11-02)

**Task:** task_1793600767018_96171793 (adjacent surface from task_1793600316582; sequenced after the dead-path waves landed). At-source clean of the 19 pre-existing em-dashes the dead-path fix flagged. Process: fleet-doc-propagation discipline, wave-2 clean pattern (audit all substitutions for orch eyeball = two-party control on the clean), orch review gate before land.

**Applied:** uniform spaced-prose substitution ` <U+2014> ` -> ` - ` (all 19 were the spaced form; classified as clause / definition / table-cell-label separators; NONE are range dashes). Post-clean: em-dash 19 -> 0, line count 208 -> 208 (no structural change). Scoped: em-dash only, no path/content change (the path fix already landed in 6ba629fb).

## All 19 substitutions (for orch eyeball)

| # | line | before | after |
|---|---|---|---|
| 1 | L11 | ...untouched[EMDASH]non-destructive | ...untouched - non-destructive |
| 2 | L125 | ...list-crons <agent>`[EMDASH]confirm the cron is registered | ...list-crons <agent>` - confirm... |
| 3 | L126 | ...get-cron-log <agent>`[EMDASH]check execution history | ...get-cron-log <agent>` - check... |
| 4 | L131 | ...has a `crons` array[EMDASH]migration only imports | ...`crons` array - migration only... |
| 5 | L138 | ...back to `crons.json.bak`[EMDASH]the previous good copy | ...`crons.json.bak` - the previous... |
| 6 | L140 | ...applies to reloads only[EMDASH]an empty file at initial | ...reloads only - an empty file... |
| 7 | L149 | ...CronCreate is not recommended[EMDASH]session-local crons unreliable | ...not recommended - session-local... |
| 8 | L171 | ...`/workflows` \| Fleet overview[EMDASH]health summary panel | ...Fleet overview - health summary... |
| 9 | L173 | ...Cron detail page[EMDASH]edit form, execution history | ...Cron detail page - edit form... |
| 10-14 | L199-203 | `\| Dashboard[EMDASH]{fleet overview,cron detail,health page,test-fire button,execution history} \|` | `\| Dashboard - {...} \|` |
| 15-19 | L204-208 | `\| API[EMDASH]{fleet list,cron detail,execution log,manual fire,fleet health} \|` | `\| API - {...} \|` |

(Rows 10-19 are table cells where the em-dash separates a label from its sub-label; uniform ` - ` keeps the separator. All 19 verified spaced-prose, zero range dashes.)

## Verify
em-dash 19->0; 208 lines unchanged; no path/content change (diff is em-dash-only); single tracked file.

## Execution (on orch approval of the 19)
Land this branch (guarded-FF + destination-verify + gitleaks + backup push + ls-remote), complete task_1793600767018. Then task_1793601256578 (agent-management variant-landscape characterize-then-decide) is the last queued wave.
