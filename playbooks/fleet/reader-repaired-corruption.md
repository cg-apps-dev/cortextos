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
