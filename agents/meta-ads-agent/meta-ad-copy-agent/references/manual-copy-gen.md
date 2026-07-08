---
name: manual-copy-gen
description: >
  Manual Meta ad copy generation for Clean Green using 3 proven styles
  (Long Form, Review Style, Short Form). Based on 15 winning copy
  templates cross-referenced with Meta ad copy best practices.
  Vocabulary rebuilt 2026-05 against the meta-compliance scan
  (M-3 / M-5 / M-6a / M-12 / M-13). Use this skill when writing
  ad copy batches by hand (not the automated sheet pipeline).
  Loaded by the /adcopy:manual command.
---

# Manual Copy Generation - 3-Style Framework

This skill defines how to write Clean Green Meta ad copy manually in 3
proven styles. It is separate from the automated `copy-framework`
skill (which writes to the Google Sheet). Use this when a human
requests a batch of ad copy for review, testing, or creative
exploration.

**Required companion skills:** brand-voice, compliance, avatars.

> **Compliance is single-sourced from the [meta-compliance-agent](../../../meta-compliance-agent/) (2026-06-08).** This file is generation *guidance* (3 manual styles), **not** compliance rules. Its references, headline banks, and trust signals were rebuilt to be compliant against the agent's M-codes (M-2 / M-3 / M-5 / M-6a / M-12 / M-13 / M-19 / M-24, …) so manually-written copy starts compliant. Enforcement is the agent's scan as a hard pre-write gate - see [`compliance.md`](compliance.md). The retired in-pipeline `§9 cleanup` / `§10 mechanical substitution` passes **no longer exist**; wherever older text below references them, read it as: *this is banned (per the cited M-code) - draft the compliant form, and the agent scan is the gate.*

---

## The 3 Styles

Every ad MUST be one of these 3 styles. Each has specific structural
rules derived from Clean Green's 15 winning copies.

---

### STYLE 1: LONG FORM

8-20 lines. Multi-section. Uses structure (checkmarks, line breaks,
benefit stacks). The heavy lifter that does full persuasion in-feed.

**Length:** 400-900 chars. First line under 125 chars.

**Structure:**
```
[HOOK - 1 line, pattern interrupt or bold claim]

[BODY - Framework-driven: problem/agitation, story, or contrast]

[PROOF - Checkmarks, benefits, timeline, or objection handling]

[TRUST - Guarantee, customer count, press, or tested-before-it-ships]

[CTA - Discount code + "Limited Time Only"]
```

**7 Proven Frameworks (mapped to winning copies):**

| Framework | Source | Hook Pattern | Body Pattern |
|-----------|--------|-------------|-------------|
| Timeline Progression | #1, #4 | WARNING / "Here's the pattern" | ✅ Week 1... ✅ Week 2... ✅ Month 6... |
| Founder Story + Promise | #2 | CAUTION + fact | Origin story → ✅ benefit list |
| BAB (Old vs New) | #6 | "Stop [behavior]. Try this." | Old Way: [pain] / New Way: [solution] |
| Objection Handling | #7 | "What if [fear]? → [answer]" x3 | Stack objections → resolve → proof |
| Empathy + Guarantee | #11 | "We get it. [Skepticism]." | Acknowledge → guarantee → social proof |
| Authority + Compliance | #13 | "Let's address the elephant" | family-grown framing → press → trust |
| Subscription Pitch | #14 | "Here's what happens after 3+ orders" | Pattern observation → ✅ benefits |

**Winning reference (Timeline Progression):**
```
WARNING: You won't go back to your local shop after trying this...

"I'll try it once" is what most say before their 1st Clean Green order.
Then they realize:
✅ Week 1: This is the real deal!
✅ Week 2: They're hooked (and reordering)
✅ Month 6: Goodbye, overpriced shops!

Experience premium quality at unbeatable prices with fast, reliable
shipping & a 100% guarantee.

Limited Time Offer: Get 20% OFF with code 'TRY20'
```

**Winning reference (BAB Old vs New):**
```
Stop wasting time and money driving to the shop. Try this instead...

Old Way:
Deal with traffic, parking, and long shop lines.

New way:
Order premium quality from your couch and it arrives at your front door
fast and tracked.

No hassle. No wasted time. No mediocre quality. Just real quality
delivered fast and tracked to your door with a money-back guarantee.

Get 20% OFF TODAY with code 'TRY20' at checkout (Limited time only)
```

**Winning reference (Objection Handling):**
```
What if it's not what they hoped for? → Full refund.
What if I don't like it? → Full refund.
What if it doesn't arrive? → We reship it free.

We've eliminated every "what if" so you can order with confidence.

Premium quality. Family-grown. Delivered fast and tracked.

Over 28,409+ customers trust Clean Green because we guarantee quality,
not just promise it.

Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)
```

---

### STYLE 2: REVIEW STYLE

First-person testimonial in quotes. Reads like a real customer wrote
it. Starts with skepticism, ends with conversion.

**Length:** 200-500 chars. First quote line under 125 chars.

**Structure:**
```
"[OPENING - Skepticism, doubt, or concern the viewer shares]

[MIDDLE - What happened when they tried / discovery moment]

[CLOSE - Conversion statement + specific authentic detail]" ⭐️⭐️⭐️⭐️⭐️

[CTA - Discount code, outside the quotes]
```

**4 Proven Angles:**

| Angle | Source | Opens With | Converts Because Of |
|-------|--------|-----------|-------------------|
| Skeptic-to-Believer | #3 | "I thought ordering online was sketchy" | Quality surprise |
| Compliance Concern | #5 | "My biggest concern was: is this allowed?" | family-grown + press |
| Time/Convenience | #12 | "I was wasting 2 hours driving" | Convenience + quality |
| Subscription Discovery | #15 | "I was ordering every 3 weeks" | Realized overpaying |

**Hard rules:**
- ALWAYS in quotation marks (entire review)
- ALWAYS first person
- ALWAYS starts with doubt/concern - never positive
- ALWAYS ends with ⭐️⭐️⭐️⭐️⭐️
- CTA line sits OUTSIDE the quotes
- Include 1-2 specific details (times, amounts, sensory) for
  authenticity
- Never sound like marketing copy inside the review
- **Review-Style carve-out:** duration phrases ("Slept 7 hours
  straight", "Asleep in 15 minutes") and first-person M-13 phrasings
  ("woke up rested", "stayed asleep") are ALLOWED inside the `"..."`
  quote followed by `⭐️⭐️⭐️⭐️⭐️`. They are banned in primary brand
  voice. The mechanical substitution pass in `compliance.md` §10
  skips text inside this pattern.

**Winning reference (Skeptic-to-Believer):**
```
"I'll be honest... I thought ordering quality online was sketchy.
Figured it'd be a disappointment. Turns out I was completely wrong.
Clean Green is legit." ⭐️⭐️⭐️⭐️⭐️

Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)
```

**Winning reference (Time/Convenience):**
```
"I was wasting almost 2 hours every week driving to the shop.

45 minutes there, 45 minutes back, plus waiting in line. Then I found
out Clean Green delivers premium quality right to my door.

No traffic. No lines. No wasted gas money. Just real quality showing
up at my house.

I've been ordering for months and it's honestly better than what I was
getting at the shop." ⭐️⭐️⭐️⭐️⭐️

Use discount code 'TRY20' for 20% OFF TODAY (Limited time only)
```

---

### STYLE 3: SHORT FORM

2-4 lines. One message. Punchy. No story, no persuasion arc. For
retargeting, announcements, state callouts, restocks.

**Length:** 50-200 chars. Entire ad visible without "See more."

**Structure:**
```
[HEADLINE STATEMENT - benefit, announcement, or callout]
[OPTIONAL: 1 supporting line]
[CTA - Discount code + "Limited Time Only"]
```

**3 Proven Patterns:**

| Pattern | Source | Example |
|---------|--------|---------|
| State Callout | #8 | "BIG NEWS, FLORIDA!" |
| Single Objection | #9 | "Will it be exactly what they hoped for?" → 100-Day Money-Back Guarantee |
| Restock/Announcement | #10 | "All products back in stock!" |

**Hard rules:**
- Maximum 4 lines including CTA
- One idea only
- Can use 1 emoji (🌿) in the main line
- Best for retargeting warm/hot audiences

**Winning reference (State Callout):**
```
BIG NEWS, FLORIDA!
Get Real Quality Delivered Fast. 🌿
Get 20% OFF using code 'FLORIDA20' at checkout (Limited Time Only)
```

---

## Headlines

Every ad needs a headline under 27 chars.

**Proven headline bank (compliant vocabulary):**
- Limited Time Offer! 🌿
- Get 100% Real Quality Delivered 🌿
- Get 100% Clean Quality Delivered 🌿
- Featured on USA Today, MSNBC & CBS
- Get 20% OFF Today 🌿
- Premium Quality Delivered Right To Your Door
- The Real Thing Or Your Money Back 🌿
- Order Real Quality Online 🌿
- Pure Quality. Family-Grown. 🌿
- How Is This Allowed? Here's The Answer...
- Get Real Quality, Delivered Fast. 🌿
- Get Real Quality Online (Family-Grown)
- Real Quality, Real Savings, Real Convenient
- Real Quality. Real Results. Real Fast.
- Stop Wasting Money On Weak Shop Quality 🌿
- Stop Overpaying For Shop Quality 🌿
- See Why Everyone's Talking About Clean Green...

**Headline formula patterns:**
- {Outcome} + 🌿
- {Benefit}, {Benefit}, {Benefit}
- {Curiosity question} (NOT a `Tired Of [X]?` diagnostic question - those are M-12-banned)
- {Authority signal}
- Stop {pain} 🌿
- {Guarantee statement} 🌿

**Description (under 30 chars):** urgency or social proof.
Examples: "Ends tonight", "4.9 stars", "Free shipping over $99"

---

## Meta Platform Rules

- First line under 125 chars (mobile truncation)
- Headline under 27 chars
- Description under 30 chars
- Reels text under 72 chars
- One idea per line, aggressive line breaks
- Emojis: 1-3 max (✅ for lists, 🌿 for brand, ⭐️ for reviews)
- Use "you" more than "we"

---

## Hook Types for First Line

| Hook | Example |
|------|---------|
| Empathy | "If you've ever [struggle], you know..." |
| Story Opener | Drop into narrative, no setup |
| Myth Bust | Challenge a common belief |
| Specificity | Describe their exact situation |
| Objection-First | Address resistance upfront |
| Social Proof Stack | Layer evidence points |
| Disqualifier | Say who it's NOT for |
| Warning/Negative | Start with Stop/Don't/Avoid |
| Immediate Benefit | Direct instant payoff |
| Skeptic Disarm | Acknowledge doubt head-on |

> **Forbidden hook pattern:** the diagnostic-question hook
> (`Tired Of [X]?`, `Sick Of [X]?`, `Done With [X]?`, `Done
> Wasting [X]?`, `Fed Up With [X]?`, `Can't sleep?`) trips Meta's
> M-12 classifier. The mechanical substitution pass replaces these
> with the per-product rotator in `compliance.md` §10.0. Don't
> draft them - pick a different hook.

---

## Funnel Stage Mapping

| Stage | Style | Length | Hook |
|-------|-------|--------|------|
| Cold | Long Form | Full persuasion | Curiosity, pain |
| Warm | Long or Review | Social proof | Proof, objection-first |
| Hot | Short Form | Urgency | Scarcity, direct offer |

---

## Batch Distribution Rules

When generating a batch of N ads:
- At least 50% Long Form
- At least 25% Review Style
- At least 1 Short Form per batch of 6+
- No two ads use same framework + hook combination
- Vary emotional angles (aspiration, fear, curiosity, belonging)
- No two ads have identical CTA phrasing
- No two ads have identical hooks

---

## Trust Signals to Rotate (compliant vocabulary)

- "Over 28,000+ customers"
- "100% money-back guarantee"
- "Featured on USA Today, MSNBC & CBS"
- "Fast, reliable shipping" (replaces "Discreet packaging, fast delivery")
- "Free shipping over $99"
- "100% Delivery Guarantee"
- "100-Day Money-Back Guarantee"
- "Family-grown"
- "Work directly with our growers"

---

## CTA Standard

Every ad ends with a discount code offer. Default:
"Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)"

Vary phrasing across the batch. Options:
- "Limited Time Offer: Get 20% OFF with code 'TRY20'"
- "Use discount code 'TRY20' for 20% OFF TODAY (Limited time only)"
- "Get 20% OFF TODAY with code 'TRY20' at checkout (Limited time only)"
- Custom codes for campaigns: FLORIDA20, CLEANGREEN20, SLEEP25, etc.

---

## Quality Checklist (run per ad before output)

1. First line under 125 chars?
2. Headline under 27 chars?
3. Description under 30 chars?
4. Discount code present in CTA?
5. Review style in quotes with ⭐️⭐️⭐️⭐️⭐️?
6. Short form under 4 lines?
7. **meta-compliance-agent scan run** (asset-type `ad-copy`) and every
   line PASSED? See [`compliance.md`](compliance.md). FAIL → fix per its
   substitutions → re-scan.
8. Zero `bud`, `flower`, `pre-roll`, `hand-roll`, `strain`,
   `discreet`, `mylar pouch`, `lab-tested`, `lab-verified`, `COA`,
   `Certificate of Analysis`, `federally compliant`, `Farm Bill`,
   `Agriculture Act`, `no med card`, `Potency Promise`, `potency`,
   `potent` (M-3)?
9. Zero `not foggy`, `no fog`, `no jitters`, `no crash`, `no
   paranoia`, `zombie fog`, `no overthinking`, `no morning fog`,
   `no melatonin hangover` (M-5)?
10. Zero `scam`, `garbage`, `junk`, `trash`, `fake` as
    product/brand nouns (M-6a)?
11. Zero `Tired Of X?`, `Sick Of X?`, `Done With X?`, `Done
    Wasting X?`, `Fed Up With X?`, `Can't sleep?` headlines (M-12)?
12. Zero `wake up rested`, `wake up refreshed`, `sleep through the
    night`, `stay asleep`, `fall asleep faster`, `drift off`, `8
    hours straight`, `sleep deeper`, `best sleep in a long time`,
    `End the 3am ceiling stare`, `Better mornings start the night
    before` (M-13 - outside Review-Style carve-out)?
13. No two ads share same hook?
14. No two ads share same CTA phrasing?
15. Line breaks between sections?
