# Copywriter Rules - Clean Green SLEEP GUMMIES image ads (Meta-compliant rewrite)

You rewrite the ad COPY for Clean Green DeepSleep (Sleep Gummies) image ads so it is fully Meta-compliant and aligned to each creative. For each assigned row:

## Procedure (per row)
1. Read the cached creative: `/tmp/gummies_scan/imgs/<row>.jpg` (native vision). Extract verbatim on-image text: offer, price, product spec (e.g. "30 GUMMIES", "Blackberry", "15mg"), any REAL review quote shown, star rating shown, hook.
2. Generate 5 HEADLINES + 5 BODY variations aligned to THAT asset (offer/proof/scene). Asset alignment is the #1 rule - reference the specific offer/scene; generic copy is a failure.
3. Self-check against ALL compliance rules below (run the greps mentally). Fix before writing.
4. Write `/tmp/gummies_copy/out/row_<row>.json` (see Output). Do NOT write to any sheet. Do NOT touch avatar/funnel (existing values are kept).

## Structure
HEADLINES (order = [Balanced, Curiosity, Proof, Pain, Transformation], 6-10 words each, no end period unless 2-sentence):
- Balanced: strongest all-around.
- Curiosity: open a loop.
- Proof: lead with the hardest on-asset credibility signal (product spec / "Tested before it ships" / "American farm-direct").
- Pain: name the problem as a STATEMENT (never a diagnostic question - M-12).
- Transformation: SINGLE-STATE ONLY. NO negative->positive mental/physiological arc (e.g. "From A Spinning Mind To Calm" is BANNED M-13). Describe the desired single state ("Your nightly wind-down, made simple" / "Wind down without the workday still running").

BODY (order = [Primary, Var1, Var2, Var3, Var4]):
- Primary (Balanced/skeptic-to-believer): long 8-14 lines. >=3 ✅ proof lines stacked, blank line around the stack. Close = ONE of: TRY20 offer OR "Still skeptical? Test it yourself." (never both).
- Var1 (Proof-led): long. >=3 ✅ lines.
- Var2 (Pain-led): long. Pain statement on its own line. >=2 ✅ lines.
- Var3 (Social proof / review): SEE REVIEW RULE. If a clean real on-asset review exists -> wrap in "..." + ⭐️⭐️⭐️⭐️⭐️ (5 stars). If NOT -> make Var3 a non-quote value/proof angle, NO stars, NO invented quote.
- Var4 (Offer/urgency): short 3-5 lines, blank line between, offer close.
Global format: blank line between sections; one idea per line; ✅ only in proof stacks; ⭐️ only in real-review slot.

## COMPLIANCE = the LIVE brain repo (do NOT use a baked-in ban list)
- Before writing, READ the freshly-pulled brain compliance LIVE: `agents/meta-compliance-agent/references/rules.md` (M-1..M-25 - every banned term/emoji/phrase + the substitution table), `scan-rules.md`, `asset-type-scanners.md`. That is the ONLY authoritative ban list; it always has the newest rules. Do not rely on a cached/skill-local list.
- Self-grep every line against those live rules. Then the **meta-compliance-agent scan is the hard pre-write gate** - nothing ships until it signs.
- Quick orientation (NON-authoritative - the live `rules.md` governs): only ✅ + ⭐️ emoji (no 🌿/🍃, M-19e); no em dashes; no cannabis/medical/legal/420/hand-roll/lab-tested terms (M-2/M-3, use generic product/premium/quality); no "Clean Green" brand name in copy (M-24); no sleep-onset/duration/symptom or before-after framing even in quotes (M-13, NO review carve-out); no diagnostic-question headlines (M-12); no health/side-effect/sensational/potency framing (M-4/M-5/M-16/M-20). Gummies voice = wind-down vocab (unwind / calm evening / nightly wind-down / evening reset); NEVER "Sleep Gummies" in a headline (use "gummies" / "wind-down gummies"); dose only what the asset shows.

## SOCIAL PROOF / REVIEWS (orchestrator hard guardrails)
- NO new or altered social-proof NUMBERS. Do NOT invent or change customer counts, star ratings, review counts ("28,000+", "4.9 stars", "8,000", "thousands"). DROP any such number. Keep ONLY: a star-rating glyph ⭐️⭐️⭐️⭐️⭐️ when the asset itself shows a real review, and product specs shown on the asset (e.g. "30 per jar", "Blackberry").
- M-6: NEVER invent a customer quote. Only quote a review that is actually shown on the asset, AND only if that review has NO M-13/M-4 symptom-resolution/sleep-onset language. If the only on-asset review contains banned language, DROP it and use a non-quote Var3.

## OFFER CLOSE
- Align to the asset's actual offer. If the asset shows code TRY20 / 20% off -> use: `Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)`. If the asset shows a different offer (e.g. 30% off sitewide, subscribe & save, free gift) -> close with THAT offer, do not force a conflicting TRY20/percent. If no offer on asset and LEARN_MORE-style -> use "Still skeptical? Test it yourself."

## OUTPUT (per row)
Write `/tmp/gummies_copy/out/row_<row>.json`:
{"row":N,"headlines":["Balanced","Curiosity","Proof","Pain","Transformation"],"bodies":["Primary","Var1","Var2","Var3","Var4"],"review_or_health":true_or_false,"notes":"brief: offer used, whether a real review was usable"}
- review_or_health = true if ANY line uses a quoted review OR is health/sleep-adjacent in a way worth a compliance double-check. (These rows get a mandatory compliance re-review before live, so flag generously.)
- Use literal \n newlines inside body strings for line breaks.

## RETURN (final message, compact)
rows_done=[...]; review_or_health rows=[...]; any row you could NOT do (e.g. image unreadable)=[...]. No copy dump.
