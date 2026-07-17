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
    # THE ORIGIN CASE (real IMG_697): the "pre-rolls" hallucination landed in BOTH vision passes. Two
    # vision passes are the SAME modality (correlated re-reads) = NOT independent corroboration -> UNCLEAR.
    # The earlier name-count fix wrongly FAILed this; caught only by the real-record post-land regression.
    ("IMG_697 both-vision-passes are same modality, not independent -> UNCLEAR", {
        "vision_text": "A bundle of pre-rolls appears before the offer.",
        "vision_text2": "Pre-roll bundle shown on the table.",
        "ocr_text": "",
        "vo_text": "",
    }, "UNCLEAR"),
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
    # Asymmetric tooth: VO (whisper/audio) is a non-vision, self-trusting modality - a single VO hit FAILs,
    # never routes to UNCLEAR (a symmetric >=2-modality rule would wrongly UNCLEAR this).
    ("VO-only hard term is confirmable (asymmetric tooth)", {
        "vision_text": "",
        "vision_text2": "",
        "ocr_text": "",
        "vo_text": "Large flower shown in the video.",
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

def test_single_vision_only_modality():
    # Corroboration is MODALITY-based, not source-NAME-count. Vision-modality-only (any # of passes) is
    # uncorroborated -> UNCLEAR (True); a NON-vision modality (ocr/vo) present -> corroborated -> FAIL (False).
    assert g.single_vision_only(["vision"]) is True                      # single vision pass
    assert g.single_vision_only(["vision", "vision2"]) is True           # both passes = SAME modality (IMG_697)
    # MODALITY-TAG HARDENING (task_1784157356946): modality resolves via the EXPLICIT _SOURCE_MODALITY
    # map, NOT a "vision" name-prefix guess. An UNREGISTERED source (incl a prefix-match like vision3 or
    # vision_ocr) is unknown -> fail-closed (False -> the hit FAILs, never the softer UNCLEAR). The old
    # prefix auto-map WAS the latent fail-open (a non-vision source named vision* mis-tagged as vision).
    assert g.single_vision_only(["vision", "vision3"]) is False           # vision3 UNREGISTERED -> fail-closed
    assert g.single_vision_only(["vision_ocr"]) is False                  # prefix-match but unregistered -> FAIL
    # A new vision pass works WHEN explicitly registered (the accepted contract: one line in _SOURCE_MODALITY):
    _saved = dict(g.verdict_core._SOURCE_MODALITY)
    try:
        g.verdict_core._SOURCE_MODALITY["vision3"] = "vision"
        assert g.single_vision_only(["vision", "vision3"]) is True        # registered vision3 -> UNCLEAR preserved
        assert g.single_vision_only(["vision2", "vision3"]) is True
    finally:
        g.verdict_core._SOURCE_MODALITY.clear(); g.verdict_core._SOURCE_MODALITY.update(_saved)
    # Asymmetric teeth: a SINGLE non-vision (self-trusting) modality corroborates -> FAIL, never UNCLEAR.
    assert g.single_vision_only(["ocr"]) is False                        # OCR-only -> FAIL
    assert g.single_vision_only(["vo"]) is False                         # VO-only -> FAIL
    assert g.single_vision_only(["vision", "ocr"]) is False              # cross-modality -> FAIL
    assert g.single_vision_only([]) is False                             # empty -> fail-closed (FAIL)

if __name__ == "__main__":
    test_all()
    test_single_vision_only_modality()
    print(f"OK: {len(CASES) + len(RECORD_CASES)} de-code/span-mask/corpus cases + modality-tag unit cases pass")
