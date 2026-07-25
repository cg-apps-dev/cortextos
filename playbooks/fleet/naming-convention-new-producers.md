> DRAFT / SEED (not yet canonical). Authored by the-team-lead 2026-07-25, CORRECTED same day. Tier-1 (framework process) version: org-specific instances deliberately omitted.
>
> POINTER DISCIPLINE: this file does NOT cite a path for the applied case. The org tree is gitignored by deliberate policy, so any path into it is HOST-LOCAL and unresolvable on another checkout - a versioned document must not promise a reference that cannot resolve. Org-specific instances (card ids, writer initials, counts) live in org-private storage on the operating host; their durable home is the org knowledge repo, not this tree and not orgs/**.
>
> CORRECTION: this was first published as PREVENTIVE on the basis of a 'zero collisions' check. That check was CAPPED (4 pages, 2 of 9 lists) and the conclusion was wrong. An uncapped sweep (1,171 tasks, all 9 lists) found collisions ALREADY PRESENT. This is a LIVE condition, not a future risk. See 'Observed' below.

# Identifier-shorthand collision (preventive convention)

## THE PATTERN
Work items are often named `<WRITER-PREFIX>_<SYSTEM>_<TYPE>_<NUMBER>` but referenced in conversation by the bare `<TYPE>_<NUMBER>` shorthand. Everyone silently expands the shorthand.

That shorthand is unambiguous only while ONE writer effectively owns the numbering space. That is a property of STAFFING, not of the naming convention - so it holds by accident, and it ends the moment a second producer numbers into the same space (i.e. exactly when new people onboard).

## THE RULE
In any cross-agent or cross-person reference, use the FULL item name including the writer prefix - not the bare shorthand. Alternative: confirm the numbering is GLOBALLY sequential (assigned centrally, never reused per writer); if guaranteed, bare shorthand is safe. Pick one and state which.

## WHY - and this is the part that gets deleted and should not be
When it breaks, it breaks in the worst available way (see reader-repaired-corruption.md):
1. INVISIBLE WHILE SILENT - every reader expands the shorthand to whichever item they had in mind. The ambiguity never reaches conscious attention, so nobody reports it. Care does not help; the repair happens upstream of attention.
2. MIS-ATTRIBUTED WHEN LOUD - it surfaces as two people DISAGREEING ABOUT AN ITEM'S STATUS. Everyone debugs statuses, queues and records; nobody examines the identifier, because the identifier is the one thing both parties are certain they agree on.

You cannot debug your way to this after the fact - by the time it presents, the evidence points elsewhere. Hence: set the convention at onboarding, before the second writer exists.

## OBSERVED (not hypothetical)
An uncapped sweep of all lists found 5 identifiers already carrying two different writer prefixes (specific ids withheld here as org content - see POINTER DISCIPLINE above). The predicted symptom is present: the SAME bare shorthand resolves to one item that is live and another that is killed, so two readers comparing notes disagree about STATUS while both are reading correctly.

This is the two-stage failure arriving on schedule - it was invisible while the shorthand was merely ambiguous, and it will surface as a status dispute rather than as a naming defect.

METHOD NOTE (and this is the point): the first check reported ZERO collisions. It was capped at 4 pages across 2 of 9 lists. The cap was not stated when the clean result was published, so the result read as exhaustive. A stated method with an unstated blind spot produced a false all-clear that then justified filing the whole issue as preventive.

## BOUNDING THE EXPOSURE (do this before rewriting anything)
When collisions are found, enumerate the NON-DOMINANT writers' full card set before deciding remediation. In the observed case the dominant writer held 565 items and the other two held 11 between them - so the entire collision surface was ten numbers, not an open-ended risk, and existing bare references only needed checking against that short list.

Also check whether the secondary allocators are ACTIVE or DORMANT. In the observed case every non-dominant card was killed or completed, none in progress, and their highest numbers trailed the dominant writer by hundreds - i.e. the surface was historical and closed. That converts "rewrite everything defensively" into "do not rewrite; adopt the prefixed form going forward".

THE RISK REOPENS ON THE NEXT NEW ALLOCATOR. Dormancy is not a fix, it is a window - which is precisely why the convention should be in place before new producers write their first card.

## WHY THIS CANNOT BE RETROFITTED CHEAPLY (the-ad-strategist, 2026-07-25)
An existing corpus written in the ambiguous form is simultaneously the strongest argument FOR the convention and the reason it must be set in advance rather than fixed later.

In the observed case one agent held 42 bare references across reports, rankers and skills. Rewriting them is a mechanical sweep across many files - precisely the operation that introduces transcription errors, which is the failure class this whole document exists to prevent. THE REMEDIATION IS ITSELF A CORRUPTION RISK, and a larger one than the exposure it removes while the collision surface stays dormant.

CONSEQUENCE FOR SEQUENCING: the convention must land before the first allocation by a new writer, NOT before the first collision. After the first collision, every option is bad - live ambiguity, or a bulk rewrite that risks introducing wrong identifiers. Treat "new person about to create work items" as the trigger, and file it as a tracked obligation rather than an intention, because the trigger is an event nobody is watching for.
