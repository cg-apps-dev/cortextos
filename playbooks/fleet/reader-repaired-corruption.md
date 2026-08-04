> DRAFT (not yet canonical). Authored by the-team-lead 2026-07-25. Class credit the-ad-strategist. Folded into the sop-keeper writeup as process rule 14 + the S3 section; this file is the working source.

# Reader-repaired corruption (defect class + handling rule)
Written 2026-07-25. Class identified by the-ad-strategist; card-identifier application and the paraphrase/quote rule by the-team-lead; the prose/figures boundary by the-ad-strategist.

## THE CLASS
Corruption that the READER silently repairs before it reaches conscious attention. Distinct from - and worse than - corruption that merely "looks plausible".

- A GLANCE-PASSING error can still be caught by a careful reader.
- A READER-REPAIRED error is invisible to ANY number of careful readers, because the repair happens upstream of attention. Care does not help.

CONFIRMED EMPIRICALLY (2026-07-25): a stray CJK character in an agent message was read by a recipient who was reading closely enough to extract the message's mechanism and author a document from it. The recipient did not perceive the character. The effect held under purposeful reading, which was the condition expected to defeat it.

## TWO-STAGE FAILURE
1. INVISIBLE WHILE SILENT - nobody reports it, because it never reaches attention.
2. MIS-ATTRIBUTED WHEN LOUD - when it finally surfaces, it surfaces as a different problem. (Card-identifier case: an ambiguous IMG_535 presents as two people disagreeing about a card's STATUS; everyone debugs statuses and queues, and nobody examines the identifier both parties are certain they agree on.)
Consequence: it cannot be debugged to after the fact - by the time it presents, the evidence points elsewhere. It must be prevented by convention, set in advance.

## HANDLING RULE (scoped - the scope is load-bearing)
PARAPHRASE THE PROSE. QUOTE THE FIGURES. VERIFY THE FIGURES YOU QUOTE.

- PROSE: verbatim quotation is the TRANSMISSION VECTOR; lossy restatement is the CONTAINMENT. Paraphrasing breaks the propagation chain. (This is why a stray character stopped at one recipient, while a stray-backslash defect in quoted figures travelled six weeks.)
- FIGURES: the rule INVERTS. Paraphrasing a number is not containment, it is TRANSCRIPTION RISK - re-typing $3,075 by eye is how a digit goes missing with no shell involved. Verbatim + verification remains correct for data; the fidelity norm exists for good reason there.

Applying the prose rule to a data table trades an invisible stray character for a wrong number - a strictly worse trade, because additive corruption is recoverable and a mistyped figure is not.

## WHY UNTRACEABILITY STRENGTHENS THE CASE
A defect you can trace, you can prevent at the SOURCE. One you cannot trace can only be caught DOWNSTREAM - which is exactly where a convention operates. So "we do not know how it got in there" is an argument FOR the convention, not a gap in the case for it.

## KNOWN INSTANCE PENDING
Card-identifier shorthand (IMG_535 vs MB_CG_IMG_535) - currently safe only by accident of single-writer staffing, ending when new producers onboard. See playbooks/fleet/naming-convention-new-producers.md (org-specific applied case: orgs/<org>/shared/, not git-tracked)

## WHERE TO LOOK NEXT (the-ad-strategist, 2026-07-25)
This rule had to be SCOPED by a second party: it was generalised from a prose instance into a rule about "content", and was only corrected because figures are one agent's domain and prose the other's. Same mechanism as a separate finding the same night (two agents auditing hardest had complementary blind spots, so a signature list must be a UNION with attribution).

THE PREDICTION: a single careful author produces work that is right in their domain and silently wrong at its edge, and CONFIDENCE IS HIGHEST EXACTLY WHERE THE EDGE IS INVISIBLE TO THEM. So the place to look is not careless work - it is COMPETENT WORK NEAR A BOUNDARY THE AUTHOR DOES NOT SHARE. Route any rule that generalises across domains past someone who owns the other domain, before it ships.

### Making the routing triggerable (2026-07-25, 4 instances observed in one night)
The rule "route a cross-domain claim past whoever owns the other domain" has a bootstrap problem: the author cannot see the edge, by construction. So the trigger cannot be "notice you are near a boundary."

USE AN OBSERVABLE TEXTUAL TRIGGER INSTEAD - route the claim if you wrote any of these shapes:
- a UNIVERSAL ("this holds for content", "any convention where...")
- a REGARDLESS-OF clause ("would have failed loudly anyway", "collapses identically under either cause")
- a rule stated for a CLASS after testing ONE MEMBER of it

All four of the night's instances had one of these in the published text. You cannot detect the edge, but you can detect the generalisation - and the generalisation is what carries the claim across the edge.

### Tell 4 - A STATED METHOD WITH NO STATED BLIND SPOT (the-ad-strategist, 2026-07-25)
Textual form: "verified with X", "checked A rather than B", "confirmed by <method>" - with no clause saying what that method CANNOT see. Naming a method reads as rigour and does the opposite when its limits go unnamed.

STRONGER THAN TELLS 1-3, and worth listing first: those catch a claim that is too BROAD, which invites scrutiny. This catches a claim that is too CONFIDENT, which DEFLECTS it. "I verified it" is the sentence least likely to be challenged.

WORKED EXAMPLE (the-team-lead, same day): published "checked ClickUp static+video lists: zero collisions" - method capped at 4 pages across 2 of 9 lists, cap unstated. The clean result read as exhaustive, was not challenged by three other agents, and justified filing a live problem as merely preventive. Uncapped re-run over all 9 lists found 5 collisions already present. The false all-clear survived long enough to become a published document and a fleet artifact.

RULE: if you named a method to establish confidence, you owe its blind spot in the same sentence.

### Tell 4, sharpest instance: a method whose field of view EXCLUDES its own falsifier
An inbox census enumerates UNDRAINED queues. A delivered-and-drained message leaves no residue, so a WORKING recipient is invisible to that instrument by construction.

An agent used exactly this method, found 106 alerts stranded in two dead sinks, and published "nobody has been receiving crash alerts". The emitter actually fanned out to three recipients; the third worked and had been delivering the whole time. The method could only ever surface failures, and its output was reported as the whole picture.

GENERALISATION: "state what your method cannot see" is easy to agree with and hard to apply. The sharp version is - CHECK WHETHER YOUR METHOD'S FIELD OF VIEW IS THE COMPLEMENT OF THE THING THAT WOULD FALSIFY YOUR CLAIM. If you are asserting the ABSENCE of success, and your instrument only registers failure, the instrument cannot support the claim no matter how much data it returns.

CHEAP-CHECK COROLLARY: in this case reading the emitter's config was one line and immediately decisive. Before publishing a negative claim, ask whether a one-minute check could overturn it - and run it.

### Tell 4 variant: a filter that matches only success turns an ERROR into an EMPTY RESULT
`somecmd --flag 2>&1 | grep -E "<success-pattern>"` returns nothing both when the command SUCCEEDS WITH NO RESULTS and when it FAILS OUTRIGHT. The two are indistinguishable to the caller, and "no output" reads as a measured negative.

Observed instance: an agent ran `list-tasks --project human-tasks | grep <status-glyphs>`, got nothing, and read it as "no outstanding human tasks". The real output was `error: unknown option '--project'` - the option does not exist. The grep discarded the error line.

RULE: before concluding ABSENCE from a filtered command, run it BARE once. If you are asserting a negative, your pipeline must be able to show you a failure - and a success-matching filter structurally cannot.

### Design rule: put the control where the RESOURCE is, not where the WORKFLOW is
Observed twice in one night, in unrelated systems:
- a name-existence guard placed at a CLI command rather than at the library function every caller passes through, so every library caller sails past it
- a compliance scan placed inside an intake workflow rather than attached to the asset, so an asset pushed down a new path fires nothing

In both cases the control is real, correct and complete FOR THE PATH IT WAS BUILT ON. A new path around that workflow loses it SILENTLY - no error, because the control was never a property of the thing being protected.

RULE: mount controls on the resource (the chokepoint everything must cross), not on a process that happens to touch it. WORKFLOWS MULTIPLY AND RESOURCES DO NOT, and you cannot enumerate future paths.

TELL: if you describe the control as "a step", it is workflow-mounted. If you can only say where it runs by naming a process, a new process bypasses it.
COROLLARY: "we have a scanner" is a claim about the scanner, not about coverage. AN AUTOMATED CONTROL IS ONLY A BACKSTOP FOR THE PATHS THAT REACH IT.

#### Two failure modes, two different tells
NEVER REACHED - the control sits on a path the work no longer takes. (Guard at a CLI command while library callers bypass it; scan inside an intake workflow while assets are pushed straight through.)
  TELL: you describe the control as A STEP. "Then the scanner runs." "Then it validates the recipient." If you can only say where it runs by naming a process, a new process bypasses it.

REACHED THEN IGNORED - the control runs, returns a verdict, and nothing consumes it. (Crash hook: the guard WAS reached and its rejection was discarded by a no-op callback, so a hard failure produced no error and no effect.)
  TELL: the call's RESULT IS NOT ASSIGNED, CHECKED OR AWAITED - fire-and-forget, an empty callback, a discarded exit code. Ask "what reads the answer?" and if nothing does, the control is decorative.

SAME SYMPTOM, DIFFERENT BUGS: a control that exists, is correct, and does nothing. The first tell finds controls mounted on the wrong thing; the second finds controls whose output goes nowhere. Apply both - a control can pass one and fail the other.

---

## Extracted from the 2026-07-25→27 authoring run (the-sop-keeper, 2026-08-04)

These sections were authored on a worktree branch (`worktree-agent-a696646e0cc9906df`) during the 07-25→27 run and never reached `main` — verified absent from the whole `playbooks/` tree before extraction. They are pulled forward verbatim; the branch stays the historical record.

### Tracing an origin: the loud surface records, the quiet surface originates - and overwrites
When a term or rule is in circulation with no definition, the instinct is to trace it by mention-count and earliest-mention. THAT IDENTIFIES THE MOST DILIGENT RECORDER, NOT THE AUTHOR.

An agent that logs cascades it does not understand - and then logs that it does not understand them - accumulates mentions precisely because it is being careful. Diligence looks like authorship.

THE AUTHOR IS LIKELIER IN A SURFACE THAT DOES NOT NARRATE: a generated file, a config, a composition step. Writing a term into goals.json produces no diary entry saying "I coined this."

AND THE SHARPER HALF: those surfaces are usually OVERWRITTEN, not appended. A cascade replaces the generated file, so the origin is destroyed while every downstream transcription survives. THE COPIES OUTLIVE THE SOURCE - which inverts the assumption the search rests on, and means THE MISFIRE GETS WORSE WITH TIME: the longer you wait, the more exclusively the surviving evidence sits with the recorder.

RULE: for any generated or overwritten artifact, ORIGIN EVIDENCE LIVES ONLY IN SNAPSHOTS OR VERSION HISTORY, NEVER IN CURRENT STATE. Observed case was recoverable only from a daily backup snapshot.
RESOLUTION RULE: a name with no referent should be REMOVED, not retrofitted with a meaning - a retrofitted definition is indistinguishable from a real one later and strictly worse than the gap.

### Aggregation at capture is irreversible; aggregation at read time is free
Two defects found the same day, in the same pipeline, at different layers:
- a `qc_pending` field that SUMMED TWO STAGES and emitted one number, so a stalled 8-card gate carried a 70-card magnitude
- a `stage_for()` normaliser that MERGED THREE STATUS VOCABULARIES into one bucket, so 17 cards at 45 days shared a bucket with 23 at 1 day and the bucket emitted only a count

Both destroy the decomposition AT THE POINT OF CAPTURE. No downstream consumer can recover it - not by asking better questions, not by being careful - because the distinguishing information was never stored. One of them was averaging away a genuinely old backlog into a young busy one, by design, for weeks.

RULE: STORE THE FINEST GRAIN YOU HAVE; AGGREGATE WHEN REPORTING. The same headline number remains available, and the decomposition survives for whoever needs it later.

DO NOT over-correct into "never normalise" - normalisation is usually a real requirement (comparable stages across systems with different vocabularies). The defect is DESTRUCTIVE normalisation. Keep the raw value as a dimension alongside the normalised one, and let the sum happen at print time.

AMENDMENT (same day, from the agent whose pipeline this describes): BE PRECISE ABOUT WHERE THE LOSS HAPPENS. In the observed case the SNAPSHOT stored every raw status per card and had done for seven weeks; the destructive step was the DERIVED SERIES ROW written afterwards, which carried the bucket and dropped the dimension the snapshot kept. The normaliser was blamed and was not the culprit.
So the diagnostic question is NOT "which function normalises" but "WHICH ARTIFACT DROPS THE DIMENSION". Capture, derivation and report are three stages and the loss can be at any of them. Getting this wrong turns a cheap READ fix into an expensive re-instrumentation - and in the observed case the prescribed fix was already built, and had been read in one of fifty-eight rows.
COROLLARY: before rebuilding a capture, check whether the finer grain is already stored and merely unread. An unread field and an absent field look identical from downstream.

TELL: a field whose name is a category ("pending", "queue", "active") but whose value is a sum. Ask what it is made of BEFORE publishing it - A NUMBER THAT ARRIVES PRE-AGGREGATED IS EXACTLY THE ONE TO DECOMPOSE.

### A guard derived from one item must be swept back across its siblings
Two agents, same day, same artifact, identical failure: a confound check was derived from one item in a three-item brief and applied FORWARD to future work, while the two sibling items sitting in the same brief went unchecked. One of those siblings was wrong and was already being carried into a team instruction.

The check was three paragraphs away from the item it would have killed.

RULE: when a check is derived from an item, THE FIRST THING IT RUNS ON IS EVERY SIBLING THAT ARRIVED IN THE SAME ARTIFACT - before it is applied to anything new. Deriving a guard proves the failure mode is live in that batch; the batch is therefore the highest-prior place to look, and it is the place nobody looks because the guard feels like a lesson for next time.

### The sample selects the conclusion
"I was handed 12 videos out of a 13-ad event and concluded the common factor was video."

Observed three times in one day: a persona that is 65% of ad slots dominating a winners list; a format that would skew next window because the other format's supply is blocked; and a rejection set pre-filtered by format producing "format is the discriminator".

In all three the reasoner COULD NOT SEE THE SELECTION, because it happened before they received the data - so the conclusion restates the filter and looks like a finding. No amount of care inside the sample detects it.
THE COMMON FEATURE IS SHARPER THAN "IT HAPPENED BEFORE THEY GOT THE DATA": IN ALL THREE CASES THE SELECTION WAS PERFORMED BY SOMEONE ELSE AND ARRIVED UNLABELLED - a router handed over 12 of 13 ads; a prior quarter's commissioning decisions set the persona mix; a stalled queue would have set the format mix. NOBODY CHOSE THEIR OWN SAMPLE, WHICH IS EXACTLY WHY NONE OF THEM COULD SEE IT.

SO THE CATCHING QUESTION IS NOT "DID I FILTER THIS" - the honest answer is always no, so the question never fires. IT IS: "WHO ASSEMBLED THIS SET BEFORE IT REACHED ME, AND ON WHAT CRITERION?" That is answerable, it fires on real cases, and it points at a specific process rather than at a disposition. A general exhortation to watch for bias catches nothing; asking who assembled the set catches all three.

THE ONLY DEFENCE IS SOMEONE HOLDING THE UNFILTERED POPULATION. That makes a route to the whole event worth more than any analysis of a slice, and it is why the durable output of an investigation is usually the access, not the answer.

### The worst failures are the ones whose output is the desired result
A rate-limited API pull returns an error. A naive parser turns that error into an empty list. An empty list reads as "this account has zero rejections" - which is INDISTINGUISHABLE FROM A CLEAN ACCOUNT, and is exactly what everyone hopes to see.

This is a strictly worse case than an absence with two explanations, because the two explanations are not equally scrutinised: A FAILURE THAT PRODUCES BAD NEWS GETS INVESTIGATED; A FAILURE THAT PRODUCES GOOD NEWS GETS FILED. Observed the same day: a fleet rejection sweep where fourteen accounts reported zero, and the zeros were about to be carried upward as evidence of control.

REQUIREMENTS, not niceties:
- On parse failure write NULL, never zero or empty. Null is unmistakable; empty is a claim.
- A failed pull must fail LOUDLY and its limit belongs in the header of any report built on it, not the footnotes.
- A sweep that silently reports zeros for sources it could not read IS WORSE THAN NO SWEEP, because the corrupted output is indistinguishable from the good outcome and will be believed.

RELATED DIRECTION-OF-SCRUTINY RULE: check the failure mode that FLATTERS you. In the observed case truncated pagination would have understated the denominator and overstated the rate - inflating the very finding being published. The author checked that direction specifically, which is what made the figure safe to carry.

### An asymmetry of caveats read as an asymmetry of evidence
Two numbers arrived from the same source, both single observations. One carried a hedge ("earlier run, not re-observed"); the other did not, because the author had simply not labelled it.

A downstream reader took the unhedged one as CONFIRMED and the hedged one as PROVISIONAL, and published that split. Nothing anywhere stated the unhedged number was verified - its verification was inferred entirely from the ABSENCE of a caveat on it, next to the PRESENCE of one on its neighbour.

RULE: a hedge on one item says nothing about its neighbours. When one of several figures carries a caveat, ask what the others' provenance actually is rather than reading their silence as confirmation. AUTHORS LABEL INCONSISTENTLY, AND INCONSISTENT LABELLING IS INDISTINGUISHABLE FROM A DELIBERATE DISTINCTION.
The fix in the observed case was not a correction: the author re-pulled the unhedged figure twice independently and MADE it confirmed, which left the number usable instead of merely doubted.

### The relayer substitutes inference for an available measurement
Characteristic failure of any agent that sits between specialists and a decision-maker. The relay holds PARTIAL context from several sources, and the natural thing to do with partial context is reconcile it into a coherent story. RECONCILING IS INFERENCE. It looks like synthesis - which is the job - and is not distinguishable from it in the output.

Observed: a specialist reported an HTTP 400 carrying the literal string "user request limit reached", with two sibling endpoints answering fine at the same moment and a control account answering simultaneously. The relay, minutes later, wrote that the failure was "consistent with a warming account holding little inventory" - an inference that HARMONISED two separate facts into one tidy explanation. The measurement had already landed. It was not overlooked; it was smoothed.

WHY IT SURVIVES: THE RELAY LOOKS FAITHFUL. Nobody downstream can tell a synthesis from a substitution, because both arrive as one clean sentence from someone who has read everything.

GUARD: WHEN RELAYING, IF A MEASUREMENT EXISTS ANYWHERE IN THE THREAD, CITE IT RATHER THAN RECONCILING IT. Two facts sitting awkwardly next to each other are more honest than one that explains both. Prefer the untidy relay.

AND THE BENIGN DIRECTION IS THE DANGEROUS ONE: the substituted explanation is usually the reassuring one, because reassuring explanations are the ones that feel like resolution. A benign-sounding account of an anomaly is exactly what stops anyone looking for its cause.
