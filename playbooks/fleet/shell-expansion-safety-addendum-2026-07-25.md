# Addendum: shell-expansion-safety incident, post-checkpoint (2026-07-25)

Continuation log for `playbooks/fleet/shell-expansion-safety.md` and the send-guard
rewrite. The main spec was checkpointed once codex-dev-agent's Fix A work and
Adam's cherry-pick decision became the next milestones (agreed with the-orchestrator,
2026-07-25). Anything found after that point lands here, dated, rather than as
further insertions into the spec itself, so the spec stays readable and the
incident log stays separate. Not yet reconciled against every named source agent —
same status as the main file before its own reconciliation pass.

**Synthesis pass (below) added once the material stabilised into a small set of
durable rules and a long tail of how they were found. The detail sections that
follow are kept in full — the rules are what needs to survive, the provenance
is what makes them checkable — but a reader in a hurry only needs this section.**

---

## Synthesis: the durable rules from this addendum

> **What actually worked tonight, corrected a second time — the first
> correction ("cross-reading, never self-checking") was itself too strong,
> and three agents independently bounded it back the same direction
> (the-orchestrator, correcting itself last).** Self-checking has real,
> load-bearing counterexamples: meta-compliance-agent's implausibility check
> (242-protected against one hour of adoption) is inherently a *self*-check,
> because it compares a number against **your own history**, which is
> exactly the knowledge an outside reader doesn't have. No reader could have
> caught that 242, or the-orchestrator's own impossible zero, or cro-agent's
> wrong-path zeros, or the-analyst's 197-of-219 — **every detector-aimed-at-
> nothing tonight was caught by its own author noticing an impossible
> output, and not one was caught by a reader**, because a reader sees the
> number, not the corpus it came from. Stating "self-checking never catches
> anything" would cost the file its only defence against the failure mode
> that hit four different agents and produced clean-looking output every
> time.
>
> **The corrected, decidable split (the-ad-strategist): two different
> question types, with two different cures.**
> - **Measurement / attribution — right answer, wrong entity** (a
>   glob-vs-`os.walk` gap, an unlabelled grep, a wrong denominator, an
>   impossible zero) **is self-catchable**, by re-running with better
>   instrumentation.
> - **Classification / intent — the question itself was wrong** (a wedge, a
>   dangling approval, a three-way phrasing that missed a case, a doctrine
>   claim, an undercounted class) **is only ever caught by another reader.**
>   "What re-measuring has never once done is tell me I was measuring the
>   wrong thing." Instrument your own measurements; route your intent past
>   someone else. Self-review feels adequate because it genuinely works on
>   the half you can see.
>
> **The most practically important refinement in the batch changes what
> should get built (cro-agent).** Its own two self-corrections tonight
> (reversing a kb-ingest classification; striking its own accidental-safety
> line) did *not* come from re-reading its own work — both came from
> **applying someone else's newly-supplied rule** to it (security-agent's
> send-vs-world test; the-orchestrator's accidental-safety retraction). **So
> the mechanism was never cross-reading itself — it was an external rule
> meeting your own work.** This matters because cross-reading doesn't scale
> (it cost eleven corrections and a full night of five agents on one defect
> class), while **a published, decidable rule propagates to everyone's own
> work at zero marginal cost.** That is the argument for treating
> security-agent's send-vs-world test as a load-bearing artifact rather than
> one defect among many: **it does the reader's job when no reader is
> available.** It closes the loop with the filter below and explains *why*
> that filter is the right selector: a rule you can apply wrongly gives a
> self-applier a false clean; a genuinely decidable one doesn't need the
> second reader at all. That is the whole product of tonight in one
> sentence, and it belongs to the fleet, not to any one author.

> **The single filter that separated everything that worked tonight from
> everything that didn't (the-ad-strategist, endorsed by the-orchestrator as
> the best line of the night, placed here rather than beside any one defect):
> a rule you can apply wrongly while believing you applied it correctly is
> not yet a rule.** The three-way follow-on phrasing, the enumerated scans,
> "`&&`-chain the follow-on," the stable-prefix ask — all applicable while
> wrong, each shipped once by someone confident it was right. The
> send-vs-world decidable test, the strict positive match, the planted
> positive, the command-shape anchor, `reply_to` as one seamless operation —
> none of them are. **Select for this property specifically — it is a better
> filter than severity or elegance**, and it is the property every rule
> below was re-derived against before landing here.

**Architecture (the actual fix decision).**
1. Validate `reply_to` in `src/cli/bus.ts`'s `send-message` action, not in the
   hook — every symptom this incident produced traces to one root cause
   (reconstructing argv from a command string the shell hasn't processed yet),
   and the CLI layer runs after the shell, deleting the class instead of
   narrowing it. Keep the hook's matcher-anywhere fix and operator bail, which
   protect what only a pre-execution hook can catch.
2. The ack-after-send hazard's actual fix is **reply with `reply_to`**, not
   `&&`-chaining — `reply_to` is one operation with no seam for divergence;
   `&&` is two operations a piped call can still silently decouple. Use a bare
   `ack-inbox` only when not replying.
3. Log the rejection through a channel-independent path (the activity feed),
   not just an exit code — a CLI rejection's stderr/exit code is exactly the
   channel this incident proved gets routinely discarded (piped, or simply
   not checked).
4. Follow the hard-fail precedent (`console.error` + `process.exit(1)`) with an
   explicit comment naming it — this codebase holds a second, silently
   different look-alike convention (warn-and-continue) nearby, and a new check
   has even odds of inheriting the wrong one and silently no-op'ing.

**Three prerequisites, all ahead of the bundled deploy, not follow-ups:**
5. **Corrected upward a second time, and the correction reveals every scan
   run tonight was structurally blind to half the tree: 16 destructive-after-
   send sites, not 8, seven of them shipping in `community/` (not four)**
   (meta-compliance-agent, method finding reproduced independently). **Cause:
   Python's `glob('**/*.md')` does not traverse dot-directories** —
   `os.walk` on the same root found 167 files against glob's 83, and every
   one of the 84 missed files sat inside a dot-directory, which is where
   `.claude/skills/` lives — **the half of the tree containing every agent's
   executable procedures.** So every hand scan and grep run tonight was a
   floor, not a count, on this axis specifically. The one class both methods
   agreed on exactly (notify-then-hard-restart, 8 sites, 4 in `community/`)
   is the control that proves it: none of those 8 happen to sit in a
   dot-directory, which is why glob and `os.walk` agreed there and diverged
   everywhere else. **Narrowed, and the narrowing itself matters (measured
   against `templates/`): the blindness is specific to Python's `glob`, not
   to scanning as a category.** `find -name '*.md'` (167), `os.walk` (167),
   and `grep -rl` (165, the 2-file gap being an ordinary matchable-pattern
   difference, not a dot-directory effect) all traverse dot-directories
   correctly. **So "every count tonight is a floor" over-corrects — only
   `glob`-based scans are floors; re-run only those, not every scan built
   tonight.** (The over-correction risk this narrowing heads off — agents
   re-doing sound work and distrusting correct results — is the same failure
   this incident already hit twice in the opposite direction.) **A same-agent,
   same-hour demonstration of this exact split is real, and was briefly
   misattributed then correctly restored: it is meta-compliance-agent's, not
   a composite, and it is narrower than first stated.** Its own agent
   directory contains `.claude/skills/m2c1-worker/SKILL.md`; `glob` over that
   directory returns 66 `.md` files against `os.walk`'s 91. In the same hour,
   it separately ran a `grep`-based check that *did* see into dot-directories
   — but **over its own agent directory, not over `templates/`, a different
   root from the fence-scan** — so "the same tree" overstates the original
   claim. Accurate form: **same agent, same hour, two tools, only one of
   which could see dot-directories, and nothing in either output indicated
   which corpus had been searched.** Narrower, and it still carries the
   lesson. **The direction of the earlier misattribution error matters more
   than the error itself (meta-compliance-agent's framing): a false claim
   gets refuted and dies; a *true* claim bound to the wrong entity also gets
   refuted and dies, just by people who can correctly disprove their own
   involvement.** Attaching a real finding to the wrong agent doesn't
   manufacture a phantom — it *kills a real finding*, which is the more
   expensive direction and a further instance of the same attachment error
   this addendum records elsewhere (item 27).
   Three self-tests (planted positive, implausibility check, non-empty-corpus
   check) all passed cleanly throughout on the real 83-vs-167 gap, because a
   83-file corpus looks exactly like a non-empty corpus to a test that only
   asks "is anything here" — none of the three test *reach*. **A fourth
   self-test is required, and it is narrower than "position a plant inside
   a dot-directory" — reach and location are two different failures, and a
   self-planted positive only catches the first.** A plant inside a
   dot-directory proves a tool reaches everything in the tree it's pointed
   at; it proves nothing if the tool is pointed at the wrong tree entirely,
   because the plant travels with the wrong path and is equally invisible —
   this is exactly how a separate tool's zero survived (pointed at
   `/default/state/processed`, which doesn't exist, instead of
   `/default/processed`). **What actually caught that: a positive control on
   a needle the operator independently knew was in the real corpus** (a
   message they had personally sent, which correctly returned a hit) —
   because that can only pass if the tool is pointed somewhere the known
   item genuinely is. **So the fourth self-test is reach-*and*-location,
   and it must use a known-present needle, not a self-authored plant — a
   plant you write yourself is satisfied by your own wrong assumptions; a
   needle you did not place is not.**
   A new, previously unreported class is also strictly worse than the
   restart case: **8 sites** (`templates/{agent,analyst,orchestrator,
   agent-codex,m2c1-worker}/.claude/skills/m2c1-worker/SKILL.md`,
   `community/skills/m2c1-worker/SKILL.md`, `community/agents/{security,
   research-agent}`) send a build-complete notification, then unconditionally
   `rm -rf` the worker's inbox and state directories and terminate the
   process. **If the send fails, the orchestrator never learns the build
   completed, and the worker's inbox, state, and process are destroyed
   anyway — unlike the restart case, where a memory file survives on disk
   and the agent comes back, here there is nothing left to reconstruct from
   and nothing left to notice**, since the build result existed only in a
   message that was never delivered. The follow-on (cleanup) is unambiguously
   mandatory (orphaned workers cannot be left running), so this is squarely
   the do-it-anyway-with-a-trace case, and per item 18's structural
   consequence, the trace **cannot be written in the same call as the
   cleanup — it is necessarily a two-call protocol.**
6. **RETRACTED as stated: the documented instruction is already correct, and
   "doctrine, not habit" inverts.** `templates/agent/AGENTS.md:406` (and its
   `CLAUDE.md`/orchestrator equivalents) already reads "always include `msg_id`
   as `reply_to` — this auto-ACKs the original... for no-reply messages use
   `ack-inbox`" — the exact instruction landed on this incident, already
   written, in the file every agent reads on boot. **A scan for *real*
   send-then-ack-on-separate-lines inside a fenced code block, corrected for
   the dot-directory blindness above, found 8 instances (not 2, and not the
   original 23) — six of the additional six sat in dot-directories the first
   scan couldn't see.** The high per-agent counts (629+) remain evidence of
   *not consulting a correct instruction*, not evidence the instruction is
   wrong — the highest-volume sender deviates most because it composes from
   memory rather than re-reading the header at that volume. **Remediation
   still changes accordingly: editing an already-correct file accomplishes
   nothing for the doctrine question** — the prerequisite is the 8 real
   fenced cases, the 16-site destructive class (item 5), the 8-site
   worker-cleanup class, and the community-catalog check; what closes the
   *rate* is reinforcement (the scan, repeating the prescription, per-agent
   counts), not a rewrite of an instruction that was already right.
7. The published `community/` catalog (git-tracked, 252 files) ships the armed
   pattern to installed bases outside the fleet with no channel back to this
   incident — this makes it a published-artifact release, not an internal
   fleet change. A backup directory (`workspace/skill-trim-backup-2026-06-07`)
   is a reinfection vector for the same reason: clean-looking and restorable.

**Mechanism corrections (measured, several superseding earlier live claims):**
8. `MSG_ID_RE` is a detection *gate*, not a validator — failing it returns
   null, which reads as absent and always allows. Tightening it *narrows*
   coverage; loosening it widens coverage. The existence check is the only
   deny path, and only for a well-formed id absent within the retention
   window. For the 115-instance malformed class specifically, coverage is
   effectively zero in practice.
9. The existence-check boundary is not a rotating retention window, it is
   **agent tenure** (oldest message ever received, since `processed` is never
   pruned) — so the *newest* agent has the *widest* silent-pass hole, exactly
   where a reconstructed-id defect is likeliest, with no signal at spawn.
   ("Diligent acking weakens the guard" was an earlier, false claim on this
   point — retracted; acking does not shrink the retained set.) **Signed off
   (codex-dev-agent's choice, checked rather than assumed): `older-than-
   retained` → DENY is correct and costs nothing, because `processed/` is
   confirmed unpruned (7,968 files verified, oldest from 2026-06-something
   still present) — any message an agent *actually received* resolves as
   `found`, so `older-than-retained` only fires for an id that was never in
   that inbox, which is not a legitimate reply by construction. This also
   disposes of the tenure inversion above without a separate fix: a new
   agent cannot legitimately reply to something predating its own history,
   so the widest-hole exposure closes with this one decision.
   `unresolvable` staying `allow` is separately correct — an unreadable
   inbox shouldn't halt sends.**
   **One unguarded assumption remains in this sign-off, a fifth instance of
   the same shape (the-ad-strategist): "`processed/` is unpruned" is not a
   guarantee, it is the current absence of a cleanup nobody has written yet**
   — measured at 22,633 files, ~90MB fleet-wide, roughly 140/day for the
   highest-volume agent, unbounded, with no prune or retention logic anywhere
   in the codebase. Someone will eventually add retention for disk reasons,
   and **partial cleanup, not full cleanup, is the dangerous state**: it
   doesn't trigger the empty-directory `unresolvable` escape, it just moves
   the boundary forward and starts silently denying legitimate replies to
   old-but-real threads. Nothing to change today — the DENY decision is
   right under present conditions — but the dependency should be recorded as
   a comment at the CLI check, so whoever adds cleanup in six months *finds*
   the dependency rather than discovering it. The only one of this incident's
   five inherited-boundary inversions caught *before* it could bite.**
10. A missing `inflight`/`processed` directory returns `unresolvable`, which
    allows — real in code, confirmed not live for any of 17 agents today
    (a spawn-time hazard, not a steady-state one).
11. The two independent fixes (guard + reconstruction-format fix) partition
    the defect population with zero overlap — the guard cannot structurally
    catch the largest (reconstruction) class, and no relabelling prevents the
    smallest (invention) class. Neither looks adequate shipped alone; the
    guard's coverage is the inverse of a human reviewer's.

**Process rules that generalise beyond this incident:**
12. A revert is also a deployment and needs the same verification as the
    thing it undoes.
13. A command that *stages* (`git checkout <ref> -- <path>`, `rm`, `mv`,
    `apply`) arms someone else's commit — commit with an explicit pathspec or
    check `git diff --cached --stat` first, don't rely on having only `add`ed
    your own files.
14. When changing a regex, read the non-match branch before the match branch
    — all the semantics of a gate live on the failure path, and a rule
    correct for a validator is often backwards for a gate.
15. A hand-assembled list is not a verification artifact — a shared,
    self-verifying script (proves itself against planted positives *and* a
    planted negative before it's trusted, aborts rather than reporting clean
    on an impossible null) is. Two independent hand-counts on this same
    incident under-counted by different mechanisms in the same hour.
16. Moving a control's enforcement point can flip fail-safe into fail-forward
    — this silently arms every *pre-existing* sequence written under the old
    (fail-safe) assumption, not just future ones; grepping instruction files
    catches the written half, not the unwritten habit half, which has no
    honest mitigation except each agent inspecting its own recent behavior.
17. A caught-defect count is not a random sample of the defect population —
    coverage is anti-correlated with how obvious the value is, so any "N
    caught" figure overstates coverage of the sloppy end of the distribution.
18. **The verification criterion for the template fix is not "scan to zero" —
    it is "every site classified."** The restart case proves a follow-on is
    not always safe to suppress: newline-separated, a failed notify still
    destroys the session with nobody told; `&&`-chained, a failed notify
    *blocks the restart entirely*, wedging the agent at full context, unable
    to act — trading the vanish class for a wedge class in the same release.
    The correct shape is a **third answer**, per site: assert the success
    signature; if absent, write a durable trace (memory line + log-event);
    *then do the mandatory follow-on anyway*. So every armed site resolves to
    one of three answers — **suppress the follow-on, do it anyway with a
    durable trace, or the send was never load-bearing** — and a scan can find
    every site but cannot pick the answer, because that's semantic and
    per-site. A residual non-zero count after the fix can be correct.
    **Refined further: classification is per-*follow-on*, not per-site — a
    single site can need both answers at once, and this breaks a
    fix already approved once tonight (cro-agent).** Converting the
    approval-notify sequence to `&&` throughout breaks it a different way:
    `create-approval` runs *before* the notify, so a failed notify with `&&`
    suppresses the task-block, the log, *and* the record that the approval
    exists at all — a dangling approval with no task state and no trace,
    worse than the block it was fixing. One site, three follow-ons, two
    different classes among them. **Decidable test (security-agent, the
    sharpest version): does the follow-on assert something about the *send*,
    or something about the *world*? Assertions about the send get suppressed;
    assertions about the world survive and gain a trace.** Same file, same
    night, opposite remedies: the approval-block assertion is about the send
    (suppress); the secret-rotation log asserts the rotation itself happened,
    a fact about the world independent of whether the notification landed
    (survive with a trace) — suppressing it would erase the only record
    letting anyone later reconstruct which agents are running dead
    credentials. **Structural consequence: `&&` can only ever suppress, and
    the guard rule requires the send to be last in its Bash call — so
    "do-it-anyway-with-a-trace" cannot be expressed as a one-liner at all; it
    is necessarily a two-call protocol.** Don't hunt for a clever single
    chained form; reaching for one is how the restart case gets wedged.
    **Second, independent reason the criterion cannot be "scan to zero"
    (the-ad-strategist): a correctly-fixed file scores *worse* than the
    broken original.** A corrected restart fix contains `&&`, the words
    "do NOT `&&` this one," and a hard-restart after a send — so any scan
    built tonight flags the *fixed* file more loudly than the defect it
    replaced. Site-count can rise after a correct fix; anyone verifying by
    count alone reads successful remediation as regression. Two independent
    reasons, either alone sounding like special pleading, together settling
    the point: the restart site must keep its follow-on, and a fixed file
    gains defect-shaped prose.
19. **Anchor "does this look like a command" positively — a third instance of
    the strict-positive-match rule, this time on the *successor* rather than
    the send or the id.** An enumerated successor-pattern scan missed
    hard-restart entirely (destruction is not a "write"); a naive positive
    scan over-counted by treating heredoc prose lines as successors. The fix
    for both is a single positive command-shape assertion
    (`^\s*(cortextos|cat|echo|python3|git|jq|for|if|printf)\s`), not
    heredoc-parsing — measured to change the result by one case out of 685,
    i.e. the "heredoc problem" was actually a "we never asserted the
    successor looked like a command" problem, the same shape as `--reply-to`
    failing an id-shape assertion. A number revised downward on this basis,
    and trusted only because the direction of the predicted bias matched the
    revision, is a stronger number than the original.
20. **Corrected: a low count is not automatically "accidental," and calling
    it that can itself understate a real, working control.** A prior version
    of this rule called research-agent's high atomic-reply rate accidental —
    wrong: it follows `AGENTS.md:406` (read at boot) exactly, which **is
    doctrine working as designed**, not luck. ad-strategist's case remains
    genuinely mixed on its own account (241 of 629 carry `reply_to`, but 81
    acks sit in 72 separate calls) and was explicitly withdrawn from the
    argument by ad-strategist itself rather than left to prop up a conclusion
    it only partly supports — **the two corrections point in opposite
    directions, which is exactly why neither agent's number should carry the
    argument; the-orchestrator's 636 carries it alone.**
21. **Converting to `reply_to` does not close every batch-ack pattern, and
    this is a real residual gap, not a solved problem.** `ack-inbox` called
    from a loop over ids *without ever inspecting each send's result*
    (batched-blind) stays unsafe after the conversion; only where each ack
    follows visual confirmation of its own send's success (verified-by-eye)
    is the pattern actually closed. `reply_to` will feel like completion —
    state this as its own instruction line, not an implied consequence.
22. **Fourth level of the enumeration family, the most subtle: distinguish a
    command from prose *about* a command, not just a command from prose.**
    A correct remediation instruction ("reply with `reply_to`; for no-reply
    messages use `ack-inbox`") *has* to name the deprecated form to tell the
    reader not to use it bare — so a scanner counting raw mentions scores a
    properly-fixed file as the *worst* offender, indistinguishable from the
    defect it just fixed. Same shape, same evening, as a bearer-sweep false
    positive on a file whose remediation correctly named an old tool to say
    "use the new one instead" — the fix there was **unguarded = mentions
    minus redirects**, not mentions alone; the general form is the same here.
23. **Three further findings, all cro-agent, all new and not superseded by
    anything above:**
    - **Output-suppressed sends defeat capture-and-assert by construction,
      and this is orthogonal to `&&`.** A send redirected to `/dev/null`
      leaves nothing to capture, so asserting a success signature is
      inoperable — and a redirect doesn't touch the exit code, so `&&`-chain
      compliance is *not* evidence the call is verifiable. Add to the
      prescribed form: never redirect a send's output.
    - **Where the successor is a RAG ingest, the false attestation becomes a
      poisoned input, not just a bookkeeping error.** A skill that completed
      a task, logged it, wrote memory, and kb-ingested a report — on a send
      that failed — makes the report retrievable evidence of a delivery that
      never happened, and the next read against that knowledge base builds on
      something nobody received. This is where the severity class changes.
    - **A third self-test the verification script needs, distinct from a
      planted positive and an implausibility check: assert the corpus itself
      is non-empty and a known-present needle is actually found.** A delivery
      check silently returned zeros because it pointed at the wrong path
      (`/default/processed` instead of `/default/state/processed`) — a
      matcher-only self-test passes cleanly while reading nothing. Three
      self-tests, three distinct failure modes: the plant proves the
      detector can fire; the implausibility check catches it firing on the
      wrong thing; **the corpus check proves it is reading anything at all.**
    - **Negative result, stated so nobody overclaims harm:** ground-truth
      delivery was checked for every traceable failed send against a
      7,951-file received corpus, and **all arrived**. No harm instance
      exists in this agent's history — state that plainly rather than
      implying damage has already occurred without a confirmed case.
24. **Closing lesson: a claim with a file-and-line attached reads as
    already-checked, which is precisely the property that stops people from
    checking it (the-ad-strategist).** This is how a false capstone claim
    propagated into three agents' notes across this incident. The fix, when
    caught, is to **strike the claim in place, not append a caveat beside
    it** — a caveat sitting under a starred claim gets skimmed the same way
    a caveat under a headline does (item 15's cousin). Verify the reasoning
    *and* the citation independently; a precise-looking reference is not
    evidence the reference was checked.
25. **A sequencing dependency between the two workstreams this incident
    produced, previously treated as independent (the-ad-strategist).** The
    prescribed remediation shape for capture-and-assert is `OUT=$(cortextos
    bus send-telegram ...)` — an assignment prefix, which is exactly the form
    `BUS_SEND_RE` does not match. **So every site being remediated tonight is
    being converted *into* the form the matcher-anywhere fix is designed to
    newly catch.** Harmless while the guard does no `reply_to` work at all;
    the moment the matcher-anywhere fix lands, every remediated site becomes
    newly inspected for the first time, each now containing a send inside a
    command substitution with a case statement and a trace write around it —
    a test population that didn't exist when the matcher's own corpus probe
    was written. **Ordering constraint, not a caveat: re-run that probe
    against the remediated forms specifically before landing the matcher
    fix, since the fleet is converting to a shape it has never been tested
    against.**
26. **Four closing operational findings.**
    - **The glob-vs-`os.walk` partition test (`wildcard-count + named-dot-dir
      -count == os.walk-count`) is weaker than first stated — it is
      scale-free and self-certifies on an empty corpus (research-agent,
      caught in its own "clean citation" minutes after offering it).**
      `A=0, B=0, walk=0` also satisfies `A+B==walk`, because all three counts
      are drawn from the *same* root — a wrong root moves all three together
      and the identity survives intact. **It proves reach, not that you are
      pointed at the right tree.** Fix: attach a **known-present needle the
      operator did not place** (e.g. a specific known file) — false at the
      wrong root, true at the right one — and cite the sum only together
      with that needle, never alone. **A related, worse sub-class it also
      found: multi-root search with one bad root.** `find` over two roots
      where one doesn't exist, with stderr suppressed for tidiness,
      contributes zero from the bad root, exits 0, and is **indistinguishable
      from "searched there and found nothing."** This isn't the wrong tree —
      it's one right root and one wrong one, where the wrong one reads
      exactly like an empty one. It defeats even the needle test unless the
      needle is specifically placed in the *suspect* root, or existence is
      asserted per-root rather than summed.
    - **The published-vs-live community drift is real, stronger than first
      measured, and the earlier path citation for it was wrong (research-
      agent, correcting itself a third time tonight): the correct path is
      `community/` at the repo root, not `orgs/community`.** With the path
      fixed, the actual gap is **17 published-only files plus 1 live-only
      file** (not one skill) — `community/agents/research-agent` carries the
      `m2c1-worker` sequence and this agent's own live tree does not; the
      converse also happens, in the opposite direction, elsewhere in the
      set. **A live agent directory cannot serve as the verification target
      for the published-community remediation, because the two have already
      drifted this broadly.** Checking "is research-agent clean" against its
      live directory would clear
      a file that still ships armed to the published catalog.
    - **The template-is-the-source claim rests on two confirmed unmodified
      descendants, not just a matching pattern — corrected down from an
      earlier over-count of three, which merged in a site that belongs to a
      different agent and a different claim (the-orchestrator, self-caught a
      third time on this specific miscount):** cro-agent's `AGENTS.md:75`
      matches `templates/agent/AGENTS.md:75`, and the-analyst's `AGENTS.md:70`
      matches `templates/analyst/AGENTS.md:70`, both line for line. (The
      `m2c1-worker` cleanup site is real and is meta-compliance-agent's, per
      item 5 — a genuine live worker-cleanup instance, but a *different*
      claim from identical-line-number descendants; the two should not be
      merged, and cro-agent does not carry that file.) Two independently
      confirmed descendants is sufficient for the propagation prerequisite
      with Adam and is the number to hand him — better to give two verified
      than three with one soft leg. Separately, cro-agent's own scan had two
      *independent* defects — traversal intact, enumeration broken — so **an
      agent can be clean on
      one axis and blind on the other; the record must say which defect each
      agent actually had, since the remedies differ.**
    - **The restart trace must be written to the memory file, and before the
      restart, not merely logged (cro-agent, the kb-ingest rule applied to a
      different reader).** A log-event alone records the failure where the
      restarted agent never looks; the memory file is what survives the
      session and is re-read on boot. General form: ask specifically where a
      trace has to live to be read by whoever encounters it next — for the
      restart class, that reader is the agent's own next session.

27. **A CC of a second-person message misroutes true, correctly-reasoned
    content to the wrong reader — the sixth costume of the same shape
    tonight, and the first where the wrong entity was a reader rather than a
    file (the-orchestrator, self-caught after two consecutive misroutes to
    the same recipient).** A broadcast loop (one fixed body, iterated over a
    recipient list) is correct for third-person content and wrong for
    anything addressed to one agent — the body reads "your defect," every CC
    recipient reads it as their own, and nothing in the message is false
    *except who it is about*. **Fix, at zero cost: a CC of a message
    addressed to one agent gets either reframed to third person, or an
    explicit header naming the actual addressee** ("CC — addressed to
    `<agent>`"). Not unique to this incident's author — worth checking by
    any agent whose broadcast tooling sends one body to many recipients.
    **What actually caught it: the wrongly-addressed recipient checked their
    own state (their own `AGENTS.md`'s date expressions, whether they owned
    the cited skill, whether they'd run the cited scan) and refused to file
    any of it under their own name, twice** — the same discipline as
    declining a credit or a confounded number, arriving from a third
    direction. Had it been absorbed, the addendum would have recorded a
    defect that doesn't exist, in a file that doesn't have it, attributed to
    an agent who didn't write it — and a filed record is exactly the thing
    nobody re-checks.
28. **A relational detector's clean result is perishable, and expires at the
    next edit to the files it scanned — so it belongs *in* a remediation
    loop, not as a one-time sweep before it (the-analyst).** A "zero" from
    comparing a write-target date expression against a boot-read expression
    is only valid as of the last edit to those files; a remediation shipped
    twenty minutes after such a sweep introduced a new write-target
    expression that didn't exist when the sweep ran, and had to be verified
    fresh rather than inheriting the earlier result. **This class is
    structurally created by the fix for a different class** — writing a
    durable trace (the do-it-anyway-with-a-trace answer, item 18) is
    precisely what creates a new write-target expression, so every one of
    the sixteen remaining destructive-class remediations is a fresh chance
    to introduce this exact mismatch. **Consequence: the relational date
    check is a gate on the destructive-class fix, not a one-time nicety —
    re-run it after each batch of trace-writing edits, not only before the
    first one.**
29. **Closing statement of the night's actual limit (research-agent, the
    cleanest version of it): naming a defect does not immunise the next
    measurement against it.** The same message that named a new sub-class
    (a nonexistent search root going silent) also built a provenance guess
    on exactly that failure — having just written the rule down and while
    already carrying its own output. Generalized (the-orchestrator, against
    itself): the enumeration trap was published and then walked into by
    enumerating; the citation warning was published and then a citation was
    invented; verify-before-stating was published and a broken extractor's
    count was reported anyway. **The rule has to be applied, not known** —
    which is why what survives this incident is the scan with its five
    self-tests and the decidable send-vs-world test, not any single
    broadcast, including the ones that got everything else right.
30. **A rule that would have saved work rather than found a defect (cro-
    agent): ask which direction a detector defect errs in, and re-audit
    only the conclusions that face that direction.** Every defect this
    incident found is one of two shapes. **Subtract-only** (a dead search
    root, an unreached dot-directory, glob blindness, an enumerated
    successor pattern) **cannot manufacture a find — every positive result
    from that detector is immune; only its zeros and completeness claims
    are at risk.** **Add-only** (proximity counting, prose lines misread as
    successors) **cannot manufacture a zero — every zero is immune; only its
    positive counts are at risk.** Tonight, every defect announcement
    triggered a full re-audit of everything, and most of that was
    unnecessary: a set of positive, non-completeness findings were never
    reachable by any of the four traversal defects, because all four were
    subtract-only. **This is a third, independent reason "classified, not
    zero" is the right verification criterion (items 18, 26): a zero is the
    single most defect-exposed result in a subtract-only regime.** It's also
    the principle behind requiring multiple self-tests rather than one —
    each fails in a different direction, which is why a list of them is not
    redundant accumulation but coverage of genuinely different failure
    modes.

**Status as of this synthesis, updated a second time (source-level fixes,
nothing built or deployed):** two remediations landed — `cc85d8c` (approval-
gate sequence, per-follow-on classified: send assertions suppressed, the
approval-exists fact preserved with the notification failure named in its
own log line; 13 files, 4 root `AGENTS.md`, 4 approval skills, 4
`autoresearch` blocks, tested) and `941f684` (ack-after-send, converted to
`reply_to`). **Three items remain with Adam: the 16-site destructive class,
the published-catalog fix, and the backup-directory delete-or-archive
decision** — alongside the CLI-move
design (items 1–4) and the cherry-pick decision. Nothing below this point is
superseded by the synthesis — it is the evidence and attribution the rules
above were drawn from.

**A third live instance of same-call coupling, on the agent reporting the
first two (research-agent).** Its own attempt to report a finding was denied
— not because of anything in the message body, but because a *memory heredoc
in the same Bash call* contained a backtick. **The denial was earned by a
part of the call that was not the message.** Third occurrence of this exact
shape (the-orchestrator's own harness denial; research-agent's 2026-07-24
denial; now this one) — the strongest available argument that the backtick
rule must be narrowed to the body-argument region specifically, rather than
applied to the whole raw command string, which is already the scope of
codex-dev-agent's pending fix.

---

## Verified working-tree state (the-orchestrator, method stated)

Checked with `git ls-files`, `git log`, and a marker diff against main's source —
not with `git status` alone:
- codex-dev-agent's Fix A work is **committed to its branch as `49c7261`** — it
  had existed only in the working tree before this, nowhere else.
- `src/hooks/hook-send-guard.ts` is restored to `main`'s version, so any build by
  any agent now produces `main`'s behaviour, not a half-reverted mix.
- `dist` is built from `main`, zero Fix A markers present, verified against four
  distinct marker strings rather than one.

**Why this needed doing at all:** an earlier revert had only reverted `dist`,
leaving a 385-line uncommitted rewrite sitting in the working tree — armed, in
the sense that the next build by any agent for any unrelated reason would have
re-shipped it. A broadcast rule ("do not build") was the only thing standing
between the fleet and a redeploy; a broadcast is not a control.

**codex-dev-agent, if reading this: your Fix A work was overwritten in the
working tree but is not lost — recover it with a checkout of `49c7261` for**
`src/hooks/hook-send-guard.ts` **and** `tests/unit/hooks/send-guard.test.ts`
**specifically. Do not rewrite from scratch** — the tokenizer, the strict shape
check, and the scoped option detector are all preserved there, along with
outstanding items noted in that commit's message. **After editing, commit** —
do not leave the guard modified-and-uncommitted again; that combination (revert
plus an uncommitted tree) is exactly what armed the redeploy risk above. Also:
work from `49c7261` specifically and state which revision you're on when
reporting — an earlier description of `BUS_SEND_RE` as an anchored regex was
aimed at `main`/`HEAD`'s matcher; a from-scratch tokenizer rewrite is a
different program, and a description of one was briefly applied to the other.

**The general rule this earns (security-agent): a revert is also a deployment,
and needs the same verification as the thing it undoes.** The first revert
produced a third state matching neither the feature branch nor `main`, and was
reported as "restored" before that was checked.

**A second general rule, same class as build-is-deploy, from a near-miss on this
incident's own record-keeping (the-orchestrator): a command that stages is a
command that arms someone else's commit.** `git checkout <ref> -- <path>` (used
above to unload the build gun), `git rm`, `git mv`, and `git apply` all *stage*,
not merely alter the working tree. So `git add` naming only your own files,
followed by a plain `git commit`, is not safe by itself — `git commit` with no
pathspec commits the *whole index*, including anything anyone else left staged.
This nearly caused sop-keeper to commit an unrelated hook-file revert alongside a
playbook-only change (the content was legitimate and needed no unwinding, but the
mechanism could just as easily have swept in something wrong). **Safe form: commit
with an explicit pathspec, or check `git diff --cached --stat` immediately before
committing** — either would have caught it.

---

## Candidate third trigger: body content (arrow sequences), not shell syntax

meta-compliance-agent withdrew its own earlier "intermittent" characterization —
correctly, on the grounds that "intermittent" makes a defect sound unreproducible
when it may be fully deterministic. Its replacement hypothesis, explicitly labeled
**a hypothesis with a confound it did not eliminate**, not a finding (calibrated
this way because it had already issued one confident wrong refutation earlier the
same night):

**The trigger may be body content, not shell syntax.** Every one of its denied
sends had an arrow in the body — e.g. "default -> 324 ads, with flag -> 339 ads" —
and every plain-bodied send delivered. Mechanism, if true: a `->` inside a quoted
body produces a token containing `>`, indistinguishable to a raw-text splitter
(one that never saw the quoting) from an actual redirect.

If correct, the blast radius is ordinary prose rather than unusual syntax — arrows
appear in most before/after comparisons, mappings, and much of this incident's own
spec. It would also explain the-orchestrator's split result without invoking
intermittency.

**Two required lines for the false-positive suite, either result informative:**
a body containing `->`, and a body containing a bare `>`. Both must **ALLOW**. If
they deny, the trigger is body content and "intermittent" was noise; if they
allow, something else drives the remaining split.

**Update: checked against the timestamp-boundary audit below and survives —
meta-compliance-agent ran the check on itself unprompted. All three live
observations fall at 16:39:43–16:40:19 UTC, before the 09:51:33 rebuild
boundary (times as reported by meta-compliance-agent), so the arrow-vs-plain
comparison tested one program throughout — a valid same-program pair, not a
cross-program artifact. codex-dev-agent is taking it as a fixture. The
originally-stated confound (a hypothesis, not yet a finding) still stands on
its own terms; only the *additional* timing risk is now cleared.**

## Fix ordering, restated and endorsed a second time

Fix the **position-zero (now: assignment/substitution) matching defect first**,
then the operator bail-to-allow. In the other order, bail-to-allow-on-operator
composes with the already-fails-open-on-substitution case into a guard that
inspects almost nothing. (the-analyst, endorsed independently by security-agent.)

## Testing does not require deploying — restated

`decideSendGuard` is an exported pure function over a command string, already
called from the test suite. Every shape in this incident is a unit test against
it directly, with no build and no deploy required. Do not run `npm run build`
(see the standing rule now in `standing-rules.md`).

## On the orchestrator's own measurement error: instrumentation, not reasoning

The orchestrator's probes were composed with the mandated heredoc-assignment
pattern, which the main spec's capstone finding shows is structurally invisible
to `BUS_SEND_RE`. So its probes evaded the guard, it observed ALLOW, and it
concluded the trigger was narrow while others — probing with bare, unwrapped
sends — were being denied by the same guard in the same minutes.

**Security-agent's framing, kept verbatim because it is sharper than a paraphrase:**
*"My measurement apparatus was inside the blind spot it was measuring... that is
not an error in reasoning, it is an error in instrumentation, and it is
undetectable from inside the instrument."*

What broke it: several agents reported measurements that contradicted the
coordinator, and kept reporting them after the coordinator had declared the
matter closed three times. Every one of the orchestrator's eleven wrong claims
across this incident was caught this way — the last four *after* an explicit
stand-down instruction. The operating lesson is not "be more careful next time";
it is that **independent measurement from parties with different setups, reported
even when it contradicts the coordinator, is what caught all eleven** — a property
of the process, not of any individual's diligence.

## The reconstruction-class format defect, located exactly

Source of the ~80-instance reconstruction class (cro-agent's hypothesis, now
confirmed at the line): `src/daemon/fast-checker.ts:392` (and the `send-telegram`
variant at line 456):

```
Reply using: cortextos bus send-message ${safeFrom} normal '<your reply>' ${msg.id}
```

Both trailing slots are lowercase, dash-containing tokens, and the agent name
comes first — exactly the shape that invites an agent reconstructing the command
from memory to fill the trailing slot with whichever token is already held.
**Proposed fix (not yet shipped):** make the two slots non-interchangeable —
label the trailing one explicitly, put the id on its own line as a labelled
value with "copy verbatim, do not retype." This is the only proposed fix that
reduces the defect *rate*; the guard (whenever it exists) only catches residue
after the fact.

**The irony worth keeping:** this fix lives in `src/daemon/`, so shipping it
requires a build and a daemon restart — i.e. it is itself a deployment, the exact
action banned earlier this same incident. cro-agent argued it deserved an owner
*tonight* since, with guard coverage at zero, it is the only mitigation that
exists at all — a correct argument that nonetheless doesn't survive contact with
the build-is-deploy rule. Resolution: bundle it into codex-dev-agent's Fix A
branch, unit-test both, ship in one announced, deliberate, watched deployment
rather than two separate ones — strictly better than doing either alone (one
build, one restart, one rollback point), and the two fixes cover different
halves of the same defect class (the guard catches invention/wrong-target
residue; the format fix reduces the reconstruction rate at the source).

## Behavioral coverage does not count as coverage — explicitly rejected

A tempting counter-argument was raised and explicitly rejected: that the fleet
now has *behavioral* coverage because the reconstruction-format rule and the
guard's failure modes are known. **It does not, and this must not be allowed to
count.** Five agents wrote defective detectors tonight while holding the exact
rule that would have caught the defect; the orchestrator failed a rule it had
itself published within the hour, twice; meta-compliance-agent's own detector
over-fired and then under-fired in the same evening. Knowing a rule does not
execute it — not a slogan, the single most repeatedly demonstrated finding of
the night. **Current coverage is zero, and stays written that way until
something mechanical ships**, not when the fleet has been told.

> **The condition above was MET on 2026-08-03 (the-sop-keeper).** "Something mechanical" shipped: Fix A landed (commits `f9170fe1` + `4039d794`, live in `dist`) and is unit-tested against `decideSendGuard` directly — 42 passing tests in `tests/unit/hooks/send-guard.test.ts`, including the `$(...)`-deny and quoted-heredoc-allow cases whose absence was the "coverage is zero" basis. This paragraph's incident-time claim stands as the record; the guard is no longer at zero coverage. Current guidance: `standing-rules.md` → "`hook-send-guard` is now a working backstop" and this addendum's parent file `shell-expansion-safety.md` § "The send-guard: Fix A landed + verified."

## Attribution correction: the bypass finding is structural, not incidental

Earlier framing credited the `$(...)`-bypass discovery as "one common practice
happens to evade the guard" (cro-agent's framing). **research-agent's version is
stronger and is the one to credit**: the mandated heredoc form puts an
assignment before the send *by construction*, so every compliant send was
*guaranteed* invisible — not merely one practice that happened to evade
detection. Only the structural version explains why every agent measuring ALLOW
was measuring real production sends rather than unlucky probes.

**The single sentence worth keeping from the whole incident, if only one could
be (cro-agent, endorsed by the-orchestrator):** *same guard, same minutes, one
variable — four agents measured DENY on bare probes, four measured ALLOW on real
sends. Nobody was wrong about what they saw, and nobody was right about what it
meant.*

## Two further lessons from Fix A implementation coordination (not the fix detail itself)

The back-and-forth over codex-dev-agent's split-detection-from-validation fix
(exact regression fixtures, ordering hazards, whether a legacy function is dead
code) is implementation coordination between the-orchestrator and codex-dev-agent
and isn't reproduced here — it belongs in the branch's own commit history and
PR discussion. Two pieces from that exchange are general enough to keep:

**When changing a regex, read the non-match branch before the match branch
(research-agent).** All the semantics of a gate live on the failure path — a
regex has no polarity of its own, the consumer supplies it. At a *gate*, a
non-match returns null, null reads as absent, and absent allows — so
*tightening* the pattern *widens* the hole, exactly backwards from a validator.
Three agents endorsed the same tightening instruction this incident, each
having spent the evening publishing the validation rule and applying it
reflexively to the first regex encountered. **cro-agent's form of the same
point: a rule you have been repeating is the one you will misapply.**

**The guard's real coverage split is counter-intuitive and worth stating
explicitly: it catches convincing fakes and waves through sloppy ones.**
A malformed value that *looks* like a real id (right length, plausible
characters) passes the loose gate, reaches the existence check, and is denied.
A malformed value that looks *obviously* wrong fails the gate itself and is
silently allowed. The 115-instance defect class does not split by which agent
produced it or when — it splits by whether the bad value happened to resemble
a good one.

## Architectural redirect: validate reply_to in the CLI, not the hook — this deletes the class rather than narrowing it

**Every defect tonight is a symptom of one root cause: reconstructing argv from a
command string the shell has not processed yet (the-ad-strategist).** Operator-in-
the-reply_to-slot, assignment-prefix evasion, the backtick-in-quoted-body false
positive, the arrow hypothesis, the whole-Bash-call abort — all of them are the
same single choice (parsing raw text in a `PreToolUse` hook) producing a new
symptom each time a prior one gets patched. **Validating in the hook narrows the
class; validating in the CLI deletes it.**

`src/cli/bus.ts`'s `send-message` action already reconciles both `reply_to` forms
(positional and `--reply-to`) into one variable *after* the shell has finished —
no tokenizing, no operand counting, no matcher to evade, no quote-awareness
problem, unreachable by assignment prefix or `$(...)` by construction — and
already has an idiomatic validate-and-exit for a sibling argument a few lines
below it. **Decision: move the `reply_to` shape and existence checks to the CLI**
(both can be called from the same site, which also has the paths and agent name
the existence lookup needs); keep the hook's matcher-anywhere fix and operator
bail, which protect the things only a pre-execution hook can catch. This makes
the hook's `reply_to` logic — including the legacy `extractTrailingReplyTo` —
deletable rather than repairable. **Tradeoff, stated rather than assumed:** a
hook denies before execution with a retry; a CLI check fails at runtime with a
non-zero exit and nothing sent. Judged equally actionable for an agent reading
exit codes and stderr — reliability beat earliness here, given the hook could
not reliably see the argument in the first place.

## RETRACTED: "diligent acking weakens the guard" — false, struck, do not carry it

An earlier version of this section claimed acking shrinks an agent's retained
message set and therefore widens the existence check's silent-pass window.
**research-agent caught this with data and the source settles it: it is false.**
The retained set is `inflight ∪ processed`, and ACKing *moves* a message from
`inflight` to `processed` — both are retained, so acking costs the guard
nothing. research-agent's own inbox is zero files, everything acked including
five by hand that morning, and `processed` still holds all 80 messages it has
ever received. The claim was inferred from a set of per-agent numbers without
reading what defined the set — the same error being corrected all night
(reasoning about which branch data would take instead of reading it) — and it
was wrong in the harmful direction: telling the fleet that a good habit
degrades a security boundary would have discouraged prompt acking for zero
benefit.

**The true mechanism (research-agent) is sharper than the retracted one: the
boundary is not a retention window at all, it is agent tenure.** Because
`processed` is never pruned, the boundary is `min(all retained timestamps)` —
the oldest message an agent has *ever* received, i.e. its spawn date:
research-agent (11 days tenure), meta-compliance-agent (46), the-ad-strategist
(50), the-orchestrator (56) — meta-compliance's earlier 47/50/53/56
measurements were correctly measured numbers, just mis-described as retention
policy rather than tenure. **The consequence is the inversion that actually
holds, and it is worse than the retracted one: the newest agent has the widest
hole, and a new agent is plausibly the *most* likely to reconstruct an id from
partial context, having the least familiarity with the convention — the hole
is widest exactly where the defect is likeliest, and every agent spawn mints a
maximally-exposed one with no signal that it happened.**

**A fourth branch not previously priced: if either `inflight` or `processed`
does not exist, the lookup returns `unresolvable`, which allows.** A freshly
spawned agent whose directories don't exist yet gets a total pass on every
`reply_to`. So `older-than-retained` and `unresolvable` are not a tidiness
question or even just an explicit-default question — they have a **tenure
dimension**, and the honest deploy-note line is that the current default
silently allows most of a brand-new agent's history, by construction, at the
moment it's most exposed.

## Two corrections that strengthen the CLI move rather than weaken it

**`reply_to` is the only one of the CLI's four `send-message` arguments that
reaches the send call unvalidated (the-analyst).** Priority and agent name are
each already validated with an exit before that point. So moving `reply_to`
validation to the CLI isn't "add a new kind of check" — it's the **missing
third instance of a pattern already used twice in the same function**; the
anomaly was its absence, not the proposal to add it. This also dissolves the
earlier tradeoff framing: whatever runtime-failure cost is already accepted for
a bad priority or a bad agent name is the same cost this adds, and nobody
argued those belong in a hook instead.

**The CLI check also closes the composition defect that started this incident,
which a hook-only fix does not (the-analyst).** With `--` in play, the parser
makes `--reply-to`'s value a positional, so the reconciled variable at the CLI
layer *is* the literal malformed string by the time it reaches this check — an
ordinary malformed value, caught the same way as any other. **One check closes
both the 115-instance class and the `--`-composition defect** that opened this
whole thread; the hook's separate option-shaped-token detector for this
specific case becomes unnecessary.

**A CLI failure's exit code is lost through a pipe (meta-compliance-agent,
measured, not assumed).** A bad-priority rejection piped through `tail` prints
the error text but the *pipeline's* exit code is 0 — nothing sent, and a
scripted caller checking `$?` sees success. This means the existing validate-
and-exit idiom already fails silently to any scripted check in the exact piped
form this incident standardized on. Fix is small: **print the failure on its
own last line with a stable prefix**, so a `tail -1` still surfaces it — and
don't rely on exit-code checks on a piped bus call. (Also checked and
discarded: the standard `PIPESTATUS`-array recovery doesn't help here, since
the fleet's shell is zsh, where the array name and indexing differ from bash —
a worse fix than repairing the output format.) meta-compliance-agent caught
this confound in its own measurement before reporting it rather than shipping
the raw datapoint — the same discipline that has held up each of its findings
tonight.

## Two cautions for reading any "N caught" number after this ships

**The caught set is not a random sample of the defect population (security-
agent).** Coverage is *anti-correlated* with how obvious the malformed value is
— convincing fakes get caught, sloppy ones get waved through — so any future
"we caught N" figure is biased toward the convincing end and will overstate
coverage of the sloppy classes. Don't read a catch-rate as a population
estimate.

**Allow-and-log at a near-zero deny rate means the log is the primary path, not
an escape hatch (cro-agent).** With denies near zero and logged-allows in the
tens of thousands, nobody will read the log by inspection — it needs a *rate*
(a daily count with an alert if it moves), not a review. State plainly that
post-fix the guard inspects the minority of sends and logs the majority.

**The strongest form of the bundling argument (cro-agent): the two defect
classes partition the population by shape with zero overlap.** Reconstruction
(~80 instances) produces obviously-wrong values that fail the gate and pass —
the guard structurally cannot catch this, the largest class, no matter how it's
tuned. Invention (~11 instances) produces plausible values the guard does catch,
and that no relabelling of the reply instruction could prevent. **Each fix
covers exactly the other's blind spot**, which is why neither looks adequate
shipped alone. **The redeeming corollary: the guard's coverage is the inverse of
a human reviewer's.** A person spots `reply_to: the-orchestrator` instantly and
would never notice one ending in `-unblock` — so the guard is worth more than
an 11-of-115 hit rate suggests, because it covers the blind spot of every other
control in the fleet, including a human reading the header.

## Moving an enforcement point changes which failure mode you get, not just where it lives

The CLI-not-hook redirect (above) was accepted, and three operational objections
landed against a naive version of it — general enough to keep, without the
line-numbers-and-fixtures implementation detail, which belongs in the branch:

**A hook's denial doesn't ride a channel the caller controls; a CLI rejection
does — and that channel is one this incident already proved gets discarded
(the-ad-strategist).** A hook denial returns through the tool result regardless
of redirection. A CLI rejection rides stderr and the exit code — the exact
channel this whole incident showed gets routinely thrown away. Moving the check
without also logging the rejection through a channel-independent path (e.g. the
activity feed) converts a wrong `reply_to` into a message that was never sent
and nobody knows it — a new silent failure on the same channel the incident is
about.

**Fail-safe becomes fail-forward, and that is a new hazard class, not a wash
(cro-agent).** The hook's whole-Bash-block abort was crude but fail-safe —
nothing downstream ran on a false premise. A CLI check is fail-forward: the
send fails and everything else in the same Bash call still executes. Any
sequence of the shape "send, then record having sent" (a common pattern —
notify, then mark done) now diverges: the send fails, the record-of-having-sent
still runs, and the record is now false.

**Corrected once more, and it simplifies rather than adds a caveat (cro-agent,
both branches verified): `&&` itself is sound — `false && echo ran` correctly
short-circuits. The pipe is the defect, not `&&`.** `false | tail -1 && echo ran`
runs the and-branch, because `tail`'s exit (0) is what `&&` sees, not the
send's — but this is entirely a property of piping, not of chaining. **The two
rules converge on one form, which is the useful part: the guard rule already
requires nothing after the send (drop the pipe), and once the pipe is gone the
exit code is the send's own and `&&` works correctly.** So: **unpiped send,
record `&&`-chained — one form, both problems closed**, not two separate
constraints to hold. (`pipefail` would also fix the piped form, but it is off
by default on zsh, this fleet's shell, so it isn't a fix to rely on.)
**The rejection log still stays primary, for a sharper reason than "shell
discipline might fail": it protects the agents who do not drop the pipe, which
is most of us today** (reading a returned `msg_id` via `2>&1 | tail -1` is the
common form). Caller discipline (unpiped + `&&`) closes the hole for the
compliant; the log closes it for everyone else. General form (the-ad-strategist): an exit
code is a channel the *caller* controls, and a pipe silently reassigns it —
the same shape as the separator defeated by a shell operator and the retention
boundary set by inbox tenure: **a mechanism doing load-bearing work it was
never designed for.**

**meta-compliance-agent's dominant pattern is the divergence inverted, and
worse (memory-first, not send-first).** It writes the durable record (a memory
append) *before* the send, on the line above rather than below — so the record
already asserts the thing happened, with nothing in the record showing whether
the send that follows actually succeeded. Its memory **is** the compliance
record of what it gated and escalated, so a false "flagged to Adam" is exactly
the failure its role exists to prevent.

**The consequence that makes this more than a caller-discipline note: this
change silently invalidates every *existing* newline-separated
send-then-record sequence already written into skills and memories, with
nobody editing them.** Those sequences were correct under a fail-safe hook and
become wrong the moment the check moves — a live landmine, not a style
preference going forward. **Every agent should grep its own instruction files
and memory conventions for a send followed by a state write**, rather than
treating this as a rule for newly-written sequences only. This is the
composition trap once more: two individually-correct things, one of which
changed underneath the other without notice.

**A codebase can hold two silently-different look-alike error conventions, and
a new check has even odds of inheriting the wrong one (security-agent).** Two
existing failure paths in the same function used the same surface-level pattern
(`console.error`) but different actual behavior — one exits non-zero, the other
warns and continues. A new check added near the softer-looking one, without
checking which precedent it's actually following, silently no-ops: it "detects"
correctly and then does nothing about it, which is worse than not existing at
all, because everyone believes the case is covered. **When adding a check near
existing error-handling code, verify which of several look-alike precedents you
are actually inheriting — don't assume the nearest one is representative.**
Separately: a "warn and continue" soft-fail on an unroutable message is a
failure with extra steps, not a partial success — this specific shape had
already reached a human by accident more than once before it was named.

## Hard blocker on the CLI move: the armed send-then-record sequence lives in the templates, not in individual agents' habits

research-agent found, and security-agent/the-ad-strategist confirmed in their
own files, that the exact fail-forward hazard described above is not a
per-agent habit to grep for — it is written into the shared bootstrap
templates themselves. `templates/agent`, `templates/orchestrator`,
`templates/analyst`, and `templates/agent-codex` all carry it (the-orchestrator
verified directly): notify, block the task, and log the block reason as
"awaiting approval" — three newline-separated `cortextos bus` calls. **Post-move,
if the notify fails: the task is marked blocked, the log asserts "awaiting
approval," and the human was never told — an approval that then waits forever
on someone who doesn't know it exists, with `blocked` reading as legitimately
parked rather than broken.** That is precisely the invisible-block class this
same night's earlier fleet-wide reconciliation existed to eliminate, re-created
by this fix in the mandatory gate in front of every external action.

**Consequence: seventeen agents grepping their own files is necessary but not
sufficient — fixing seventeen copies leaves the source that regenerates them,
so the next spawned agent arrives pre-armed with no signal.** The fix belongs
at the template; per-agent grepping only catches drift on top of it. **This
puts a hard prerequisite on the CLI move: the template fix ships before or
with it, not after** — shipping the CLI move first would convert the approval
gate into a silent-stall generator fleet-wide on deploy day. (Confirmed present
in `the-sop-keeper`'s own `AGENTS.md` too, at the same three-line shape, while
preparing this entry — this is not a hypothetical for this agent either.)

**The worst instance is a false attestation, not just a stalled task
(security-agent, its own skill file).** A secret-rotation workflow sends
"credential rotated" to the affected agent, then logs `secret_rotated`
regardless of whether the send succeeded. If the send fails, the durable event
log asserts an agent was told its credential rotated when it never was — a
false attestation in the one workflow where the record *is* the evidence, and
the agent keeps using a dead credential believing otherwise. **Framing for the
deploy note (security-agent): this fix does not introduce a new risk, it
revokes a guarantee existing correct code was implicitly relying on** — every
send-then-record pair in the fleet depended on the hook's whole-block abort,
without anyone knowing they depended on it, including the agent that owns the
lane most affected.

**Third instance tonight of the same shape (the-ad-strategist): a fail-forward
change is most dangerous exactly where conventions are most disciplined.** The
approval flow is newline-separated *because* it was written carefully as a
legible sequence; sloppy one-liners already using `&&` were already safe.
Careful, well-documented procedures are the exposed ones — the same shape as
the ellipsis class (correct copying, punished by display truncation) and the
wrapped-send bypass (correct compliance, punished by matcher position).

## The ack-after-send pattern is the worst instance in the fleet, and it is the standard reply shape

**the-orchestrator ran cro-agent's own detector-scan against itself and its
first attempt returned zero** — impossible, given hundreds of sends that
night; a detector failure (a broken extraction regex against re-serialized
JSON), not a result, caught only because **a null against a corpus known to
contain positives is itself a detector test** (cro-agent's rule, applied to
its author in real time, in the same message where it was demanding numbers
from everyone else). Fixed and re-run with an explicit planted positive printed
first. **Real numbers, 5,112 Bash calls scanned, 5,080 containing a bus send:**
2,130 send-then-state-write (cro's divergence shape); 241 write-then-send
(meta-compliance's worse variant, record asserts before the send runs); 394
`&&`-chained and protected; and **455 ack-the-original-after-sending-the-reply**
— the-orchestrator's own standard reply pattern, taught by the fleet's own
inbox instructions, both commands together.

**This ack case is elevated to first-class here (the-analyst's sub-case,
originally 10 instances in a smaller corpus) because it is worse than every
other divergence shape, not just another instance of it.** Post-move, if the
reply send fails, the ack still fires: the original is marked handled, the
reply never went, and **redelivery — the one mechanism that would have
surfaced the failure — is exactly what the ack destroys.** Contrast with the
115-value `reply_to` defect, where redelivery *was* the harm; here it is the
*recovery* mechanism, and this pattern deletes it. Memory divergence at least
leaves a false record for someone to later catch; **the ack case leaves
nothing anywhere — no message, no redelivery, no artifact — while the sender
believes the exchange is complete.** A silently dead thread with no trace is
the worst available outcome in this system, and it is reachable through the
fleet's own standard reply shape. **The deploy note must separate the ack
case from the record-keeping case explicitly** — they look identical and fail
differently, and the ack case is unrecoverable where the other is merely wrong.

**Consequence for the deployment prerequisites: this becomes a second
template-level blocker, alongside the send-then-record approval sequence
above.** The ack-after-send pattern is taught in the inbox reply instructions
themselves, to every agent including ones that don't exist yet — both
template-level fixes now sit ahead of the bundled deploy, not just the one.

**Why this shipped as a script rather than an instruction to introspect
(the-analyst, and the-orchestrator's own numbers prove it twice): introspection
finds the shapes you remember writing; a scan finds all of them.** The
orchestrator estimated its own exposure at "low dozens" before running the
scan; the actual number was 2,370 combined across the two divergence shapes.
security-agent's framing: "inspect your recent calls" produces a shrug, a
count produces a change.

## A better metric than tenure: blind days, and a negative result that narrows the missing-dirs branch

**the-analyst reframed the exposure metric and it is sharper than tenure alone
(bracketed the rebuild boundary by *predicting* it from two synthetic
timestamps two days either side, rather than reading it off counts — the first
claim in this incident derived that way).** The metric is **blind days**: fleet
message history opens 2026-05-30, so exposure = 55 minus an agent's tenure —
the span of *real* fleet ids that genuinely exist in other agents' corpora but
predate this agent's own history, which is exactly what a reconstructed id
from an older thread looks like. Fleet table: research-agent 44, vitalis 40,
the-production-house 39, the-axon-agent 37, **the-sop-keeper 36**; the-analyst,
the-orchestrator, and the-team-lead: 0.

**Negative result, reported because it killed the reporter's own hypothesis:**
auditing all seventeen agents found **zero** with a missing `inflight` or
`processed` directory — even an empty inbox still has the directory, which is
what the existence check actually tests. **So the "missing-dirs → unresolvable
→ allow" branch is real in code but not live for anyone today** — a spawn-time
and cleanup-time hazard, not a steady-state one. Still worth stating in the
deploy note for that reason, not as a live gap.

## Applying the night's central rule to delivery verification, not just id validation

**Superseding the earlier "print the failure on its own last line with a
stable prefix" recommendation (the-analyst): that is still enumerating failure
shapes, the exact trap that hid 115 defects from the first sweep of this
incident.** The strict-positive-match form, applied to delivery verification
instead of id shape: **capture the output, assert the success signature (a
13-digit-prefixed `msg_id`), and report a route-failure if it's absent** —
rather than trying to recognize every way a failure might print. Tested against
a deliberately failed send and correctly reported the failure. This form is
immune to a lost exit code and to zsh's differently-named `PIPESTATUS`, and
needs no stable prefix convention to work. The stable-prefix change stays as a
convenience, not the mechanism. Same fix, same underlying reason, a second
domain — and the person applying it here had reached for the enumerating
version by reflex barely an hour after publishing the rule against doing that.

## Third prerequisite: the armed pattern ships in the published community catalog, outside the fleet entirely

**the-analyst found, and the-orchestrator confirmed, that the send-then-record
hazard is not confined to this fleet's own templates — it is in `community/`,
git-tracked, 252 files, which ships through a published catalog to installs
that will never read a deploy note or be reachable by any notification this
fleet can send.** Concrete instances: `community/skills/evening-review/SKILL.md`,
`community/skills/morning-review/SKILL.md`, and
`community/agents/agentic-crm-assistant/TOOLS.md`. **This changes the character
of the deployment, not just its size:** a fleet-internal template fix and a
seventeen-agent grep cannot reach an installed base with no channel back to
this incident. **The prerequisite list is now three, not two, and this third
one requires a published-artifact fix landing in the same release, not a
follow-up** — taken to Adam as a blocker alongside the other two.

**Reinfection vector, quantified (the-orchestrator, checked in its own
directory): `orgs/.../the-orchestrator/workspace/skill-trim-backup-2026-06-07/`
holds 7 copies of the worker-cleanup sequence specifically — the
highest-severity family, where nothing survives a failed send — one each for
cro-agent, meta-ads-agent, meta-media-buyer-agent, security-agent,
the-ad-strategist, the-orchestrator, and the-team-lead.** (This is separate
from and additional to the earlier `workspace/skill-trim-backup-2026-06-07`
count of 60 files / 12 carrying the pattern.) These are June snapshots in the
orchestrator's own directory — a restore from there would silently re-arm an
agent with the class where nothing survives to reconstruct from. **This also
resolves an apparent contradiction: cro-agent has said three times it carries
no `m2c1-worker` skill, and it is correct about its live tree — there is
simply an old copy of it in this backup, a distinction the orchestrator had
been conflating.** Not deleted tonight — deletion is a permanent action not
to take unilaterally at speed after a long incident — the directory is
marked and goes to Adam alongside the other prerequisites as a
delete-or-archive decision, not a silent cleanup.

## The fix for the ack-after-send case: reply with reply_to, not && — and it is doctrine, not habit

**Measured, not asserted: `reply_to` closes 100% of this exposure, and it is
structurally stronger than any sequencing discipline (the-orchestrator, 636
send-plus-ack calls examined individually).** All 636 were addressable by
`reply_to` — 229 already carried one alongside a redundant separate `ack-inbox`
(acking what the send had already acked, pure waste); the remaining 407 had no
`reply_to` but could have. Zero needed a bare, no-reply ack. **The conversion
target is `reply_to`, not `&&`-chaining: `&&` still leaves two operations a
piped send can silently decouple, while `reply_to` leaves one operation with
no seam for divergence at all — the ack is inside the send, not sequenced
after it.** Two agents with near-zero exposure in this class (2 of 684; 50 of
68 atomic) turned out to owe it to accident, not virtue — the inbox header
simply hands them the positional form to copy — **and an accidental property
is not a control, because nothing preserves it if a future author doesn't
happen to copy the same header.** Final instruction, simpler than what is
currently taught, which is why it should survive future authors: **reply with
`reply_to`; use a bare `ack-inbox` only when not replying.**

**Capstone reframing (the-analyst): the unrecoverable class is doctrine, not
habit, which changes what "fixing the template" means.** A properly-run scan
found **38** armed sequences in templates and community, not the **8** an
earlier crude pass had found — that earlier count was a floor, off by 5x, and
must not stand anywhere it was cited. **23 of the 38 are ack-after-send,
present in `CLAUDE.md`/`AGENTS.md` of every base template and every published
community agent** (`agent`, `analyst`, `orchestrator`, `security`,
`research-agent`). So the-orchestrator's 636 and other agents' smaller counts
are not independently-acquired bad habits — **they are downstream of the
documented reply procedure, in the file every agent reads on boot.** This
means fixing the inbox reply instructions is not one of several template
fixes — **it is the fix**, and the published community copies ship the
unrecoverable variant specifically to installed bases nobody can notify.

**meta-compliance-agent reproduced the same "zero" independently, with the
opposite defect, within the hour.** The-orchestrator's zero came from an
extractor matching nothing; meta-compliance's zero came from matching *too
much* — it scored any call containing `&&` as protected, and its own standard
opener happens to be a `cd && command` form, so 242 of its own calls were
counted protected and its exposure subtracted to nil. **Opposite defects,
identical reassuring output, in the same agent-hour.** Its catch was not a
planted positive (its plants all passed) — it was that **242-protected was
implausible on its face**, having only adopted the chained form an hour
earlier. **A number that contradicts your own recent history is a detector
test, distinct from a planted positive: the plant proves a detector *can*
fire; the implausibility check catches it firing on the *wrong thing*.** Both
belong in any such script — concretely, print the protected count alongside
the exposed count, since a protected count exceeding your own adoption
history is the tell. Also worth carrying: **a low ack-after-send count may
reflect batching style rather than safety** (meta-compliance's own 2 comes
from acking in separate calls from its replies, not from being protected) —
don't read a low number as a safe agent.

**The verification artifact: `scripts/armed-sequence-scan.py` in the-analyst's
agent directory, with a copy at
`~/cortextos-deliverables/armed-sequence-scan/armed-sequence-scan.py`.**
**RETRACTED, both halves inverted (the-analyst, self-caught): the agent
`scripts/` path is the durable one, not the one that needed correcting.**
`orgs/**` is tracked in `~/.cortextos-agent-state-backup`, a real git repo
with an off-machine remote and a ~24h RPO; `cortextos-deliverables` is
*not* under that tree and has no backup at all. The original relocation
(prompted when meta-ads-agent couldn't reach the file to verify its own
commit) was made believing the reverse — reading "`orgs/` is gitignored" as
"`orgs/` is undurable," when **gitignored-in-the-working-repo and
not-version-controlled-anywhere are two different properties.** Nothing was
actually lost: the move was a `cp`, not an `mv`, so the original in the
backed-up tree survived throughout, and this file's earlier framing was a
defect in the advice, not in the state — which is exactly why it mattered
that a written record was carrying it forward. `--files`/`--transcripts`
modes, which **refuses to report until it proves
itself** — three planted
positives and one planted negative before any scan runs, exits 1 on any
detector-self-test failure, and aborts (rather than reporting clean) on an
impossible null — a corpus with Bash calls but zero detected sends errors
instead of passing. It verified its own abort path by deliberately breaking
its matcher first. **Neither the-orchestrator's nor meta-compliance's zero
would have survived this tool** — the whole argument for shipping a script
rather than an instruction to introspect. **The template fix is verified by
re-running this script to zero, not by any hand-assembled list — both
authors of such lists tonight under-counted, by different methods, on the
same question.**

## The verification artifact must be a re-runnable scan, not a hand-assembled list — proven by two more instrument failures

**the-orchestrator's own instrument failed in both directions on the same
question, mirroring the-analyst's identical problem within a minute.** An
enumerated scan for known "successor" shapes (state writes, acks) found ~2,371
armed calls; a positive-form re-run (any send with a non-`&&`-chained
follow-on, catching everything rather than named shapes) found 3,896 — but its
top "successors" turned out to be `echo`, "1.", "-", "The", "ONE": **prose
lines from inside heredoc bodies, indistinguishable from commands by a naive
line-split.** So the enumerated count under-reports and the positive count
over-reports, and neither is the population; the solid subset (97
`ack-inbox` and 77 `log-event` successors) is real, but the range around it is
not resolved. **The lesson (the-analyst, arriving independently within the
same minute): neither party should publish a hand-assembled list as complete —
publish a bounded range with the instrument's defect named, not the number
that sounds most alarming.** The verification going forward is a **shared,
re-runnable scan** (root path in, file:line out, across templates/agents/
community in one pass) — handed to sop-keeper and codex-dev-agent — so a fix
is verified by **re-running the scan to zero**, not by either party asserting
coverage. This also closes the drift problem meta-compliance-agent raised
separately: a per-agent copy can already differ from its template in other
ways, so "we fixed the template" is not automatically "every copy is fixed."

**The highest-severity instance was missed by the first enumerated grep
entirely, and it is the cleanest demonstration of why enumeration fails
(the-ad-strategist).** `AGENTS.md`'s context-exhaustion restart sequence —
notify the user, then hard-restart — was invisible to a scan built around
"state writes," because **a restart is not a state write, it is state
destruction**, a category no records-based enumeration could contain. It is
also the most severe instance found: the approval case strands a task in a
visibly-blocked state someone could eventually audit; this one destroys the
session, the notification, and the ability to retry all in the same instant —
a failed notify here cannot be retried, because there is no session left to
retry it. **Consequence: the fleet-wide grep must be the positive form (any
send with a non-`&&`-chained follow-on, agent judges each hit) — the dangerous
successor is whatever an agent happens to do next, which is not enumerable
from outside it.** An enumerated version run by all seventeen agents would
produce seventeen false all-clears.

**Status: three prerequisites now sit ahead of the bundled deploy — the
shared-template fix, the inbox ack-after-send instruction, and the
published-community-catalog fix — all taken to Adam as blockers, not
follow-ups.**

## Timestamp-boundary audit, requested by the-analyst, run before the checkpoint

the-analyst's method: any claim built by comparing two *live* sends is invalid
if the pair spans the `dist` rebuild boundary (09:51:33), because the two
observations tested different programs. It applied this to its own work first
and killed its own "a backtick disables the guard" claim (built on a 09:50:20
DENY vs a 09:55:44 ALLOW spanning the boundary) before that claim ever reached
this file from any direction.

**Run against this addendum, honestly scoped: I do not have direct access to
other agents' raw per-message timestamps, so this is a check of which claims
are *structurally* exposed to the confound, not an independent re-verification
of each one's exact times.** Findings:
- **Exposed, and flagged in place above:** meta-compliance-agent's arrow-in-body
  hypothesis, which compares several of its own live sends across time.
- **Not exposed — pure-function method, unaffected by the boundary by
  construction:** the 8-case `decideSendGuard` test against a named `dist`
  build, and the working-tree state verification (`git ls-files`/`git log`/
  marker diff).
- **Not exposed — historical log analysis, not a live A/B probe:** the full
  115-instance `reply_to` defect classification (drawn from stored past
  messages, not from probing tonight's live guard).
- **Not exposed — confirmed by source read, not by comparing two timestamps:**
  the assignment-prefix matcher gap, the detection-gate-vs-validator finding,
  and the agent-tenure retention mechanism.
Nothing else in this addendum was killed by this pass; the one flagged item
needs meta-compliance-agent's own re-check, the same way research-agent
re-checked its own claim.

## Status at close

The main spec (through commit `30814eb`) is cherry-picked onto `main` as
`0802ee1`. This addendum, including its own path correction to the
verification-artifact location, remains on `codex/guard-fix-a-send-guard` —
not yet merged.

**The honest fleet-wide status is "authored," not "fixed," and it is worth
stating plainly rather than letting individual commit messages imply
otherwise (the-analyst, the fourth instance of this shape found tonight).**
Every durability fix produced tonight — this incident's own spec and
addendum, meta-ads-agent's mirror-sync work, codex-dev-agent's guard
remediation, and the addendum's own path correction to the scan script —
landed on a feature branch, correctly, given the standing no-merge-without-
Adam rule. But "committed" reads as terminal, and none of these are on
`main` yet except the spec proper. **This is a collective state nobody
chose and it is only visible by counting the branches together** — no
single commit was wrong to hold, but the merge queue is now load-bearing
for roughly five separate corrections, and whoever resolves it needs to
know the incident file's own path fix is inside the same branch as the
guard work it documents. If that branch is ever abandoned rather than
merged, this addendum's own correction reverts with it — the exact failure
class the correction exists to prevent, one level up.

Two decisions remain with Adam: the cherry-pick of this addendum (and the
other branch-held corrections) onto `main`, and the bundled Fix-A-plus-
reconstruction-format deployment.

## A distinct quoting-failure axis: relayed text vs. composed code

Flagged by the-orchestrator as belonging in its own section, not folded into
the existing coverage, because it is a genuinely different case rather than
another instance of it. **Everything in this incident so far covers
expansion inside a *message body being relayed* — `$(...)`, backticks,
`${...}` in text an agent is passing along, where the heredoc-into-a-variable
safe form is the fix.** The specimen this section is named for is different
in kind: **an unbalanced-quote failure in a one-liner the author composed
themselves, carrying its own code as payload, with no message and no
untrusted input involved at all.** The heredoc rule doesn't address this
case because there's nothing being relayed — the quoting failure is in the
author's own command, not in content passing through it. Filed as its own
axis (**relayed text** vs. **composed code**) rather than merged into the
existing rules, since the safe forms for the two do not overlap.

Two findings from the same incident worth keeping independent of the shell
mechanism:

- **An unexplained artifact in a directory you authored is yours to explain
  before it is anyone's to disclaim (claude-dev-agent, on itself).** It saw
  the stray file in a `git status` output hours earlier, logged it in its own
  daily memory as an accidental redirect artifact, decided it wasn't its to
  delete — and never checked whether it might be its own, in a directory it
  wrote. One `stat` call would have closed the question four hours sooner.
  It had been actively cataloguing the not-my-lane reflex in other agents
  while committing it in the same night, in its own territory.
- **Four agents disclaiming ownership *with a stated reason* is what let the
  real owner be found in one round — silence would not have narrowed
  anything (the-orchestrator).** the-analyst ruled itself out by timestamp
  window, research-agent by content domain (explicitly bounding a log file as
  a rendered buffer rather than a command history, rather than just saying
  "not mine"), meta-compliance-agent by enumerating the specific field-sets
  it actually uses, security-agent by scope. A disclaimer with a reason
  narrows the search; an unexplained artifact sitting unclaimed for hours is
  what an absence of reasoned disclaimers looks like.
- **A stray artifact carrying newlines and quotes in its name is a hazard by
  construction, independent of what it contains (security-agent).** Such a
  name splits into multiple paths under a naive `for f in $(git status
  --porcelain)` loop — the artifact of this incident's own failure class was
  itself an instance of the class. The correct containment was cheap and
  needed no owner: no bare `git add .` until the file was claimed, which
  removed the only route to real harm without requiring a premature delete.
- **The armed-sequence scanner's clean-scan result does not cover this class
  at all, and nobody should read it as coverage (the-orchestrator, confirmed
  with the-analyst).** The scanner (see the earlier verification-artifact
  entry) is built for relayed-text shapes; a composed-code quoting failure
  like this specimen is invisible to it by design, not by gap. A clean run
  of that tool says nothing about this axis.
- **Broadcasting an unidentified artifact's searchable identifier before
  attribution is done contaminates the very search used to attribute it
  (the-orchestrator, self-caught, meta-media-buyer-agent's find).** Quoting
  the specimen's filename to the fleet put that string into eight agents'
  transcripts within 66 seconds; a subsequent grep for it returned seven
  suspects, all false positives — the act of searching (and of others
  re-quoting the report) manufactured the hits. **The fix: describe or hash
  an unidentified artifact rather than naming it verbatim when asking the
  fleet to search for it, or bound any search strictly to before the report
  was sent.** The identifying half (preserve the file so evidence isn't
  destroyed) and the broadcast half (name it so the fleet can help) are the
  same protective instinct pulling in opposite directions — one preserves
  evidence, the other dissolves it. **When a text corpus is contaminated
  this way, attribute from filesystem metadata instead — birth time, inode,
  sibling-file authorship — which cannot be retroactively polluted by
  discussing the artifact, unlike a transcript, which was.**

