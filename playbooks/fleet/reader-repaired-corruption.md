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
Card-identifier shorthand (IMG_535 vs MB_CG_IMG_535) - currently safe only by accident of single-writer staffing, ending when new producers onboard. See skills/drafts/naming-convention-new-producers.md

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
