"""Regression tests for grep_verdict.py de-code/span-mask behavior (item 1, 2026-06-23).
Run: CODING_SIGNALS_JSON=<brain>/agents/meta-compliance-agent/data/cannabis-coding-signals.json python3 -m pytest test_grep_verdict.py
(or plain `python3 test_grep_verdict.py` for the asserts). Protects the bare-"legal" M-2
broadening + the de-code->UNCLEAR span-mask (#154 surface asymmetry: creative=UNCLEAR, copy=FAIL)."""
import grep_verdict as g

def _v(text):
    return g.verdict_for({"vision_text": text})[0]

CASES = [
    # de-code framings -> UNCLEAR (masked, Adam-review per #154), NOT hard-FAIL
    ("Available where it's legal.",        "UNCLEAR"),
    ("Ships to legal states only.",        "UNCLEAR"),
    ("We ship where legal.",               "UNCLEAR"),
    ("Ships to eligible states.",          "UNCLEAR"),
    ("Lab-tested for purity.",             "UNCLEAR"),
    ("Certificate of analysis on file.",   "UNCLEAR"),
    # standalone hard legality (outside any de-code span) -> FAIL (survives the mask)
    ("100% legal. Premium quality.",       "FAIL"),
    ("Federally legal product.",           "FAIL"),
    ("Agriculture Act compliant.",         "FAIL"),
    # hard M-2 not in the de-code set -> FAIL
    ("No chemicals, ever.",                "FAIL"),
    # GROWN-FAMILY HARD BAN (Adam 2026-07-01, brain PR #199/#204): 2026-06-22 accepted-risk ALLOW REVERSED.
    # All grown-provenance phrasing (family/farm/home/usa/locally/organically grown, "grown in/on/by")
    # = HARD FAIL M-19b via banned-terms.json hard[]. NOT accepted-risk anymore.
    ("Family-grown quality, delivered.",   "FAIL"),
    # clean
    ("Real quality delivered. 20% off.",   "PASS"),
    # §-7 FIRED (brain #161 -> cannabis-coding-signals v1.1.4, 2026-06-23): mc WIDENED the de-code
    # eligible-states verb set to include sold/sells/buy/buys/order/gets/purchas. So "sold in legal
    # states" is now a MASKED de-code geo-framing -> UNCLEAR-for-Adam-review (was FAIL pre-widening).
    # This case FLIPPED FAIL->UNCLEAR exactly as the prior TODO anticipated; LAST_KNOWN_DECODE[0]
    # mirrors brain v1.1.4 (verb-widened, tail kept it'?s per brain-canonical).
    ("Sold in legal states.",              "UNCLEAR"),
    # SPAN-LOCAL make-or-break (claude-dev review, 2026-06-23): a de-code span ("ships to legal
    # states" -> UNCLEAR/masked) CO-OCCURRING with a STANDALONE hard claim ("100% legal") in ONE
    # creative MUST still FAIL the row. The standalone legal sits OUTSIDE the masked de-code span,
    # survives the length-preserving blank, and FAILs. If the span-mask ever went row-scoped instead
    # of span-LOCAL, ONLY this case catches it - the de-code would wrongly suppress the standalone FAIL.
    ("Ships to legal states. 100% legal.", "FAIL"),
]

def test_all():
    bad = []
    for text, want in CASES:
        got = _v(text)
        if got != want:
            bad.append((text, want, got))
    assert not bad, "verdict mismatches: " + "; ".join(f"{t!r} want {w} got {g_}" for t,w,g_ in bad)

if __name__ == "__main__":
    test_all()
    print(f"OK: {len(CASES)} de-code/span-mask cases pass")
