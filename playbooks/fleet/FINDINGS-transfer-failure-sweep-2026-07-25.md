---
type: findings
scope: fleet
status: DRAFT - findings only, no edits applied; the-orchestrator to rule
date: 2026-07-25
author: the-analyst
corpus-ref: main @ 0fd3f721e (CLAUDE.md + playbooks/fleet, 15 files)
tags: [fleet, doc-sweep, transfer-failure, verification]
---

# Transfer-failure sweep — lessons stated in one place, absent where a sibling needs them

Commissioned by the-orchestrator 2026-07-25 from their own closing observation: *tonight's
parent-vs-child lesson was present, indexed, and forty lines away in the file that needed it.*
**Worth asking of every new rule whether some other section already solved it.**

**Corpus and ref.** `main @ 0fd3f721` — CLAUDE.md plus all 15 `playbooks/fleet` files. Every line
number below was read from that SHA, not from a working tree. *A doc sweep must declare which tree
it read: a correct line number from the wrong tree is not a weak finding, it is a confident wrong
one.* (Near-miss that produced the rule: my branch checkout was 210 lines behind on
`SPEC-phantom-identity-resolution.md` and lacked a CLAUDE.md fix committed 40 minutes earlier — the
first pair I would have filed was a defect the owner had already repaired.)

**Constraints applied** (orchestrator, binding): ten pairs hard cap; every pair states what the
receiving site would concretely **DO** differently; any pair whose answer is "nothing" is a
stylistic gap and was dropped.

**MECHANICAL vs PROSE — read this column first.** Added at the-orchestrator's instruction, from
security-agent's retraction of the optimistic reading of its own catch: *the only things that held
all night were mechanical.* `dist` is untouched at `10:47:40` after eleven hours, and **no-build is
the one rule with a perfect record precisely because it required nobody to notice anything.** Tonight
produced roughly twenty prose lessons and exactly one control with a perfect record; the-orchestrator
violated four of their own written rules in the session they wrote them. So each pair below is marked
**MECHANICAL** (closable by a check, a grep, a fixture assertion, or a deleted instruction) or
**PROSE** (closable only by better wording). Rank the mechanical ones above the prose ones regardless
of how severe the prose ones sound.

### How to count this document — assert the structure, do not re-derive it

```
grep -cE '^## [0-9]+\.'          →  11   pairs          (structural, cannot drift)
grep -cE '^> \*\*MECHANICAL'     →   9   mechanical
grep -cE '^> \*\*PROSE'          →   2   prose
grep -cE 'MECHANICAL|PROSE'      →  UNSTABLE — do not use
```

**The three structural counts self-check against this file and are verified to.** The naive
word-count is deliberately left unpinned, and the reason is a third-order instance of the same
defect: **it read 17 before this section existed, and writing this section moved it to 20.** A count
that changes when you describe the count cannot be asserted at all — so it is named as unusable
rather than given a number that would go stale in the act of publishing it.

**The gap between 11 and "however many words" IS a finding, so it is printed rather than tidied
away.** A reader counting the verdict *words* also counts every occurrence in this paragraph. On first reading
of this file the-orchestrator invented a pattern for a format they had not looked at, got **zero**,
caught it only because a zero on a just-described document is absurd — then corrected to **seventeen**
and reported it. *Both* were wrong, thirty seconds apart, in opposite directions, **on the document
that catalogues that exact error.**

> **IMPLAUSIBILITY CAUGHT THE ZERO AND MISSED THE SEVENTEEN — and that is failure by construction,
> not by chance.** It fires only on *absurd* wrongness, so **the corrected-but-still-wrong number is
> by definition the plausible one.** The consequence is the part that travels: **a second attempt at
> a broken measurement is more dangerous than the first, because it arrives wearing the authority of
> a correction and lands inside the plausible range.** Every retraction in this incident was a second
> attempt.

**This also demotes implausibility from "the thing that saved us four times tonight" to "the thing
that saves us only from the errors we would have caught anyway."** Hence the assertion block above: a
number that asserts itself beats one a reader re-derives with a pattern they invent — **the mechanical
column applied to the document that introduced the mechanical column.**

**And it caught one of mine.** "Seven of ten are mechanical" stood here until this edit. It was
correct for a draft in which §10 was the `README.md` staleness pair; when that was replaced by the
mechanical alert-path pair, **the count sentence sat outside the edited span and survived**. So the
delivery message said *seven mechanical, three prose* and the true figures were **8 / 2 at delivery
and 9 / 2 now** — the-orchestrator ranked the list against a number that was wrong when they got it.
That is `SPEC-phantom`'s span-replace class committed by this file's own author, inside this file,
and it is why the counts above are commands rather than prose.

**Kill rate — read this before the list.** Five further candidates were verified and **two were
killed on the DO-differently test**, both by a single grep:
- *"`cost_entries` has a catastrophic invariant and no way to check it"* — **false**.
  `dashboard/src/lib/data/reports.ts:1018-1020` queries `sqlite_master` for the index,
  `db.test.ts:108-110` asserts it, and the live DB has it. Demoted to §10 (pointer only).
- *"the `CTX_*` scrub turned the sandbox-leak guard into a no-op with no positive control"* —
  **false**. `tests/sprint7-environment.test.ts:197` (TC-B) asserts the guard throws. **Dropped.**

Both were persuasive before verification. **A transfer failure is an argument about ABSENCE, and
absence is the hardest thing to be right about** — so the failure mode of this document is a
confident false pair, not a missed one. Its companion, supplied by the-orchestrator after nearly
refuting §1 from a `cut -c1-140` view of a ~900-character table cell: **the reviewer of an absence
claim is equally likely to falsely refute it, by the same mechanism.**

---

## 1. `standing-rules.md:52` — one verification clause missing FOUR sibling lessons

> **MECHANICAL.** One edit to one clause closes four transfer failures. The control is a second
> `grep -c` on the same pid; nobody has to remember anything.

**Receiving site.** `standing-rules.md:52`, at the end of the shared-credential-store registry row:
> Verify isolation via `ps eww <pid>` env `CLAUDE_CONFIG_DIR` present + no `.credentials.json`
> inside the isolated home

**Lessons that exist elsewhere in the same corpus and are absent here** (verified: 0 hits at line 52
for `LAYERED` / `leak-safe` / `names only` / `non-empty` / `positive control`):

| # | Lesson | Home |
|---|---|---|
| a | Bearer proof is **LAYERED — no single instrument may pass or fail it alone**; four layers, any miss = stop | `switch-agent-account.md:54` |
| b | **An EMPTY read = INDETERMINATE, never a failure**; pair the read with a planted positive | `switch-agent-account.md:54` |
| c | **Assert on the VALUE being non-empty, never on the KEY existing** — a key-presence check is a false green | `SPEC-phantom-identity-resolution.md:140` |
| d | **Never let raw `ps` output reach a transcript** — pipe it into a filter emitting names/fingerprints only | `SPEC-phantom-identity-resolution.md:470` |

**Why it matters, not merely that it differs.** This is the identical two-opposite-meanings defect
security-agent hit on the token grep tonight: **`CLAUDE_CONFIG_DIR` absent reads as "not isolated"
when the read may simply have failed.** The rule that fixes it was written into CLAUDE.md hours ago
and into `switch-agent-account.md` earlier still; this line inherited neither. It is a security
isolation check whose failure direction is "declare an agent isolated / not isolated on a read that
may not have happened."

**DO DIFFERENTLY.** Run a positive control on the same pid (`grep -cE '^CTX_AGENT_NAME='` or any
var known to be set) before interpreting the `CLAUDE_CONFIG_DIR` line; treat control=0 as
INDETERMINATE and escalate to a second layer rather than concluding; assert the value is non-empty,
not that the key exists; and pipe the `ps` read through the names-only filter.

**One site missing four lessons is a more useful finding than four sites missing one each** — it
says the receiving line was never re-read after any of them landed.

---

## 2. `zero-model-monitors.md:45` — the monitor layer's contract is the exact design its own fleet rule forbids

> **MECHANICAL.** A per-run stamp file plus a freshness assertion. This is the highest-value pair in
> the list: it converts the fleet's entire monitoring layer from unfalsifiable to checkable.

**Receiving site.** `zero-model-monitors.md:45`:
> **Quiet on success**: exit 0, no notification, no agent wake.

**Home of the lesson.** `standing-rules.md:119` (ratified 2026-07-15; this playbook is dated
2026-07-05 and was not revisited):
> DESIGN TELL: a step (or a process EXIT CODE) that returns a BARE VALUE gives the decision no way
> to distinguish complete+safe from partial+unknown, **or ran-and-passed from never-ran** — return
> completeness/confidence ALONGSIDE the value … **a positive PASS-TOKEN, never a bare exit-0**.

**Why it matters.** Silence is the pass signal for the *entire* zero-model monitor layer — thirteen
live jobs including `daily-backup`, `fleet-scan`, `check-all-usage` and `usage-monitor`. **A job
that dies at launch produces exactly the same observable as a job that ran and found everything
healthy.** The file already knows the adjacent half of this (`:47`, *constant-zero is a dead-scan
smell … proven alive by planting a positive, not by trusting silence*) — but applies it to whether a
monitor's **alert** can fire, never to whether the **job itself ran**.

**DO DIFFERENTLY.** Each job stamps a per-run state file on completion (the PASS-token); the audit
asserts the stamp is **fresher than that job's cadence**. Absent that, "no alert" is
unfalsifiable — which is the one property a monitoring layer must not have.

---

## 3. `zero-model-monitors.md:16-20` — the "authoritative check" is configuration inspection

> **MECHANICAL.** A two-line `comm` between the plist list and the loaded list. I ran it; it is nine
> words of shell.

**Receiving site.** `zero-model-monitors.md:16`, naming the authoritative check for what monitoring
runs: `launchctl list | grep -iE 'cortextos|cleangreen'` (annotated *"exit code 0 = healthy last
run"*) plus an `ls` of the plists at `:20`.

**Home of the lesson.** `standing-rules.md:127` (VT-1): *"A config read says what SHOULD be true;
behavior says what IS."* And `SPEC-phantom-identity-resolution.md:341`: **do not verify by reading
the configuration — configuration inspection confirms the key and proves nothing about the
resolution.**

**Measured at the pinned SHA, on this host:** 13 plists defined, 13 loaded, **zero mismatch in
either direction**, and every job shows `status=0  pid=-`. **The live incidence is zero — this is a
missing instruction, not an incident.** But `status=0` is the *last exit status*; with no pid and no
run artifact it is silent about whether the job has run at all this week, and the two lists are
never instructed to be compared, so a plist that exists but failed to load is absent from the
authoritative check and **absent reads as "not a job", not as "broken job"**.

**DO DIFFERENTLY.** Add the two-list comparison (defined-on-disk vs loaded) with a
DEFINED-BUT-NOT-LOADED flag; and make the liveness assertion behavioural — a run artifact inside the
cadence window — rather than "the plist is loaded".

---

## 4. `daemon-bounce.md:21` — a marker grep with no proof it can return a positive, in a file that demands a PASS-token nine lines later

> **MECHANICAL.** One extra grep for a known-present marker, in the same step.

**Receiving site.** `daemon-bounce.md:21`:
> VERIFY the fix markers are present in the BUILT `dist/daemon.js` (grep the marker — a green
> merge/build is NOT the same as the runtime having it).

**Home of the lesson.** `standing-rules.md:129` (VT-3): *"Empty output is not a confirmation. Before
concluding ABSENCE from an empty result, prove the query CAN return a positive — plant one."*

**Why it matters — and this one is intra-file as well as cross-file.** The same document at `:28`
requires the bounce-guard to trust *"only a positive PASS token — a bare exit-0 is not trusted."*
**A mistyped marker string and a genuinely missing fix produce identical empty output**, so this
step can certify a deploy that never landed. The file holds the standard for its guard and not for
its own verification step.

**DO DIFFERENTLY.** Grep a marker known to be present in `dist/daemon.js` first; if that also
returns empty, the read is UNMEASURED and the bounce does not proceed.

---

## 5. `rtk-engagement-sweep.md:39` — four method rules protecting a read that has no positive control

> **MECHANICAL.** Match a known-present row before reading the probe row; a fifth method rule in a
> file that already has four.

**Receiving site.** `rtk-engagement-sweep.md:39`:
> Read `history.db` with a non-immutable handle; match the row on `<unique-token>`.

**Home of the lesson.** `standing-rules.md:129` (VT-3); operationally, `switch-agent-account.md:54`
(*an EMPTY read = INDETERMINATE … pair the read with a planted positive*).

**Why it matters.** The file's own preamble at `:27` says every method rule below it exists because
**the probe read `0` twice before the true positive** — a real false-decay near-miss. Rules 1-4
harden the *command*, the *consistency mode* and the *row age*. None hardens the read itself:
**a mistyped token or a wrong db path is still indistinguishable from real decay** after all four
are honoured, and the documented consequence of a false zero here is a wrongly-declared decay.

**DO DIFFERENTLY.** Match a known-present row first (any prior probe token); only a query proven
able to return a positive may be read as evidence of decay.

---

## 6. `switch-agent-account.md:55` — the attribution check does not inherit the empty-read rule stated one line above it

> **MECHANICAL.** Run the command bare once before filtering. The fix is a line of shell, and the
> failure it prevents is an unnecessary account rollback.

**Receiving site.** `switch-agent-account.md:55`:
> **Attribution**: `cortextos bus list-agent-accounts | grep <agent>` = target account.

**Home of the lesson.** `switch-agent-account.md:54` — **the immediately preceding line**: *"an EMPTY
read = INDETERMINATE (try another layer, never rollback on it)"*, plus
`reader-repaired-corruption.md:71`: *before concluding ABSENCE from a filtered command, **run it
BARE once***.

**Why it matters.** `| grep <agent>` is a success-matching filter: a wrong agent-name string, a CLI
error, or a paging cap all render as "not the target account" — and the documented response to a
verify-fail is to **roll back the account move**. This is the strongest instance of
the-orchestrator's intra-section class: **the sentence learned it and the next sentence did not.**

**DO DIFFERENTLY.** Run `list-agent-accounts` bare once and confirm it returns rows before
interpreting the filtered result; treat an empty filtered read as INDETERMINATE per `:54`, never as
a failed attribution.

---

## 7. `CLAUDE.md` agent-auth section — the token-length gate exists fleet-wide and is absent from the apply instructions

> **MECHANICAL.** The gate already exists as `scripts/deploy-agent-token.sh` (`EXPECTED_LEN=108`).
> Closing this is naming the script as the only sanctioned write path — a redirect, not a warning.

**Receiving site.** CLAUDE.md's APPLY bullet (`chmod 600`, exactly one active line, strip stale
token lines). Verified at `0fd3f721`: **0 occurrences of `108`, 0 of `deploy-agent-token`** in the
whole file.

**Home of the lesson.** `standing-rules.md:53`:
> Any manually-delivered or transcribed setup-token is length-validated to **exactly 108 chars**
> BEFORE it is written to any `.env` … A correct-prefix, wrong-length string is the actual failure
> mode here — reject and request a clean recopy, never accept-and-hope.

**Why it matters.** That row records an **ESCAPED** defect that caused a fleet auth cascade: a
79-char half-token with the correct `sk-ant-oat01` prefix, undetectable until a runtime 401. The fix
shipped as `scripts/deploy-agent-token.sh` (`EXPECTED_LEN=108`). **An operator following CLAUDE.md
alone — the hard-rule document for this exact procedure — hand-writes a token with no length gate**
and reproduces the origin incident.

**DO DIFFERENTLY.** The APPLY bullet requires the exact-length validation, or names
`scripts/deploy-agent-token.sh` as the only sanctioned write path.

---

## 8. `reader-repaired-corruption.md:20` — a verification step with no method

> **PROSE.** The fix is a cross-reference to `standing-rules.md:159`. Nothing here becomes
> machine-checkable, so rank it below every mechanical pair even though the subject is severe.

**Receiving site.** `reader-repaired-corruption.md:20`:
> PARAPHRASE THE PROSE. QUOTE THE FIGURES. **VERIFY THE FIGURES YOU QUOTE.**

**Home of the lesson.** `standing-rules.md:159` (verify-before-stating): definition + derivation +
**a second independent source**, with the tell *scrutinize the count / denominator / definition, not
the raw dollars*, and `:164` *an independent system, not a second cut of the same one*.

**Why it matters.** The instruction names an obligation and supplies no way to discharge it or to
tell a verified figure from an unverified one — in a playbook whose entire subject is figures
silently corrupted in transit. The receiving rule is the fleet's most developed answer to exactly
this question, in the same directory.

**DO DIFFERENTLY.** "Verify" resolves to: name the source of truth for the figure, re-derive it, and
confirm against a second independent system — or carry it as PROVISIONAL.

---

## 9. `naming-convention-new-producers.md:32, :34` — remediation-sizing steps that repeat the file's own diagnosed failure

> **PROSE.** Both steps are human enumeration instructions; the fix is requiring the cap be published
> with the count. Real, but it depends on an author remembering — which is the property this list is
> supposed to rank down.

**Receiving site.** `:32` *"enumerate the NON-DOMINANT writers' full card set before deciding
remediation"* and `:34` *"check whether the secondary allocators are ACTIVE or DORMANT"*.

**Home of the lesson.** The **same file** at `:29`: the "zero collisions" all-clear reversed to five
live collisions because the method was **capped at 4 pages across 2 of 9 lists and the cap was
unstated**, so the result read as exhaustive.

**Why it matters.** Both steps prescribe an enumeration and a status read with no paging or
uncapped-run discipline attached — the identical shape that produced the incident the file exists to
document. **A file can diagnose a failure in its retrospective and re-commit it in its
recommendations**, because the two halves are written in different modes.

**DO DIFFERENTLY.** Both steps state the paging discipline and require the cap (or its absence) to
be published with the count.

---

## 10. `zero-model-monitors.md:46` — the monitor layer's ALERT path is as unverified as its pass path

> **MECHANICAL.** Capture the send's output and assert the success signature. Same one-line shape
> already adopted fleet-wide for `send-message`.

**Receiving site.** `zero-model-monitors.md:46`:
> **The script owns its own alerting**: threshold breach or failure sends Telegram directly, with
> dedup via a state file.

**Home of the lesson.** `shell-expansion-safety-addendum-2026-07-25.md:1106`: **capture the output,
assert the success signature** — explicitly chosen over recognising failure shapes because it is
immune to a lost exit code through a pipe. (Verified at that line; my own reader cited `:1102`, four
lines off, and I would have published their number.)

**Why it matters — this is §2's other half and together they are the finding.** §2 shows the
monitor layer's *pass* signal is unverifiable silence. This shows its *fail* signal is an
**unchecked** Telegram send: nothing asserts the alert arrived. Verified: **0 occurrences** of
`assert` / `success signature` / `msg_id` / `delivery` anywhere in the file. So a threshold breach
whose alert send fails is observationally identical to a healthy run — **both halves of the contract
resolve to silence, and silence is also what success looks like.** Thirteen live jobs, including
`daily-backup`, `fleet-scan` and `usage-monitor`, run on this contract.

**DO DIFFERENTLY.** The contract requires each job to capture its alert send's output, assert the
success signature, and on absence write a route-failure to the durable trail — the one channel that
does not depend on the channel that just failed.

**Demoted to footnotes** (real, but below the bar): `README.md:23` describes `standing-rules.md` as
containing *"playbook-maintenance-is-part-of-DoD"* when it holds **13 `## Standing rule` sections** —
staleness, no verification step depends on it, **PROSE**. And CLAUDE.md's `cost_entries` section
narrates a 147x-inflation invariant with no verification handle while the check exists at
`dashboard/src/lib/data/reports.ts:1018-1020` — a missing **pointer**, not a missing control.

---

## 11. `src/pty/redact.ts` — two half-redactors sharing a name (added post-delivery)

> **MECHANICAL.** A rename plus one sentence at minimum; a second pattern for the real fix.

Found by the-orchestrator while auditing their own proposal, after the ten were delivered. It is the
only pair here spanning **code** rather than docs, and it went through three characterisations before
measurement settled it — which is why it is written up with the wrong ones left in place.

**Measured, bounded to the function bodies** (synthetic values only, never a live token):

| | `src/pty/redact.ts:50` | `src/daemon/fast-checker.ts:95` |
|---|---|---|
| JWT | **REDACTS** | passes |
| `sk-ant-…` setup-token | passes | **REDACTS** |
| `CLAUDE_CODE_OAUTH_TOKEN=` | passes | **REDACTS** |
| `Authorization: Bearer …` | passes | passes |

**Two exported functions, both named `redactSecrets`, complementary with an EMPTY INTERSECTION.**
Each covers exactly what the other misses. **The fleet does not have a good redactor and a weak one;
it has two half-redactors sharing a name, whose union would be correct and neither of which is** —
and each is correct for the path it was written for, which is why neither author was wrong and the
pair is still broken. **Bearer passes both**, so that hazard is uncovered everywhere; it is also the
format the live MCP servers use, i.e. **the one credential class with a confirmed live exposure is
the one no redactor touches.**

**Three characterisations, corrected in order — the sequence is the finding.**
1. *"Fleet-wide blindness to the credential the fleet runs on."* **Wrong.** `fast-checker.ts` was
   never opened; the message and fleet-health path is protected at its call sites.
2. *"The docstring overclaims."* **Wrong.** No sentence in `redact.ts` is false. The function doc
   says *JWT-shaped*, the constant is `JWT_PATTERN`, and the three-part list at `:9` sits in the
   **hazard** paragraph — a statement about the risk, not about coverage. **The overclaim is the
   export name.** It is not narrower than its documentation, which a reader could catch by reading
   the documentation — **it is narrower than its name.**
3. *"A call site cannot tell which guarantee it gets."* **Narrowed.** Exactly one import exists in
   the tree (`src/pty/output-buffer.ts:2`); `fast-checker`'s version is imported by zero others. **A
   READER hazard, not a RESOLUTION hazard** — the risk is a maintainer assuming parity, not a
   mis-binding.

**Why it survived review.** `redact.ts:13` records the origin as `authjs.session-token=eyJ...` — **a
session cookie whose value is a JWT**, so it is caught by the JWT pattern. The remedy looked complete
against the exact evidence that motivated it. `output-buffer.test.ts` does assert redaction, single-
and multi-chunk; **the gap is not missing tests, it is that every test is an origin-case test.**
**A fix validated only on its origin case is untested on every other member of the class it claims**,
and here the origin case is the one member belonging to both sets.

**The rule it violates, already in this corpus:** `reader-repaired-corruption.md:55` — *if you named
a method to establish confidence, you owe its blind spot in the same sentence.* The blind spot is
nowhere in the file.

**DO DIFFERENTLY.** Name each function for what it covers (`redactJwts` / `redactAnthropicTokens`),
state the uncovered hazards in the same docstring that names the covered one, and add the Bearer
pattern that neither implementation has.

---

## The class this sweep is really about

Every pair above is the same shape: **the lesson was already written down, in the same directory,
often in the same file.** Not one required new knowledge. What they required was somebody re-reading
a receiving site after a rule landed somewhere else — which nothing in the current process triggers.

**Sharpened by what happened while this file was being written, and it is a stronger claim.** Three
agents converged on an alarming reading of §11 and reinforced each other across four messages; none
had opened `fast-checker.ts`. The rule against exactly that is `SPEC-single-voice:78` — *when a claim
is confirmed by many and checked by none, the confirmations are one observation, not seven* — written
by one of the three, who re-derived it tonight as though it were new. **And the surrounding lines
name the remedy too: what broke the earlier false consensus was one agent using a different
instrument**, which is what broke this one (an unopened file). The rule and its remedy were both
already on the page.

**So the finding is not that lessons live one file away. It is that they live one file away FROM
THEIR OWN AUTHORS, HOURS LATER.** Ten pairs about that, published by two agents who then did it,
inside the hour — and the eleventh pair is the instance.

**Corollary, from four separate saves tonight: IMPLAUSIBILITY IS NOT A CONTROL.** A wrong denominator,
a detector aimed at nothing, a scan over the wrong tree, and a regex extraction that pooled 45
patterns from a whole file and attributed them to one function — every one was caught because the
number looked absurd to its own author, and none by a check that was designed to catch it. **It is a
coincidence that keeps holding, and it will stop.** That is the argument for the MECHANICAL column,
stated as evidence rather than as preference.

**The-orchestrator's intra-section variant is the sharper form** and §6 is its cleanest instance:
the unit of inheritance is smaller than a section. Their own case (CLAUDE.md, same night) had a
mechanism worth stating: **a span-replace anchored on the introducing sentence leaves the operative
closing instruction beyond the anchor, and the surrounding prose now arguing against it is what
makes the orphan invisible.** A reviewer asking *does this paragraph state the right rule* gets YES;
the defect is in what the paragraph still **instructs** after stating it, and those are different
reads. Their repair — deleting seven words rather than rewriting — follows: *a rewrite is what
dropped it, and a second rewrite is how you drop the next one.*

**And the ranking says something the pairs do not.** Four pairs land on `zero-model-monitors.md`
and its contract (§2, §3, §10) — **the fleet's monitoring layer is the least-instrumented file in the
corpus**, and it is the file whose job is instrumenting everything else. Its pass signal is silence,
its fail signal is an unchecked send, and its authoritative check is a config read. That is not three
findings, it is one: **nothing in that layer can distinguish working from absent.**

**The split is in the assertion block above — deliberately not restated here, because a restated
number is a second site by definition, and this exact sentence was the third stale copy of it.**
Ranked mechanical-first per the-orchestrator's instruction — and the
reason is the night's own scoreboard: roughly twenty prose lessons produced, four of them violated by
their own author within the session, against one mechanical control (`no build`) with a perfect
eleven-hour record. **A rule that requires someone to notice something has a worse record tonight
than a rule that does not.**

**Corpus caveat, stated because a bounded claim in the result line beats one beneath it:**
`shell-expansion-safety.md` and its addendum were swept last and are under-represented above — §10
is the only pair drawn from them. **Treat this list as a floor, not a census.**
