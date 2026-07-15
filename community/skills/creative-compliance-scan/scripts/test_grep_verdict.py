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
    # Single vision-source hard hits route to UNCLEAR for human review, not hard FAIL.
    ("Available where it's legal.",        "UNCLEAR"),
    ("Ships to legal states only.",        "UNCLEAR"),
    ("We ship where legal.",               "UNCLEAR"),
    ("Ships to eligible states.",          "UNCLEAR"),
    ("100% legal. Premium quality.",       "UNCLEAR"),
    ("Federally legal product.",           "UNCLEAR"),
    ("Agriculture Act compliant.",         "UNCLEAR"),
    ("No chemicals, ever.",                "UNCLEAR"),
    ("Family-grown quality, delivered.",   "UNCLEAR"),
    ("Pre-rolls featured in the bundle.",  "UNCLEAR"),
    ("Outdoor-grown quality.",             "UNCLEAR"),
    # clean
    ("Real quality delivered. 20% off.",   "PASS"),
    ("Sold in legal states.",              "UNCLEAR"),
    ("Ships to legal states. 100% legal.", "UNCLEAR"),
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
    ("IMG_697 pre-roll vision hallucination", {
        "vision_text": "A bundle of pre-rolls appears before the offer.",
        "vision_text2": "",
        "ocr_text": "",
        "vo_text": "",
    }, "UNCLEAR"),
    ("same-source repeated hard term does not corroborate", {
        "vision_text": "Pre-rolls, pre-rolls, pre-rolls.",
        "vision_text2": "",
        "ocr_text": "",
        "vo_text": "",
    }, "UNCLEAR"),
    ("two vision passes count as independent sources", {
        "vision_text": "A bundle of pre-rolls appears before the offer.",
        "vision_text2": "Pre-roll bundle shown on the table.",
        "ocr_text": "",
        "vo_text": "",
    }, "FAIL"),
    ("corroborated flower stays hard fail", {
        "vision_text": "Large flower headline.",
        "vision_text2": "",
        "ocr_text": "FLOWER",
        "vo_text": "",
    }, "FAIL"),
    ("exactly two independent sources stay hard fail", {
        "vision_text": "Flower appears in the headline.",
        "vision_text2": "",
        "ocr_text": "FLOWER",
        "vo_text": "",
    }, "FAIL"),
    ("OCR-only hard term is confirmable", {
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "FLOWER",
        "vo_text": "",
    }, "FAIL"),
    ("outdoor-grown vision-only provenance", {
        "vision_text": "Outdoor-grown quality.",
        "vision_text2": "",
        "ocr_text": "",
        "vo_text": "",
    }, "UNCLEAR"),
    ("outdoor-grown OCR corroborated provenance", {
        "vision_text": "Outdoor-grown quality.",
        "vision_text2": "",
        "ocr_text": "Outdoor-grown quality.",
        "vo_text": "",
    }, "FAIL"),
    ("OCR hard legality still fails", {
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "100% legal. No chemicals, ever. Agriculture Act compliant.",
        "vo_text": "",
    }, "FAIL"),
    ("span-local OCR hard claim still fails", {
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "Ships to legal states. 100% legal.",
        "vo_text": "",
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
