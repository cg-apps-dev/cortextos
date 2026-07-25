# SPEC: the bootstrap tells every agent to do the thing Adam asked us to stop

Status: **authored, not applied.** No file has been edited. Daylight, template-scope, one pass.
Raised 2026-07-25 by research-agent. Inventory contributed by ten agents, all read-only.

## The defect

`templates/agent/AGENTS.md` carries a line marked `**CRITICAL**` that instructs every agent to
proactively message Adam and never let him have the last word. It is in **4 of 4 templates and 16
live agents**. On 2026-07-25 Adam told the orchestrator: *"you're sending me too many messages...
it's too much for me to read."* **The fleet was following its bootstrap.** This is configured
behaviour, not a lapse, and every new agent inherits it.

## The line bundles two obligations. Only one is wrong.

> `**CRITICAL: When a Telegram message arrives, you MUST reply BEFORE doing any work.** The user is
> waiting. Acknowledge immediately, then execute. Never leave the user as the last person to have
> sent a message - always follow up when work is done, when something changes, or when you are
> waiting on something. The user should never have to ask "are you still there?"`

- **(a) REACTIVE** — reply when Adam messages *you*. **MUST SURVIVE.**
- **(b) PROACTIVE** — never leave him as last sender, always follow up. **This is the defect.**

**Killing (a) manufactures the exact failure we spent 2026-07-25 diagnosing.** On 07-23 Adam asked
three agents to confirm they were alive. All three answered — cro-agent in **23 seconds** — and a
routing bug discarded every reply. vitalis then apologised to him for "lag" that was the bug. If an
agent stops answering direct questions on the channel they arrive on, we reproduce that symptom
deliberately.

## Four things that will break a naive pass

1. **It is ONE PARAGRAPH of several sentences — not two paragraphs, and not one sentence.** Seven
   agents (and this spec's first two drafts) reported "one sentence, no clean seam." That is wrong.
   The stable structure, in order:

   | Clause | Class |
   |---|---|
   | `**CRITICAL: When a Telegram message arrives, you MUST reply BEFORE doing any work.**` … `The user is waiting.` … `Acknowledge immediately, then execute.` | reactive — **keep** |
   | `Never leave the user as the last person to have sent a message — always follow up when work is done, when something changes, or when you are waiting on something.` | **proactive — the defect, and independently removable** |
   | `The user should never have to ask "are you still there?"` | **residual licence — see below** |

   **Do not quote a sentence count.** This spec said "four"; the-ad-strategist counted five. Both were
   run honestly and the difference is the splitter — a naive `(?<=[.?"])\s+` merges the first two
   because a `**` sits between the period and the next capital. **The count is an artifact of the
   instrument; the structure is not.** Key any edit on the clause text.

   **There is no *paragraph* seam**, which is the real hazard: an editor expecting to delete a
   paragraph finds one block and takes the reactive half with it.

   **The trailing clause is the residue that "no clean seam" hid rather than caught.** *"The user
   should never have to ask are you still there"* reads as liveness (reactive) but also implies
   telling him before he wonders (proactive). **Remove the proactive sentence alone and this one still
   licenses initiating — and the edit will look complete.** Handle it explicitly.

   → **Specify replacement text. Do not specify a deletion.** That covers both hazards by
   construction.

   > **Read this row as a warning about the method, not just about the paragraph.** Seven agents
   > independently reported "one sentence, no clean seam." They were all wrong, and the *agreement*
   > is what made it feel settled — one of them wrote "read it precisely" in the same message and
   > then did not parse to the sentence. **Consensus across agents is not independent evidence when
   > everyone is reading the same text the same careless way.** What broke it was not an eighth
   > reader; it was one agent using a *different instrument* — splitting the string on sentence
   > boundaries instead of eyeballing it. When a claim is confirmed by many and checked by none,
   > the confirmations are one observation, not seven.
2. **Line numbers drift per agent:** **381 (the-orchestrator)**, 386 (vitalis, security), 389
   (claude-dev), 392 (mmb), 398 (the-analyst), 409 (ad-strategist), 418 (team-lead), 427 (cro).
   **Eight distinct values across nine agents**, and 381 was found only when the orchestrator finally
   checked its own file — after cataloguing sixteen others. → **Key the pass on the STRING, never a
   line number.**

   *The agent enforcing the single voice carries the instruction to violate it, marked CRITICAL, with
   its override in a memory note that cannot outrank it. The census was built by the one agent missing
   from it.*

   **And match CASE-INSENSITIVELY, or the pass silently skips every file and reports success.**
   The file text is sentence case — `Never leave the user`. Measured on `templates/agent/AGENTS.md`:

   ```
   grep -c  'NEVER LEAVE THE USER'   0     ← the orchestrator searched this
   grep -c  'never leave the user'   0     ← security-agent searched this
   grep -c  'Never leave the user'   1     ← the actual text
   grep -ci 'never leave the user'   1
   ```

   **Across the 16 live agents: 0 files match case-sensitively, 16 match with `-i`.** Three of us hit
   this on the *same string* — the orchestrator searched an ALL-CAPS rendering and published a
   fleet-wide "it does not exist," security-agent searched lowercase hours after that was documented
   and got the same clean zero. **Neither of us was careless; we each searched a rendering of the text
   rather than the text.** security-agent caught it only by running a *concept* search as a second
   instrument.
3. **Scheduled deliverables are not "initiated updates."** the-team-lead's Monday forward-look is
   Adam-facing, initiated, and deadline-bound. Routing it through the orchestrator is what broke it
   before: it landed two hours after Adam had already assigned the week and **adoption fell 0.91 →
   0.70.** the-analyst's daily digest has the same shape. → Carve-out: **scheduled deliverables with
   a deadline ship direct on their own clock; ad-hoc status and progress route through the
   orchestrator.**
4. **`MEMORY.md` is part of the edit set.** Overrides currently live as memory notes, and *a note is
   available, not operative* — it cannot outrank a line marked CRITICAL. Fix the bootstrap and leave
   the notes, and you get the inverse: **a stale note asserting the old behaviour against a
   corrected bootstrap.** the-analyst now holds it in two places; mmb at `MEMORY.md:398`; team-lead
   at `MEMORY.md:111`.

## Per-agent override ranking (the reason this is urgent, not cosmetic)

**Four states, not three.** The third one *looks* protected and is not.

| State | Agents | Risk on next restart |
|---|---|---|
| Override in a memory note only | **the-orchestrator `AGENTS.md:381`, override in `MEMORY.md` only — nothing in `AGENTS.md` or `GUARDRAILS.md`**, claude-dev `MEMORY.md:87-88`, team-lead `:111`, mmb `:398`, the-analyst, cro | Note cannot outrank CRITICAL. Resolves toward **sending**. |
| **Override nowhere at all** | **the-ad-strategist** | Sees an *uncontested* CRITICAL instruction. Has been holding single-voice from conversational context alone. |
| **Override in a lower-ranked FILE** | **security-agent** `SOUL.md:57` | *"Routine all-clear status can stay quiet"* permits silence but **never contradicts initiate-always**, and `SOUL.md` has no principled claim to outrank a CRITICAL line in `AGENTS.md`. **Closer to the uncontested case than the carve-out makes it look.** |
| Split already running | vitalis | — |

*(Incidental, security-agent's to clean: `SOUL.md:57` and `:63` are the same line duplicated.)*

**vitalis is the tested precedent.** Since 07-15: every direct Adam message answered immediately on
Telegram, **zero** unprompted messages, including deliberately skipping the boot ping on ~8 restarts
where the startup prompt told it to send one. Adam has kept using it continuously throughout. **The
split is not a proposal — it has been live and working on one agent for ten days.**

## Why this file exists instead of a broadcast

On 2026-07-25 the orchestrator sent a blocking constraint to codex-dev four times, escalating, and
reverted its work four times. What actually transmitted the constraint was **fourteen lines of
comment above an `it.skip`** in the file the work touched. A durable artifact at the site of the work
beat a high-priority message to the person doing it. The same night, the-axon-agent wrote its rules
into `AGENTS.md` rather than memory *because a broadcast does not survive a context reset and the
file does* — and the orchestrator relayed that fleet-wide and then tried to enforce a build
constraint by broadcast anyway.

**Put the reason inline in the replacement text.** Otherwise the next reader sees an unexplained
absence where a CRITICAL instruction used to be and restores it.

## There is no commit path for any file this spec touches

**`.gitignore:18` is `orgs/`.** Verified: **0 of 16** agent `AGENTS.md` files are tracked;
`git check-ignore` confirms each one. The same holds for `MEMORY.md`, `GUARDRAILS.md`, `IDENTITY.md`,
`SOUL.md`, `GOALS.md`, `HEARTBEAT.md` and `CLAUDE.md`, for every agent.

Consequences for this pass, all of which cut against the obvious plan:

- **"Commit it" does not apply.** Only `templates/` is tracked. Every live file this spec edits is
  untracked *and* ignored — which is exactly what `git clean -fdx` removes.
- **The pass will have no diff to review** on the files it is meant to fix. That is
  meta-compliance-agent's *divergent-and-better* problem with the only detection instrument absent:
  you cannot tell a locally-authored improvement from staleness by diffing, because there is nothing
  to diff against.
- **`git status` is structurally blind here.** `git status --porcelain -- <agent dir>` returns
  **empty** for an ignored path. Ignored files do not even appear as `??`. **Empty output means clean
  *or* invisible, and those are opposite states** — absence-of-output versus absence-of-hits, the
  same confusion that produced most of the 2026-07-25 errors, on the instrument the whole night was
  audited with. meta-media-buyer-agent read an empty status as "my edits are committed."
- Several agents banked incident rules into `MEMORY.md` on 07-25 believing that was durable.
  **The durability test has two halves and most of us checked one:**
  - **(a) is it in the bootstrap read chain?** → survives a context reset.
  - **(b) is it tracked by git, or KB-ingested?** → survives a `git clean`, a reclone, a reprovision.

  > **⚠️ CORRECTION — there is a THIRD durability path and this file got (b) wrong all evening.**
  > `~/.cortextos-agent-state-backup` **is itself a git repository** — 56 commits, an **off-machine
  > remote** (`git@github-backup:…/cg-cortextos-backup.git`), driven by a loaded
  > `com.cortextos.daily-backup` job, last snapshot `2026-07-25 02:00`. **`MEMORY.md` IS tracked
  > there.** So agent memory is *not* undurable — it is gitignored in the working repo and
  > version-controlled off-machine in the backup repo.
  >
  > **⚠️ AND THAT CORRECTION WAS ITSELF WRONG FOR THE FILE THAT MATTERS.** Five agents caught it
  > independently within minutes. **I checked `MEMORY.md` and generalised to "agent memory."** The
  > coverage splits **by file**, and the mechanism is a **per-agent `.gitignore`**:
  >
  > | | Backed up? | Mechanism |
  > |---|---|---|
  > | `MEMORY.md` | **yes** | tracked; snapshot lags — mine is 243,385 B against 394,068 B live, **38% missing**; mmb measured 45% |
  > | `memory/YYYY-MM-DD.md` | **NO — for 15 of 16 agents** | each agent's `.gitignore` contains `memory/`. **Permanent absence, not an RPO — there is no snapshot at any age.** |
  > | `chroma.sqlite3` (the KB) | **no** | never listed; a 1.3 GB binary, so the exclusion is probably correct |
  >
  > **the-analyst is the only agent with dailies backed up (52 files) — and the only one whose
  > `.gitignore` is `local/` alone rather than including `memory/`.** So mmb's hypothesis that this is
  > a one-line per-agent config difference is confirmed and located.
  >
  > **And the reason it looks fine is the part to internalise.** The snapshot job *copies* the file, so
  > the backup working tree contains it — a directory listing shows the filename and tells you nothing:
  >
  > ```
  > backup tree:  2026-07-25.md    2,348 B   Jul 25 00:53
  > live file:    2026-07-25.md  150,762 B   tonight
  > git check-ignore -v  →  .../the-orchestrator/.gitignore:3:memory/
  > tracked dailies: 0        commits ever touching that dir: 0
  > ```
  >
  > **A copy exists, on the same machine, ignored, uncommitted, and never in a single commit — so it
  > has never left the machine at any point in the repo's 56-commit history.** The exclusion is
  > authored *per agent*, so checking the backup's root ignore rules will not reveal it. **"A backup
  > exists" and "my file is in it" are different claims: the second needs `git ls-files`, not
  > `git log` and not `ls`.**
  >
  > **The directional cost (cro-agent):** the daily file holds the **working**; `MEMORY.md` holds the
  > **conclusions**. So acting on the reassuring model **loses the reasoning and keeps the summaries** —
  > the worse half, since a conclusion without its derivation is precisely what could not be re-checked
  > all night.
  >
  > **And the shape, which is why this entry exists twice:** I tested one artifact and concluded about
  > "agent memory." Query narrower than the conclusion — **and the first instance of it inside a
  > correction.** cro-agent's statement is the one to keep: **a correction is not self-verifying because
  > it is a correction.**
  >
  > **So the ingests were NOT inflated for daily memory** — for that file the KB genuinely was the only
  > second copy, which is the original framing, not the corrected one. **Anyone who now skips an ingest
  > because "the backup has it" will be wrong about the file holding the most.**
  >
  > **But the KB is the LESS durable store**, not the more: it is on-machine only, while `MEMORY.md`
  > already has an off-machine remote. So the advice pointed at the weaker artifact. The resolution is
  > cro-agent's, from earlier the same night: **the durable thing is the GENERATOR, not the OUTPUT.**
  > Losing the KB costs a re-ingest; the ingest buys **findability and a second local copy, not
  > off-machine survival.** → **Anything that must survive belongs in `MEMORY.md`, the only
  > off-machine-backed artifact. Daily memory and the KB are both working copies.**
  >
  > **And the symmetric failure is the one the premise-direction rule misses.** the-ad-strategist had
  > published that a pattern `rm` "removes the one recovery path" — also unverified, also wrong, in the
  > *alarming* direction, an hour after I published an unverified reassuring one. **An alarming
  > unchecked claim is exactly as unchecked as a reassuring one; it just feels responsible rather than
  > complacent.** Re-check both directions.
  >
  > **This was already filed and answered.** `task_1784986775766_38837229`, opened **06:45 PT the same
  > morning**, states exactly this — and it is itself a self-correction to an earlier task that had
  > claimed the pessimistic version. The orchestrator then spent the evening deriving the pessimistic
  > version independently, published it fleet-wide, and had fourteen agents run ingests on it. **The
  > answer was in the task queue the whole time and nobody read it.** That is the night's own defect
  > in its most expensive form: not a wrong measurement, but a *correct* one already sitting in a
  > queue nobody treats as a source.
  >
  > **But ask it PER-PATH, not per-category — the backup covers exactly one top-level tree.**
  > `git ls-files` in the backup repo returns **`orgs/` and nothing else.** So the same question gives
  > opposite answers depending on the path, and both were checked:
  >
  > | Path | In backup? | Verdict |
  > |---|---|---|
  > | `orgs/**` incl. every `MEMORY.md` | **yes, tracked** | durable, ~24h RPO |
  > | `~/cortextos-deliverables/**` | **no** — not under `orgs/`, not its own repo, not in the framework repo | **gap is real** |
  >
  > So the provenance tool — the fleet's only post-build check — genuinely had **no** durable copy, and
  > the KB ingest of it was load-bearing rather than belt-and-braces. **The alarm was inflated for
  > memory and correct for the tool**, and nothing but checking each path separately distinguishes
  > them. A category-level answer ("is agent state backed up?") is wrong for one of these two no matter
  > which way you answer it.

  vitalis published (a) as the test and later retracted it: it passes (a) and **fails (b)**. Anyone
  who applied the one-sided test concluded they were safe when they were not.

  **security-agent found the real second copy: the KB ingest.** It queried a distinctive string from
  07-25 and got four chunks back from `memory/2026-07-25.md` at 0.71–0.72 — and the vector store is
  not in the working tree, so a clean does not touch it. A second query returned nothing and it
  could not tell a retrieval miss from its own filter, so this is **verified for one entry, not for
  every entry.** → **The ingest is what makes memory durable, not the write** — which inverts how
  this usually feels, since the write seems like the save and the ingest seems like publishing.

- ### ⚠️ DO NOT delete anything by matching the path `orgs/`. There are FOUR, and only one is disposable.

  Measured with `find "$HOME" -maxdepth 5 -type d -path "*orgs/clean-green-marketing"`:

  | Path | What it is | `git clean` reaches it? |
  |---|---|---|
  | `~/cortextos/orgs/…` | the repo one. Gitignored at `.gitignore:18`. | **yes — the only one** |
  | `~/.cortextos/default/orgs/clean-green-marketing/knowledge-base/chromadb/chroma.sqlite3` | **the live vector store.** The only durable copy of every agent's memory. | no |
  | `~/.cortextos-agent-state-backup/orgs/…` | **a state backup** | no |
  | `~/cortextos-worktrees/*/orgs/…` | **a worktree** | no |

  **A pattern-driven `rm` hits all four — and takes the live store *and* its backup in one command,**
  removing the recovery path that would have survived losing either alone. Three of the four are
  outside the repo, so only a hand-written `rm` can reach them. **Use absolute paths. Never a
  pattern.**

  **This entry has been wrong twice, which is the point.** The first version said "orgs/ is
  gitignored" with no path — acted on by pattern that is a deletion instruction aimed at the thing it
  meant to protect. The second version gave `~/.cortextos/default/orgs/knowledge-base/chromadb`,
  **which does not exist**: the store is one level deeper, *under the org*. So anyone copying that
  path to protect it would have protected nothing, while their pattern still matched the real one.
  the-analyst caught it with `find` rather than inference. **Do not use the size to recognise the
  directory either** — 590 MB is the `.sqlite3` file, 1.3 GB is the containing directory; both are
  correct measurements of different things.

  **The ingest runs on the heartbeat — roughly every two hours — not on write.** So everything banked
  since your last heartbeat is *written and not ingested*. Verified three ways on 07-25: tonight's
  `memory/2026-07-25.md` returned **zero** hits for the orchestrator while **older siblings in the
  same directory** came back at 0.699–0.715 (same agent, same folder, same filename pattern,
  different date — so not a wording artifact); claude-dev found the identical result in its own tree;
  the-analyst found **58 minutes** of its densest work uningested — heartbeat cron fired 17:47:51Z,
  manual re-ingest 18:45:58Z — *while telling four agents that a write is not a save*. Manual ingest
  fixed all three.

  *(This figure was wrong twice. It reached the file first as "two and a half hours" — felt, never
  measured — then as "78 minutes," which came with arithmetic and looked measured but wasn't: the
  check hardcoded epoch `1785000471` under a hand-written comment reading `17:47:51Z`, and that
  constant is **17:27**. **The label and the value disagreed by twenty minutes and the label was
  read** — committed inside the correction of a felt-time error, using a value that was quoted
  verbatim in the cron message already in context. **A duration needs two timestamps read at the time
  or quoted from the artifact — never one read value and one remembered constant.**)*

  **And do not go looking for a broken clock.** Every time signal was accurate — the continuation
  notice said 19:14:51.981Z and `date` returned 19:15:23Z a moment later; the cron message carried
  17:47:51.750Z correctly. **What is missing is not accuracy but PERSISTENCE: there is no ambient
  clock, so after an hour of work the last time signal is far up-context and an agent either polls or
  estimates.** Both instances here — this one, and the orchestrator deferring an item as "past
  midnight" at 11am — are **absence-of-signal, not wrong-signal, and those have opposite remedies.**
  Wrong-signal means fix the reporter; absence means poll before quoting a time or a duration.
  Filing them as a bad clock would send the next person at the wrong component.

  → **`cortextos bus kb-ingest "$(pwd)/memory/<date>.md" --org <org> --agent <exact-name> --scope private`**

  **The ingest cadence IS the durability window, and a two-hour window is fine on a quiet day and
  exactly wrong on the day that produces the most.** The fix is to ingest on session-end and after any
  dense banking run, not only on the heartbeat — a cron change, deliberately deferred.

  **Ingest `MEMORY.md` too, not just the daily file.** The daily file is narrative; **the standing
  rules are in `MEMORY.md`.** vitalis: 13 of its 17 chunks came from `MEMORY.md`. The orchestrator's
  `MEMORY.md` is 394 KB against a 151 KB daily. **A command naming only `memory/<date>.md` durably
  preserves the diary and leaves the rulebook in the single ignored copy** — the inverse of the point.

  ### Verifying an ingest: three ways to pass while being wrong

  1. **Bare query pools the shared scope.** research-agent's own memory did not rank at all; a
     shared-org Facebook CSV took the top at 0.556. the-ad-strategist reproduced it at 0.587. **Note
     the failure direction — not a null, but somebody else's document with a plausible score.** A null
     is obvious; a wrong-but-scored hit is not. → Always `--agent <exact-name> --scope private`.
     *Not universal:* claude-dev's bare query returned its own file ten times. **Corpus luck, not a
     property of the method** — use the flags regardless, but do not read a clean bare result as
     evidence the hazard is gone.
  2. **Results are not evidence. Semantic retrieval always returns its nearest neighbours and the
     default threshold is 0.5.** research-agent queried `zzq unicorn tractor mango protocol seventeen`
     — a string it has never written — and got 0.522 / 0.520 from its own file. Reproduced here:
     that nonsense probe returns **0.538 / 0.529 / 0.528 / 0.525 / 0.524**. → **Verify by SCORE
     SEPARATION against a measured floor, not by presence of results.** Run the nonsense probe first
     to establish your own floor, then require the real probe to clear it visibly. This collection:
     floor ~0.53, real content 0.691–0.745, so **a margin of ~0.16–0.21 is what a true hit looks
     like.** A single hit at 0.52 means nothing; an unmeasured floor means the whole check means
     nothing.
  3. **Presence is not currency, and this is the worst state.** claude-dev's ingest printed
     `Deleted 1 stale chunk(s)` before adding 136 — the file **was already in the KB**, as one chunk
     from a heartbeat when it was a few lines long, and none of the subsequent 148 KB was indexed.
     **"Is this file in the KB" answers YES while 99% of the content is absent**, so every presence
     check passes. → Test whether the **current** content is retrievable, not whether the filename
     appears. This also sharpens the cadence point: the two-hour window does not merely delay
     indexing, it **freezes a file at its size as of the last heartbeat.**

  **And a retrieval null is evidence about the QUERY, not about the store.** meta-compliance generated
  three consecutive nulls and nearly reported its ingest had landed in the wrong scope; re-running the
  exact original string returned 0.762 as before. It had changed the string *and* the flags together,
  so it could not separate the effects — and said so rather than claiming anything.

- **Storage consequence for this pass, independent of the availability-versus-operative argument:**
  playbooks are tracked and reviewable; `MEMORY.md` is neither. **A rule written into a playbook is in
  git. The same rule written into memory is in no diff and no history.** That is a second reason the
  daylight fix must land in files.

**This is probably correct as configured, not a bug.** `orgs/` holds `.env` files with
`sk-ant-oat01` setup-tokens, sheet IDs and customer data; ignoring it wholesale is the fail-closed
default and un-ignoring it would stage secrets. **The finding is the mismatch between that rule and
the durability advice being given, not the rule.** Do not edit `.gitignore` to solve this — that is
Adam's call and it is the token-exposure control.

**Known divergences with no diff to warn anyone** (meta-media-buyer-agent, its own files):
`templates/agent/AGENTS.md` carries neither its context-exhaustion trace-order rule nor its
`Reply using:`-is-not-authoritative + validate-`from` block. A naive sync overwrites both silently.

## The working tree is shared. Commits collide.

On 2026-07-25, `e5df978` was authored by the-team-lead naming **three** explicit paths and committed
**four** — `shell-expansion-safety-addendum-2026-07-25.md` was already staged by the-sop-keeper and
went in mid-air. Both reported it independently. Nothing was lost; the content is complete and
attributed to a commit its author did not choose.

- **`git add` is a mutation onto a pre-existing index you did not read.** Naming explicit paths
  bounds *your contribution*, not *the commit*.
- The skipped check is one line: **`git diff --cached --name-only` BEFORE committing**, not after.
- Multiple agents commit to the same branch in the same working tree concurrently. **Use a dedicated
  worktree** for anything non-trivial.

## Put the control where the RESOURCE is, not where the WORKFLOW is

*Generalised by the-team-lead from two independent instances the same night, in different domains.*

| Control | Mounted on | New path that bypasses it |
|---|---|---|
| `sendMessageTargetAgentExists` | the `send-message` **CLI command** (`cli/bus.ts:393`) | every caller of the **library** `sendMessage` — `create-task` auto-notify, `switch-agent-account`, `notify-agent` |
| meta-compliance asset scan | meta-ads' **intake workflow** | a static pushed straight to ready-to-be-posted fires **nothing** |

In both cases the control is **real, correct, and complete for the path it was built on** — and a new
path around that workflow **silently loses it, without erroring, because the control was never a
property of the thing being protected.**

**So the fix has the same shape both times: move it to the chokepoint everything must cross.** For the
guard that turned out to be `src/bus/message.ts:59-60`, beside the `validateAgentName` calls already
sitting there. For the scan, the analogous chokepoint is the sheet — or the transition into
ready-to-be-posted — not the workflow that currently happens to invoke it.

> **PUT THE CONTROL WHERE THE RESOURCE IS, NOT WHERE THE WORKFLOW IS — because workflows multiply and
> resources do not.** Every new path is a new way to miss a workflow-mounted control, and you cannot
> enumerate future paths.

**And it predicts where to look next rather than only explaining these two.** There are **two failure
modes with one symptom** — a control that exists and does nothing — and **each needs its own tell,
because a control can pass one check while failing the other:**

| Mode | Tell | Question |
|---|---|---|
| **NEVER REACHED** | you describe the control as **"a step"** — you can only say where it runs by naming a process | *Where is it mounted?* |
| **REACHED THEN IGNORED** | the call's result is **not assigned, checked, or awaited** — fire-and-forget, an empty callback, a discarded exit code | ***What reads the answer?*** |

**The crash hook is the second mode and the first tell is blind to it.** Its guard *was* reached; the
rejection was discarded by `() => {}`. **A control can be perfectly mounted on the resource and still
be decorative if nothing consumes its verdict** — so ask both: *where is it mounted*, and *who reads
it*. If nothing reads the answer, it does not matter where the control sits.

Third arrival of the enumerate-every-caller problem in one night.

### The general form: an artifact placed relative to the AUTHOR's context, not the CONSUMER's

Control placement is one instance of a wider shape, and the same night produced three:

| Artifact | Placed relative to | Fails for |
|---|---|---|
| a **control** | the workflow that invokes it | any new path to the resource |
| a **reference** | the author's context, which can see both files | a reader standing on a different ref |
| a **filesystem path** handed to a peer | the author's own agent directory | anyone whose tree differs |

The dangling cross-reference in this very file was the second row: a pointer added from a context
that could see both files, **resolving for the author and dangling for anyone on `main`.**

> **Place the artifact where the person who needs it will actually be standing.**

**And a pointer that resolves to a file which exists but lacks the content is worse than a 404,
because nothing signals failure.** The file opens, looks plausible, and **the reader concludes the
claim was never made rather than that the link is wrong** — reader-repaired corruption arriving in the
reference layer. (See `reader-repaired-corruption.md`, which is also where the tells above are
derived.)

*(Both tells are also written up in `playbooks/fleet/reader-repaired-corruption.md` by the-team-lead,
who derived them. Two copies of one rule is the drift hazard this file documents — consolidating them
is a daylight decision, not a reason to delete either.)*

## Scope is 24 files, not 20. The four that get missed are the published ones.

Measured case-insensitively across all three trees:

| Tree | Files | Tracked? |
|---|---|---|
| `templates/` | 4 | yes |
| **`community/agents/{agent,analyst,orchestrator,research-agent}/AGENTS.md`** | **4** | **yes** |
| live agents under `orgs/` | 16 | **no — ignored** |
| | **24** | |

**`community/` is the published catalog.** Fix 20 and the pass reports complete while **every agent
installed from the catalog after that inherits the instruction — and there is no channel back to the
installed base.** That absence of a recall path is the property that made the destructive
`notify`-then-`hard-restart` class worth blocking a deploy over, and four of those eight sites were in
`community/` too.

**It is the one surface that is only ever read by someone who is not here** — neither a live agent
anyone inhabits nor a template anyone edits daily.

**Exactly 4 of the 5 tracked `community/` files carry it.** The fifth,
`community/agents/agentic-crm-assistant/AGENTS.md`, is a **different lineage — not a fourth rendering
hiding from the grep.** Verified against every clause: `never leave the user`, `must reply`,
`user is waiting`, `acknowledge immediately`, `still there` — **all zero.** It never inherited the
paragraph. **So the pass should see 5 tracked files, make 4 edits, and not hunt a fifth.** (Worth
checking rather than assuming, because "absent" was wrong twice on this exact string.)

### The intuition is inverted: the published quarter is the ONLY quarter with a reviewable diff

`community/` and `templates/` are tracked. **The 16 live files under `orgs/` get no commit and no
history.** So **the largest share of the work is the least verifiable, and the smallest share is the
only part anyone can review afterwards** — and `community/` is simultaneously the part most likely to
be skipped as "not a real agent."

**The two halves therefore need different acceptance evidence:**
- `templates/` + `community/` (8 files) → **the diff.**
- the 16 live files → **there is no diff.** The only available evidence is a re-run of the
  case-insensitive grep against the intended file list.

That is what makes the acceptance test below **mandatory rather than tidy: for three quarters of the
files it is the only evidence that exists.**

### Every grep in this file is an instruction to someone on a different engine

**8 of the 13 fleet playbooks on `main` embed `grep` steps, and they are not portable.** Measured: the
pattern `resolvePaths(agent` matches as a **literal** on one engine (exit 0) and is wrapped into
`(?:resolvePaths(agent)` — an unclosed group — on another, printing `0 matches for X` and exiting 2.
**Same pattern, two outcomes. A verification step written here passes for some agents and is
unmeasured for others, and the author cannot know which reader gets which.**

So any step in this file whose output is a **negative** must carry its own check, beside it, not in a
broadcast:

> **Run it unpiped and echo `$?`.** `exit 0` = found · `exit 1` = genuinely absent · **`exit 2` =
> UNMEASURED, do not report it.** Unpiped is not optional: `$?` in a pipeline is the *last* command's,
> so `| head` or `| wc -l` silently substitutes the formatter's exit for the measurement's.

**But scope that honestly — it catches patterns that cannot RUN, not patterns aimed at nothing.**
security-agent tested it against its own ten instances before adopting it: **both its failed probes
returned `exit 1`**, because its patterns were syntactically valid and the strings really were absent
*in that form*. `exit 1` was the correct answer to the wrong question. **With an exit code attached it
would have looked rigorous while reinforcing the wrong conclusion** — which covers one of its ten, not nine.

**What covers the other nine is a positive control on the probe:**

> **Before believing an absence, prove your pattern can match something.** Grep for a string you know
> surrounds the target. If that also returns 1, the probe cannot reach the content and the absence is
> **unmeasured**, not false.

**And there is a third mode neither check catches — the one that generated this file.**

| Question | Control | Catches |
|---|---|---|
| Did it **RUN**? | exit code, unpiped | `exit 2` = invalid pattern |
| Did it **REACH**? | positive control on the same corpus and scope | unreachable corpus, wrong root |
| Was the **PATTERN RIGHT**? | **vary your own string** | **nothing above** |

Run against the search that started all of this — `NEVER LEAVE THE USER`, which returned zero and was
published fleet-wide as "the line does not exist":

```
1. RAN?      grep -q  'NEVER LEAVE THE USER'    exit 1   ← valid pattern, "genuinely absent". PASSES.
2. REACHED?  grep -q  'Telegram message arrives' exit 0   ← corpus reachable. PASSES.
3. PATTERN?  grep -qi 'NEVER LEAVE THE USER'    exit 0   ← THE ABSENCE WAS FALSE
             grep -q  'leave the user as the last'  exit 0
             grep -q  'last person to have sent'    exit 0
```

**Both existing checks certify a zero that is wrong.** The reason is structural: **a positive control
uses a *different* pattern, so it cannot test whether yours is wrong** — it confirms the corpus is
reachable, which was never in doubt.

> **Before trusting a negative on prose, re-run with a deliberately LOOSER form of your own string** —
> drop the case, drop a word, take the distinctive middle fragment. If the loose form is also zero,
> the absence is real. **Search case-insensitively by default on any prose claim.**

**The control has to vary the thing you are unsure about**, and on a prose search that is the pattern,
not the instrument and not the corpus. This is the check that would have caught a fleet-wide bootstrap
contradiction hours earlier instead of it becoming this document.

*(That distinction — ran / reached / right — has now appeared at five levels in one night: matcher,
corpus, root, pattern, and the search that was hunting the pattern.)*

### Acceptance test — and a zero is the WRONG criterion

After the pass, run `grep -ril "never leave the user" templates community orgs`.

**A non-zero count is correct.** The reactive clause survives by design (per the split above), so
matches are expected. **The completeness check is WHICH PATHS come back, not how many.** A pass that
reports zero has deleted something it should have kept.

This compounds with the case finding rather than sitting beside it: a **case-sensitive** pass over 20
files edits nothing and reports success; a **case-insensitive** pass over 20 files edits 20 and *also*
reports success — **and the second failure is harder to notice because it produced real diffs.**

## Sequencing

1. Template first — or it regenerates into every new agent.
2. Live files, keyed on the string.
3. `MEMORY.md` notes in the same pass.
4. `the-analyst`'s digest cron (`task_1785004001578_24403130`) — it currently says *"Send via
   Telegram to Adam"* while the agent has suppressed that daily for ten days.

## Attribution, when the text corpus is contaminated

Raised here because this pass will involve identifying who authored what across sixteen files.

Broadcasting an unidentified artifact's **searchable identifier** contaminates every log that
receives it. On 2026-07-25 the orchestrator quoted a filename to the fleet; **within 66 seconds the
string was in eight agents' transcripts**, and a naive `grep` now returns seven suspects, all false
positives. meta-media-buyer-agent first concluded the file was its own on hits that were *its own
grep commands* — **a search over a log that records searches is self-confirming.**

- **Describe, hash, or attribute first. Publish second.**
- If you must grep a contaminated corpus, **bound the query to strictly before your own first
  query.** the-analyst confirmed this is sufficient — two agents hit the same trap, the bound caught
  one and its absence missed the other.
- Prefer evidence the discussion cannot touch: filesystem metadata, neighbour authorship, content
  domain. **Not because metadata is incorruptible** — `touch -t` sets mtime, `cp` and cross-device
  `mv` reset birth time — **but because it is not corrupted by the act of discussing the file.**
- **Birth time tells you WHEN, not WHO.** Metadata alone implicates everyone active in the window,
  which is proximity-not-relation in a new costume. **Require convergence across at least two
  independent kinds of evidence.** claude-dev-agent's successful attribution had three legs: birth
  time in its active window, both sibling files its own work, and the captured content in its domain.
- **The asymmetry that must travel with all of the above:** convergent circumstantial evidence is a
  sound basis for claiming **your own** artifact — a false positive means you delete your own junk.
  It is **not** a sound basis for attributing one to **a peer**, where a false positive lands on
  someone else. Point it inward. Outward, ask.

## Related

The template-sync question now has three observed drift directions: **behind** (research-agent's
approval hardening), **divergent-in-form** (meta-compliance — which on inspection resolved to plain
*behind*, so do not go looking for divergence that is staleness), and this one, **uniformly wrong
everywhere including the template**. Whoever runs a sync cannot tell divergent-and-worse from
divergent-and-better by diffing; meta-compliance read its own local fix as current and it was the
defective one.
