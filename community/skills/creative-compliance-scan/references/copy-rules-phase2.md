# Phase 2 copywriter rules (Clean Green Meta ad copy, image-PASS rows)

You generate Meta-COMPLIANT ad copy aligned to each creative. Image = the brief: fetch the 1x1, read its on-image text/offer/proof, write copy that matches the asset (do not invent offers/numbers the asset doesn't show).

## Per row, generate
- 5 DISTINCT headlines: [Balanced, Curiosity, Proof, Pain, Transformation]. At most ONE pure-offer/discount headline. No two share the same first 3 words.
- 5 bodies: [Primary, Var1, Var2, Var3, Var4]. Use ✅ bullets for proof/feature lines; vary angle across the 5.
- Align the CLOSE to the asset's offer: if the asset shows "TRY20"/"20% off", use `Get 20% off using code 'TRY20' at checkout (Limited Time Only)`; if it shows a different/no offer, match it (don't force TRY20).

## HARD compliance (every cell; rewrite until clean - never echo a banned term)
- NO em dashes (use hyphens/periods).
- NO invented or altered social-proof NUMBERS. Only echo a stat if it's literally on the asset (e.g. "4.8 stars" if shown). Drop customer/review counts otherwise.
- M-2 product/legality/stealth: never write bud, flower, cannabis, marijuana, weed, THC, CBD, hemp, pre-roll, hand-roll/hands-roll, dispensary, strain, "medical", "discreet", "plain box/mail", "no medical card", "federally legal/compliant". Use "real product / real quality / the real thing", "fast tracked shipping", "delivered to your door".
- DELIVERY-TIME GUARANTEE - HARD BAN (Adam, 2026-06-10, rejection-proven on flower rows 522-524): NEVER write a quantified delivery-time promise - no "delivered in 72 hours", "72-hour delivery", "at your door in 48 hours", "ships in 24 hours". Meta rejected live ads carrying this wording even though an old rules.md example suggested it was safe - real rejections win. COMPLIANT: "delivered fast", "fast shipping", "fast tracked to your door" (speed without a number). ALSO banned: quantified OUTCOME/EFFECT timing (M-16) - "asleep in 10 minutes", "8 hours guaranteed", "results in X days".
- M-25 scam/fake: never "too good to be true", "fake/faked", "scam", "fraud", "counterfeit", "bogus", "knock-off".
- M-24: never the brand name "Clean Green"/"cleangreen" as a claim in copy -> use "this", "we", "this company".
- M-19e: NO leaf/cannabis emoji 🌿🍃. Only ✅ (proof) and ⭐️ (review stars, only if a real review is shown) are allowed.
- M-20 comparison: no "better than / stronger than / more potent than / higher-quality than [shop/dispensary/competitor]"; first-person non-comparative quality is fine. Do NOT say "better quality than I was getting before" (comparative-vs-past = disapproval class).
- Quoted reviews: screen every quote. NO "fixed/changed/transformed my evenings/life", NO before/after "used to ... now ..." / "not the same since" (M-13), NO symptom/condition resolution. Paraphrase or drop.

## GUMMIES (Sleep Gummies) extra
- Wind-down vocabulary ALLOWED: "wind down", "relax", "unwind", "evening ritual", "calm", "your evening reset".
- BANNED (M-13 sleep-onset/duration): "fall asleep", "sleep through the night", "drift off", "wake up rested", "8 hours", "natural sleep aid", "non-habit-forming", "stay asleep".
- BANNED M-12 diagnostic-question headlines: "Can't sleep?", "Still awake?", "Trouble sleeping?".
- BANNED M-5 side-effects: "no grogginess", "no morning fog", "zero grog".
- BANNED M-4 medical: "insomnia", "anxiety", "stress", "relief", "cure", "treat".
- Melatonin: "no melatonin"/"melatonin-free" OK (differentiator). Avoid melatonin-comparison/replacement framing.

## FLOWER extra
- The product is a premium flower pouch ("Pure Nature"), but NEVER name it (no "flower"/"bud"). Use "real product", "the real thing", "premium quality", "American farm-direct", "family-grown".
- Avoid M-4 health-state ("relief", "calm your pain"). First-person quality/value framing is fine.

## TAB-MISMATCH check
If a creative is clearly the WRONG product for the batch (e.g. a gummies/bundle creative in a flower batch, or vice-versa), set "mismatch":true and skip copy for that row (empty headlines/bodies) + note the actual product. Do NOT write off-product copy.

## Output
One JSON object per row appended to the output file:
{"row":<int>,"product":"flower|gummies","headlines":[5 strings],"bodies":[5 strings],"mismatch":false,"asset_text":"<verbatim on-image text>","notes":""}
