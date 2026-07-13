"""Regression tests for grep_verdict.py de-code/span-mask behavior (item 1, 2026-06-23).
Run: CODING_SIGNALS_JSON=<brain>/agents/meta-compliance-agent/data/cannabis-coding-signals.json python3 -m pytest test_grep_verdict.py
(or plain `python3 test_grep_verdict.py` for the asserts). Protects the bare-"legal" M-2
broadening + the de-code->UNCLEAR span-mask (#154 surface asymmetry: creative=UNCLEAR, copy=FAIL).
Section 10 update: eligible-states is no longer masked because creative surface handling is hard_fail."""
import grep_verdict as g

def _v(text):
    return g.verdict_for({"vision_text": text})[0]

def _vrec(rec):
    return g.verdict_for(rec)[0]

CASES = [
    # de-code framings -> UNCLEAR (masked, Adam-review per #154), NOT hard-FAIL
    ("Lab-tested for purity.",             "UNCLEAR"),
    ("Certificate of analysis on file.",   "UNCLEAR"),
    ("Farm-direct quality.",               "UNCLEAR"),
    # eligible-states is creative=hard_fail, so it is not masked by the unclear de-code span.
    ("Available where it's legal.",        "FAIL"),
    ("Ships to legal states only.",        "FAIL"),
    ("We ship where legal.",               "FAIL"),
    ("Ships to eligible states.",          "FAIL"),
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
    # §10: eligible-states verb set remains broad, but it is hard_fail and must not be masked.
    ("Sold in legal states.",              "FAIL"),
    # SPAN-LOCAL make-or-break (claude-dev review, 2026-06-23): a de-code span ("ships to legal
    # states" -> UNCLEAR/masked) CO-OCCURRING with a STANDALONE hard claim ("100% legal") in ONE
    # creative MUST still FAIL the row. The standalone legal sits OUTSIDE the masked de-code span,
    # survives the length-preserving blank, and FAILs. If the span-mask ever went row-scoped instead
    # of span-LOCAL, ONLY this case catches it - the de-code would wrongly suppress the standalone FAIL.
    ("Ships to legal states. 100% legal.", "FAIL"),
]

RECORD_CASES = [
    ("Daily Unwind mid-video OCR", {
        "ocr_text": "Lab-tested Blue Dream flower. As seen on CBS. Ships to eligible states.",
        "vision_text": "",
        "vision_text2": "",
        "vo_text": "",
    }, "FAIL"),
    ("Skeptic VO + strain", {
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "Gelato THC flower for pain relief.",
        "vo_text": "Independently tested before it ships.",
    }, "FAIL"),
    ("Pain Relief VO de-code only", {
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "Simple nightly routine.",
        "vo_text": "Independently tested for purity.",
    }, "UNCLEAR"),
    ("Clean unboxing", {
        "vision_text": "Open the box and enjoy 20% off today.",
        "vision_text2": "",
        "ocr_text": "Premium quality delivered.",
        "vo_text": "Here is what comes in the package.",
    }, "PASS"),
    ("Bare strain", {"vision_text": "Blue Dream", "ocr_text": "", "vo_text": ""}, "UNCLEAR"),
    ("Strain plus THC", {"vision_text": "Blue Dream THC", "ocr_text": "", "vo_text": ""}, "FAIL"),
    ("vo_text hard fail", {
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "",
        "vo_text": "Federally compliant flower.",
    }, "FAIL"),
]

def test_all():
    bad = []
    for text, want in CASES:
        got = _v(text)
        if got != want:
            bad.append((text, want, got))
    for name, rec, want in RECORD_CASES:
        got = _vrec(rec)
        if got != want:
            bad.append((name, want, got))
    assert not bad, "verdict mismatches: " + "; ".join(f"{t!r} want {w} got {g_}" for t,w,g_ in bad)

if __name__ == "__main__":
    test_all()
    print(f"OK: {len(CASES) + len(RECORD_CASES)} de-code/span-mask/corpus cases pass")
