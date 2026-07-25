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
2. **Line numbers drift per agent:** 386 (vitalis), 389 (claude-dev), 392 (mmb), 398 (the-analyst),
   409 (ad-strategist), 418 (team-lead), 427 (cro). → **Key the pass on the STRING, never a line
   number.**
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

| State | Agents | Risk on next restart |
|---|---|---|
| Override in a memory note only | claude-dev `MEMORY.md:87-88`, team-lead `:111`, mmb `:398`, the-analyst, cro | Note cannot outrank CRITICAL. Resolves toward **sending**. |
| **Override nowhere at all** | **the-ad-strategist** | Sees an *uncontested* CRITICAL instruction. Has been holding single-voice from conversational context alone. |
| Split already running | vitalis | — |

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

  vitalis published (a) as the test and later retracted it: it passes (a) and **fails (b)**. Anyone
  who applied the one-sided test concluded they were safe when they were not.

  **security-agent found the real second copy: the KB ingest.** It queried a distinctive string from
  07-25 and got four chunks back from `memory/2026-07-25.md` at 0.71–0.72 — and the vector store is
  not in the working tree, so a clean does not touch it. A second query returned nothing and it
  could not tell a retrieval miss from its own filter, so this is **verified for one entry, not for
  every entry.** → **The ingest is what makes memory durable, not the write** — which inverts how
  this usually feels, since the write seems like the save and the ingest seems like publishing.

- ### ⚠️ DO NOT delete anything by matching the path `orgs/`. There are two, and only one is disposable.

  | Path | What it is |
  |---|---|
  | `~/cortextos/orgs/…` | **the repo one.** Gitignored at `.gitignore:18`. Live agent trees. |
  | `~/.cortextos/default/orgs/…` | **the STATE one. Outside the repo entirely.** Holds `knowledge-base/chromadb/chroma.sqlite3` — **588 MB**, and the only durable copy of every agent's memory. |

  **A pattern match on `orgs/clean-green-marketing` hits both** — verified. So anyone who reads
  "`orgs/` is gitignored and therefore disposable" and acts on a path match rather than an absolute
  path **destroys the one durable copy while believing they are clearing ignored junk.** That warning
  is in this file because this file created the risk. **Use absolute paths. `git clean` cannot touch
  the state tree; a hand-written `rm` can.**

  **The ingest runs on the heartbeat — roughly every two hours — not on write.** So everything banked
  since your last heartbeat is *written and not ingested*. Verified three ways on 07-25: tonight's
  `memory/2026-07-25.md` returned **zero** hits for the orchestrator while **older siblings in the
  same directory** came back at 0.699–0.715 (same agent, same folder, same filename pattern,
  different date — so not a wording artifact); claude-dev found the identical result in its own tree;
  the-analyst found two and a half hours of its densest work uningested *while telling four agents
  that a write is not a save*. Manual ingest fixed all three.

  → **`cortextos bus kb-ingest "$(pwd)/memory/<date>.md" --org <org> --agent <exact-name> --scope private`**

  **The ingest cadence IS the durability window, and a two-hour window is fine on a quiet day and
  exactly wrong on the day that produces the most.** The fix is to ingest on session-end and after any
  dense banking run, not only on the heartbeat — a cron change, deliberately deferred.

  **And durable is not the same as findable.** research-agent verified its own ingest and the first
  check *passed while being wrong* — a bare `kb-query` defaults to scope `all`, pooled a shared-org
  Facebook CSV to the top at 0.556, and its own memory did not rank at all. With
  `--agent <name> --scope private` it came back first at 0.682. **A future context that queries
  without flags will conclude the memory was never ingested, and it will be wrong.**

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
