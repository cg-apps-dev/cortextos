# FINDINGS: the selection-defect class, 2026-07-28

Owner: security-agent. Filed after four instances of one shape surfaced in a single
evening across three agents (security-agent, claude-dev-agent, the-orchestrator).

## The class in one line

**A scan is never wrong about what it scanned. It is wrong about what it scanned.**
Every instance below is a SELECTION step that excludes the thing that matters, then
reports confidently on what remains.

## The four instances, all 2026-07-28

| # | Instrument | Selection step | What it excluded |
|---|---|---|---|
| 1 | `leak-shape-scan.sh` classifier | extension allowlist | `.js` / `.cjs` / `.mjs` |
| 2 | `leak-shape-scan.sh` enumeration | `git ls-tree` into a loop | everything, on a failed ref (reported clean) |
| 3 | claude-dev sweep corpus | `git ls-files '*.sh'` | `scripts/hooks/pre-push` (no extension) |
| 4 | `leak-shape-scan.sh` classifier | extension allowlist + directory arms | extensionless files OUTSIDE `src/ dashboard/ templates/ scripts/` |
| 5 | **this document's own repro for #4** | chose the subject path by hand | the real subject (`scripts/hooks/pre-push`) |

Instances 1, 2 and 4 are the same file. 4 was found hours after 1 was fixed, by
applying another agent's observation about instance 3 back onto our own guard.

**Instance 5 is the sharpest one and it is this document's.** The repro for #4 used
`hooks/pre-push`, a path that does not exist in this repo, and so produced the
confident and FALSE headline "the guard cannot scan the guard." The class defect
pointed at the test instead of the code: a hand-picked subject that excluded the thing
that mattered, reported confidently on what remained. It was caught by another agent
reading the classifier source rather than trusting the repro. See the corrected section
below.

## Instance 4, CORRECTED. The alarming half was wrong.

**A first version of this document claimed "the guard cannot scan the guard." That is
FALSE and is retracted.** It is preserved here rather than deleted because the way it
went wrong is instance 5.

The classifier's FIRST arm selects by DIRECTORY PREFIX, before the extension list is
ever consulted (`leak-shape-scan.sh:19`):

```sh
src/*|dashboard/*|templates/*|scripts/*) return 0 ;;   # L19, runs first
*.json|*.ts|*.js|*.cjs|*.mjs|*.sh|*.yml|*.yaml|*.toml) return 0 ;;   # L28
```

Verified live against real paths, identical operator-path bytes in each:

```
scripts/hooks/pre-push   -> FLAGGED      <- the actual guard. IT IS SCANNED, via scripts/*
bin/deploy               -> not flagged  <- the REAL shape of the gap
LICENSE                  -> not flagged  <- no shebang, correctly out of scope
```

**The original repro used `hooks/pre-push`, a path that does not exist in this repo.**
The claim was produced by a test whose own selection step excluded the real subject.

### The narrowed gap that survives

An extensionless executable **outside** `src/`, `dashboard/`, `templates/`, `scripts/`.
A `bin/deploy`, a root-level `configure`.

**Exposure: ZERO, and for a structural reason rather than a contents reason.** Tracked
extensionless files: 2. Covered by a directory arm: 1 (`scripts/hooks/pre-push`). Not
covered: 1 (`LICENSE`, which has no shebang and is not code). The original zero rested
on "the one extensionless executable happens to be clean", which depends on a file's
CONTENTS staying clean. The real zero rests on structure and is far more durable.

**This changes the priority, not the verdict.** It is not a latent hole in a security
guard needing a scheduled handoff. It is a coverage edge that would bite a future
extensionless executable placed outside those four prefixes. Worth a one-line widening
whenever the file is next open.

**Spec, so it is captured rather than re-derived:** add a shebang test as an OR
alongside the existing arms. If the blob's first line matches `^#!.*\b(ba)?sh\b`, select
it regardless of path or extension. Acceptance: identical operator-path content in
`bin/deploy` must FLAG; `LICENSE` must NOT; **and the existing rows must be unchanged**,
which is the row that matters, since widening a classifier is exactly how false
positives are acquired.

## The sibling defect found the same night: silent death under errexit

`set -euo pipefail` plus `x="$(cmd)"; rc=$?` dies AT THE ASSIGNMENT, because the
assignment returns the command's status. `rc=$?` never runs and every branch below it
is unreachable.

**It is SILENT specifically when the line captures stderr via `2>&1`**, because the
diagnostic goes into a variable that dies with the script. Without `2>&1` the failure
still speaks. That is a greppable predicate, not a judgement call about whether a
command "fails routinely".

Two live instances in `scripts/hooks/pre-push`, both now guarded as
`rc=0; x="$(cmd 2>&1)" || rc=$?`:

- **L77** (gitleaks arm, found by claude-dev): made the whole FAILED-TO-RUN versus
  found-a-secret classification unreachable. A correct fix that never ran.
- **L149** (shape arm, written by security-agent 20 minutes earlier, while reading the
  report about L77): a fork push of a tree carrying a real leak exited 1 **with no
  reason printed**. The guard was silent on the exact case it exists for.

Swept repo-wide afterwards: 76 tracked shell files, 60 carrying errexit, **0** remaining
unguarded stderr-capturing assignments.

## Do not "unify" the errexit settings

`pre-push` uses `set -euo pipefail`; `leak-shape-scan.sh` uses `set -uo pipefail` and
omits `-e` **deliberately**. A scanner that aborts on the first unreadable file reports
clean on a partial tree, which is instance 2 of the class above. The omission is
load-bearing. Correct treatment is a comment at the PASTE ORIGIN in each file, since
that is what reaches the person pasting between them.

## Detector doctrine, arrived at by breaking four detectors in one evening

1. **Ship a detector whose self-test fixtures are written by SOMEONE ELSE.** You cannot
   write the fixture for a form you did not model. Every hole found tonight came from
   another agent's fixture or from auditing our own enumeration. None came from the
   detector on its own inputs.
2. **Disclosure is not coverage.** A scanner that PRINTS what it skipped beats one that
   hides it, and is not the same as one that looked. "Reports its skips" reads like
   completeness and is not.
3. **A wrong model is worse than a missing case.** A missing case reports nothing. The
   `local` / `export` / `declare` / `readonly` builtins SWALLOW the command status
   (errexit never fires; `$?` is the builtin's zero; the script continues with a bad
   value), and the detector called that "silent death" because its regex had opted those
   keywords IN. That is the wrong answer with a number attached.
4. **Audit the enumeration one level above your verdict.** A published `files=3` was the
   author's own SELECTION. The coverage number described what was chosen to be looked
   at, not the repo.
5. **Give the detector teeth in the FALSE-POSITIVE direction too.** A scanner that flags
   everything also "catches" everything. Assert that a known-clean form yields ZERO
   findings (here: arithmetic `$((` must not be reported).
6. **Consume an affirmative token, never an exit code.** `rc=0` is a class, and
   "flag not implemented" is a member of it.

## The fix for instance 5: a repro must carry its subject's PROVENANCE

Proposed by claude-dev-agent, adopted here. The rule "re-derive the path from the
artifact, never type it from memory" is a DISCIPLINE, and every discipline tested in
this document decayed. It was written down for locators three hours before a repro
subject was typed from memory anyway. Available is not operative.

The structural form records the command that DERIVED the subject, beside the subject:

```
    BAD    reproduced with hooks/pre-push

    GOOD   subject: git ls-files | grep -E 'hooks/pre-push$'   ->   scripts/hooks/pre-push
```

This is **self-invalidating**. Verified against the actual failure: the derivation
returns `scripts/hooks/pre-push`, and `hooks/pre-push` is absent from that output, so
the repro announces its own defect at WRITE time, before the claim can form.

It is the same shape as the affirmative token (`SHAPE-GUARD-SCANNED-OK files=N`), which
is why it is trustworthy: **both replace a claim with an artifact that cannot be
produced by the failure mode.** A token proves the scan happened; a derivation proves
the subject was found. This is the fourth surface that form has been reached
independently in one evening, after exit codes, enumeration, and coverage counts.

It also removes a prerequisite. A reader can already re-run a test and check its RESULT;
they cannot check that the test was pointed at the right THING without independently
suspecting it, which requires already doubting the author. Provenance makes the subject
auditable by the same mechanism the result already is.

### Its limit, stated now so it is not oversold

**Provenance makes the subject auditable. It does not make it correct.** A derivation
command can carry the very defect it guards against. Measured here:

```
git ls-files | grep -E 'hooks/pre-push$'   ->   scripts/hooks/pre-push   (1 hit)
```

`.git/hooks/pre-push` exists, is UNTRACKED, and `git ls-files` can never return it. So
that derivation silently excludes the INSTALLED hook, which is the copy that actually
executes. A repro carrying it would be auditable, self-consistent, and pointed at the
source rather than the thing that runs.

Same relationship as **disclosure is not coverage**: recording the derivation beats
typing a path from memory, and is not the same as the derivation being right.

Put those two adjacent, because they are the same species: **a mechanism that improves
the OBSERVABILITY of a thing without improving the THING.** Printing skipped lines does
not scan them. Recording a derivation does not aim it. Each is a real improvement, and
neither is the property a reader will assume it bought.

### The sharper form: name the UNIVERSE, not just the subject

Every derivation encodes a choice of universe, and `git ls-files` means "tracked files".
Recording the command makes the SELECTION auditable while leaving the UNIVERSE implicit.
Two universes exist for a git hook, and they answer different questions:

```
scope SOURCE  (what ships)     git ls-files | grep -E 'hooks/pre-push$'  -> scripts/hooks/pre-push
scope RUNTIME (what executes)  ls .git/hooks/pre-push                    -> .git/hooks/pre-push
```

Neither is more correct. **A repro that does not say which question it is asking is
unfalsifiable in that dimension.** Instance 4 was a RUNTIME-shaped claim (can the guard
see the guard as it runs) carrying a SOURCE-scoped derivation.

This applies to this document's own verification. Tonight's both-arms test ran
`.git/hooks/pre-push`, because git invokes the INSTALLED copy. **That was a RUNTIME
result. It is also a SOURCE result only because the two are identical** (both
`af375a4d...`, verified by `cmp`). That was never stated at the time.

The seam is not uniform across the guard chain, which is why it has to be checked per
artifact rather than assumed:

| Artifact | Universes | Seam |
|---|---|---|
| `pre-push` | installed + tracked source | REAL. `cmp` them or name which you mean. |
| `leak-shape-scan.sh` | one | NONE. No installed copy; resolved at runtime via `$main_root/scripts/hooks/`, so source IS runtime. |

**Practice: name the universe; where two exist for one artifact, assert they agree or
state which you mean.** The moment they diverge, a source-scoped derivation is silently
wrong about runtime and nothing in the provenance says so.

## The sentence to keep (claude-dev-agent)

> **My 0 was correct by luck.**

Their sweep excluded `scripts/hooks/pre-push` and still returned the right answer, only
because security-agent had already fixed that file hours earlier. Had the bug still been
there, a broken corpus would have reported ZERO and been confidently wrong.

**A correct answer from a broken instrument is the most dangerous state there is,
because nothing in the output distinguishes it from a correct answer from a good one.**
It was caught only by chasing a one-file delta that could reasonably have been written
off as scope.

## Artifacts

- `cortextos-deliverables/guard-provenance/seterr-capture-scan.sh` (0700). Covers both
  errexit forms, classifies builtin-swallow separately, excludes arithmetic, prints every
  unclassified line, refuses clean on zero or unreadable files, emits
  `SETERR-CAPTURE-SCANNED-OK files= lines= skipped=`, and `--self-test` regression-tests
  all four holes (currently 4/4, and it failed loudly at 3/4 twice before passing).
- **Findability note:** `cortextos-deliverables` is a SIBLING of `cortextos`, not a
  child. `find $HOME/cortextos` does not descend into it. That cost one agent a search.

## The gap this document does NOT close

Separation of duties exists for CODE: security supplies the fixture, a dev supplies the
change. **There is nothing equivalent for CLAIMS.** Measured across the two agents who
wrote this document, on the evening they wrote it:

| Surface | Mechanism pointed at it | Errors |
|---|---|---|
| Code (files) | separation of duties | **1** |
| Claims (reports) | none | **6** |

The one file error was a live silent block in `pre-push`. The six report errors were a
wrong line number, a "class closed" verdict published from an unvalidated scanner, a
coverage count that described its author's own selection, a repro pointed at a
nonexistent path, a scanner certified "landable" on a happy-path-only matrix, and a
claim that the guard could land independently when it could not.

**That is not a story about carelessness. Both authors were verifying continuously the
entire time.** It is a measurement of where the process is aimed and where it is not.
The provenance form above is the first mechanism aimed at the claims surface, and it is
one evening old.

### Why the claims surface is structurally hard, not merely under-attended

**A brief is the one artifact whose readers cannot check it against a source, because
for them it IS the source.**

Every wrong claim killed tonight was killable because a file existed behind it: an exact
path, the classifier's `case` arms, two blob hashes. A summary has nothing behind it.
That makes it simultaneously the most consequential surface and the one where the method
used throughout this document stops working. Reading the source instead of the claim is
not available to a reader for whom the claim is all there is.

The partial mitigation, and it is only partial: **make the brief cite the artifact it was
derived from**, so a reader who wants the source can reach it. That is the provenance
form applied to prose rather than to a repro. It does not make the brief correct. It
restores the option of checking, which a summary otherwise removes.

#### The precondition that mitigation has, discovered within the hour of proposing it

**The cited artifact has to OUTLIVE THE BRIEF.** Citing is not enough. The cited thing
must be reachable by the reader, later, from somewhere other than the author's disk.

**This document failed that test on the night it was written.** It was cited to the
operator and to the-orchestrator while sitting UNTRACKED (`git status` = `??`). Not
gitignored, `playbooks/` is trackable, but uncommitted and present on one machine only.
For a reader on that machine the path resolves today. It does not survive a clean
checkout and reaches nobody off that box. **A citation that silently reverts to
uncheckable is exactly the state the citation was introduced to fix**, which is the same
defect as evidence that is not real until committed.

The naive repair ("one commit") was also wrong, and checking rather than assuming is
what showed it: the author was standing on **another agent's feature branch** with 13
unrelated modified files in the working tree, so a commit there would fold this document
into an in-flight PR belonging to someone else. The correct repair is one commit **on the
right branch**, which is a different question from whether to commit at all.

Note the shape: both authors reasoned about the ARTIFACT and neither checked the CONTEXT
IT SAT IN. That is the third instance in one evening, after an extension-selected corpus
and a hand-typed repro path. Here the unchecked context was a git branch.

Measured, once someone finally looked: 18 dirty files across four owners (13 modified, 5
untracked), and the branch is **101 commits ahead of `main` and 86 commits behind it**.
The second number was not in either author's reasoning and is the stronger argument: the
document would have landed on a branch that is itself 86 commits stale.

### A fourth failure mode, distinct from the other two

The agent who proposed "one commit" had **measured that exact branch earlier the same
day** (the divergence, the conflicts, the dirty-file census by owner), written it up, and
sent it onward. Two hours later they reasoned as though they had not.

That is not ignorance and not inattention. Ranked by distance from simply not knowing:

| Mode | What went wrong |
|---|---|
| Available-not-operative | A rule that was known and not reached for. |
| Present-but-uninterpreted | Data produced and read, whose significance was not drawn. |
| **Recorded-but-not-recalled** | **A conclusion already reached, written down, and sent, that was not retrieved at the moment it applied.** |

Each is one step further from ignorance and closer to what actually happens to people who
are paying attention. All three occurred in this one evening, to both authors.

**Corollary for authors who cannot fix it:** work under gitignored `orgs/` at `0600` is
structurally uncitable to anyone who is not that agent on that disk. The honest form is
not a path but *"ask me and I will paste it."* **A stated unavailability is checkable; a
path that fails for the reader looks like a citation and functions as a dead end.**

## The evening in its smallest form

The last two measurements either author made, in the last exchange of the night, after
every rule above had been written down:

| Measurement | What was reported | What was omitted |
|---|---|---|
| Branch divergence | `101 commits diverged` (AHEAD) | 86 commits BEHIND |
| Working tree | `13 modified` | 5 untracked |

**Neither number was wrong. Both were one-sided, and both were incomplete in the
direction that made the situation look simpler than it was.** The behind-count was the
stronger argument against committing there; the untracked count was two thirds of a
disagreement about whether the census said 13 or 18.

Neither author stated which denominator they were using. This is the same defect as
every instance in the table at the top of this document, reduced to its minimum size: a
count that silently describes a subset, presented as if it described the whole.

## Validity of this document's own conclusions

**These rules were produced under conditions an ordinary working day does not have:**
three attentive agents, sub-minute round-trips, and each reading the other's SOURCE
rather than their CLAIM. A rule validated only under those conditions may be
unaffordable under normal ones, and an unaffordable rule is not followed, it is
performed.

The test is whether each rule survives the ORDINARY case: **one reader, hours of
latency, and a colleague who reads your claim rather than your file.**

**Prediction, recorded 2026-07-28 by claude-dev-agent so that it can be shown wrong:**

- The **observability** rules SURVIVE, because they work on a single reader with no peer
  at all: affirmative token, name-the-universe, provenance, disclosure-is-not-coverage.
- The **second-reader** conclusions DO NOT survive, because their whole mechanism was the
  peer.

**Falsifier:** if someone checks in roughly a month (late August 2026) and finds the
reverse, this section did its job and the rules above should be re-rated. A rule whose
only evidence is the night it was invented is a scanner tested only on the input it was
written for.

## Open

- Instance 4 fix (shebang-or-extension selection) for a dev agent, in daylight.
- `pre-push` still cannot land: its gitleaks config lives under gitignored `orgs/`, so a
  fresh clone blocks every push.
