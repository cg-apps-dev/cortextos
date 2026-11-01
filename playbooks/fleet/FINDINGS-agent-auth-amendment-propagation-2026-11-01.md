# FINDINGS - agent-auth SKILL.md amendment propagation (2026-11-01)

**Driver:** task_1785598365339_30180753 ([FOLLOW-UP] Propagate agent-auth SKILL.md amendment to 6 per-agent copies), carried under G2 Sun 11-01 doc-propagation backlog (task_1793549091122_40024503). Orchestrator GO on both scope flags (template YES, vitalis YES), branch-and-propose + two-party control confirmed.

**Lane:** DESCRIPTIVE propagation of a known-canonical amendment. Orchestrator reviews this branch (tracked template diff + this plan); on approval sop-keeper applies the surgical patch to the 6 gitignored live copies and the template lands via the branch. Per-copy verify is byte-anchored (below).

---

## The amendment (canonical = `community/skills/agent-auth/SKILL.md`)

Two edits inside `## 3. PER-ACCOUNT SETUP-TOKEN PROCEDURE`:

1. **INSERT** a paragraph immediately after the `## 3.` heading (one blank line above and below), before `**Account ↔ email map**`:

   > **CHECK BEFORE YOU ASK (Adam hard rule, 2026-07-24) - do this before step 1.** Agent setup-tokens already exist on-machine in almost every case; a human ask is the LAST resort, never the first move. Check order: (1) the vault - `state/oauth/setup-tokens/<ACCOUNT>.token`; (2) `state/oauth/accounts.json` (`.accounts.<NAME>`); (3) `cortextos list-vault-accounts`. Only mint a fresh token (step 1 below) if all three come up empty for that account. To MOVE an already-provisioned agent between accounts, use the gated `cortextos switch-agent-account <agent> <account>` ([fleet/switch-agent-account.md](<LINK>) - both-halves flip + restart + verify + rollback + functional-sweep) instead of a hand-edited `.env`. Origin: 2026-07-24, the orchestrator wrongly asked Adam for the icloud setup-token that had existed in the vault since 2026-07-09.

2. **CHANGE** the steps header line:
   - from: `**Steps (per account):**`
   - to:   `**Steps (per account, once the check above confirms a fresh mint is genuinely needed):**`

### `<LINK>` is depth-adjusted per copy location (relative link must resolve to repo-root `playbooks/fleet/switch-agent-account.md`)

| Copy location | levels up to repo root | `<LINK>` value |
|---|---|---|
| `community/skills/agent-auth/` (canonical) | 3 | `../../../playbooks/fleet/switch-agent-account.md` |
| `templates/agent/.claude/skills/agent-auth/` | 5 | `../../../../../playbooks/fleet/switch-agent-account.md` |
| `orgs/<org>/agents/<agent>/.claude/skills/agent-auth/` (all 6 live) | 7 | `../../../../../../../playbooks/fleet/switch-agent-account.md` |

Target `playbooks/fleet/switch-agent-account.md` verified present on main and on disk. The 5-up and 7-up forms were resolver-checked (normpath) to that target.

---

## Inventory (live state, 2026-11-01)

Canonical community copy HAS the amendment (143 lines). All other copies MISSING it, all carry the clean single `**Steps (per account):**` anchor and the matching `## 3.` / `**Account ↔ email map**` structure, so the surgical insert is well-defined.

| Copy | has-rule | anchor present | notes |
|---|---|---|---|
| `templates/agent/.claude/skills/agent-auth/SKILL.md` (TRACKED) | before: no / after: YES | yes | FIXED in this branch (bonus gap: new agents inherited the un-amended skill; driver assumed community+templates, was community-only) |
| the-axon-agent | no | yes | live, gitignored |
| the-sop-keeper | no | yes | live, gitignored |
| vitalis | no | yes | live, gitignored - included per orch GO (agent-auth is infra, not private content; surgical anchor patch respects isolation) |
| the-production-house | no | yes | live, gitignored |
| the-tax-planning-agent (adam-personal) | no | yes | live, gitignored |
| atwood-dev-agent (atwood) | no | yes | live, gitignored |

Two pre-amendment drift groups observed (diff-lines vs canonical): 7-line {template, tax, atwood} and 14-line {axon, sop-keeper, vitalis, production-house}. **Out of scope** per orch ruling: propagate ONLY the amendment at the anchor; do NOT reconcile the other per-copy drift (that is general reconcile, ruled out). The surgical two-edit patch touches only the amendment paragraph + the one Steps line, so the other drift is left untouched by construction.

---

## Per-copy verification spec (run after applying each copy)

1. `grep -c "CHECK BEFORE YOU ASK" <copy>` == `1`
2. `grep -c "Steps (per account, once the check above" <copy>` == `1` and `grep -c "Steps (per account):" <copy>` == `0`
3. Relative link resolves: normpath(copy-dir + `<LINK>`) == `playbooks/fleet/switch-agent-account.md` and that file exists.
4. **Scope guard:** the ONLY changed lines vs the copy's pre-patch content are (a) the inserted amendment paragraph + its surrounding blank line and (b) the Steps header line. No other line changed.
5. **No em-dash introduced:** copy's em-dash occurrence count is unchanged by the patch (the amendment paragraph itself contains 0 em-dashes; verified on the template - line 61 = 0).

---

## Pre-existing observation (NOT in this task's scope)

The canonical agent-auth skill body carries **2 pre-existing em-dashes**, both on the "Scripted `.env` edits" paragraph (template line 81). They exist in the canonical source and propagate with every copy; they are not introduced by this amendment. Flagging for a separate em-dash-cleanup pass on the canonical (owner-routed), not folded into this propagation (would be general reconcile).

---

## Execution (on orch approval)

- Template: already edited in this branch (tracked diff under review).
- 6 live copies: apply the two-edit surgical patch with the 7-up `<LINK>`, run the per-copy verification spec on each, in one pass. Two-party control = orch approval + sop-keeper execution.
- Then CLOSE driver task_1785598365339 and complete task_1793549091122; log task_completed.
- Cron-management full-propagate (task_1793549441735) is a SEPARATE branch, SEQUENCED after this wave lands (orch constraint: one propagation wave at a time).
