"""Regression tests for the bud-per-directive video accepted-risk carve-out (verdict_core.py,
mc verdict-conventions.md #5, 2026-07-31). Adam directive: bud is added 1-3x to new video ads
AFTER script compliance passes. The carve-out must be TERM-level (this one expected term on this
one media type) and must NEVER become an ad-level launch-eligibility override - that distinction
is the whole point (a bud-per-directive video that ALSO has a real unrelated FAIL must still FAIL).
Requires a live brain clone (same CODING_SIGNALS_JSON env var as the other test_*.py files).
Run: CODING_SIGNALS_JSON=<brain>/agents/meta-compliance-agent/data/cannabis-coding-signals.json python3 test_bud_carve_out.py
"""
import verdict_core as vc

_TEST_CARVE = {
    "terms": {"bud", "buds"},
    "applies_when": {"media_type": "video"},
    "marker": "[bud-per-directive 2026-07-30]",
    "active": True,
}


def _authority_with_carve(carve_outs):
    a = vc.load()
    assert a.status == "ok", f"live authority failed to load: {a.reasons}"
    a.carve_outs = carve_outs
    return a


def _classify(rec, authority):
    return vc.classify(rec, authority, surface="creative")


def test_all():
    cases = 0

    # (a) bud-per-directive on video -> accepted-risk tag, NOT a bare FAIL.
    authority = _authority_with_carve([_TEST_CARVE])
    v = _classify({"row": 1, "vision_text": "add a lil bud to the mix", "ocr_text": "", "vo_text": "",
                    "media_type": "video", "product": "flower"}, authority)
    assert v.verdict == "PASS", f"(a) expected PASS (carved out), got {v.verdict}: {v.evidence}"
    assert "[bud-per-directive 2026-07-30]" in v.evidence, f"(a) marker missing from evidence: {v.evidence}"
    assert not any("bud" in f.lower() for f in v.fails), f"(a) bud must not appear in fails: {v.fails}"
    cases += 1

    # (b) bud on NON-video -> still FAILs (directive is video-only; media_type absent = image path).
    # ocr_text corroborates vision_text (2 sources) so this exercises the definitive FAIL path, not
    # the pre-existing single-vision-uncorroborated -> UNCLEAR path (a different, unrelated mechanism).
    v = _classify({"row": 2, "vision_text": "add a lil bud to the mix", "ocr_text": "add a lil bud to the mix",
                    "vo_text": "", "product": "flower"}, authority)
    assert v.verdict == "FAIL", f"(b) bud on non-video must still FAIL, got {v.verdict}: {v.evidence}"
    cases += 1

    # (b2) bud on an EXPLICIT media_type=="image" record -> still FAILs (not just "absent" -> also
    # any non-matching value must fail closed, not just missing keys).
    v = _classify({"row": 22, "vision_text": "add a lil bud to the mix", "ocr_text": "add a lil bud to the mix",
                    "vo_text": "", "media_type": "image", "product": "flower"}, authority)
    assert v.verdict == "FAIL", f"(b2) bud on media_type=image must still FAIL, got {v.verdict}"
    cases += 1

    # (c) a DIFFERENT M-2 term (flower/cannabis/etc, same regex group as bud) on video -> still FAILs.
    # The carve-out is bud-specific, not a blanket M-2-on-video pass.
    v = _classify({"row": 3, "vision_text": "real cannabis flower inside", "ocr_text": "real cannabis flower inside",
                    "vo_text": "", "media_type": "video", "product": "flower"}, authority)
    assert v.verdict == "FAIL", f"(c) other M-2 terms on video must still FAIL, got {v.verdict}: {v.evidence}"
    cases += 1

    # (d) canary: with NO carve-outs active (the real-world default until mc ships the data), bud
    # still hard-bans on video exactly as before - the mechanism is inert until data says otherwise.
    inert_authority = _authority_with_carve([])
    v = _classify({"row": 4, "vision_text": "add a lil bud to the mix", "ocr_text": "add a lil bud to the mix",
                    "vo_text": "", "media_type": "video", "product": "flower"}, inert_authority)
    assert v.verdict == "FAIL", f"(d) with carve_outs=[], bud must still FAIL (mechanism inert by default), got {v.verdict}"
    cases += 1

    # (e) bud-per-directive on video PLUS a real unrelated hard hit (dispensary, corroborated) -> verdict
    # still FAILs on the OTHER hit; bud is tagged separately, not swallowed into a false-clean PASS.
    v = _classify({"row": 5, "vision_text": "add a lil bud to the mix, visit our dispensary",
                    "ocr_text": "visit our dispensary", "vo_text": "", "media_type": "video", "product": "flower"},
                   authority)
    assert v.verdict == "FAIL", f"(e) a real co-occurring hard hit must still surface, got {v.verdict}: {v.evidence}"
    assert not any("bud" in f.lower() for f in v.fails), f"(e) bud itself must still be carved out of fails: {v.fails}"
    assert any("dispensary" in f.lower() for f in v.fails), f"(e) the other hit must be in fails: {v.fails}"
    cases += 1

    # (f) THE COLLISION CHECK - the produced cell/evidence string must NEVER contain the ad-level
    # accepted-risk override prefix. has_accepted_risk() substring-matches "[Adam accepted-risk " and
    # would mark the WHOLE AD launch-eligible on either surface cell - masking an unrelated real FAIL.
    v = _classify({"row": 6, "vision_text": "add a lil bud to the mix", "ocr_text": "", "vo_text": "",
                    "media_type": "video", "product": "flower"}, authority)
    assert "[Adam accepted-risk " not in v.evidence, (
        f"(f) COLLISION: carve-out evidence must never contain the ad-level override prefix: {v.evidence}"
    )
    cases += 1

    # (g) a carve-out entry whose marker DOES start with the collision prefix must be rejected at
    # LOAD time (structural defense, not a data-trust decision) - never reaches the scanner at all.
    # _load_carve_outs's INPUT shape is {"term": "bud", ...} (raw JSON), not the compiled {"terms": set}
    # shape _TEST_CARVE is in - test the loader directly against realistic raw-JSON input.
    bad_carve_raw = {"term": "bud", "applies_when": {"media_type": "video"},
                      "marker": "[Adam accepted-risk bud-per-directive]", "active": True}
    good_carve_raw = {"term": "bud", "applies_when": {"media_type": "video"},
                       "marker": "[bud-per-directive 2026-07-30]", "active": True}
    import json, tempfile, os
    fd, path = tempfile.mkstemp(suffix=".json")
    with open(fd, "w") as f:
        json.dump({"hard": [{"m_code": "M-2", "pattern": "bud", "note": "x"}],
                   "candidate": [{"m_code": "M-1", "pattern": "xyz123", "note": "x"}],
                   "version": "1.0.11",
                   "carve_outs": [bad_carve_raw, good_carve_raw]}, f)
    try:
        loaded = vc._load_carve_outs({"BANNED_TERMS_JSON": path})
        assert len(loaded) == 1, f"(g) colliding marker must be rejected, only the clean entry should load: {loaded}"
        assert loaded[0]["marker"] == good_carve_raw["marker"], f"(g) wrong entry survived: {loaded}"
    finally:
        os.unlink(path)
    cases += 1

    # (h) FAIL-OPEN GUARD (claude-dev review of 0192ccb8): a carve-out with EMPTY or MISSING applies_when
    # must be REJECTED at load. all([]) == True, so an unconditional carve-out would suppress the term on
    # EVERY record (not just media_type=video) = a banned term silently carved out everywhere = fail-open.
    # The correct way to un-ban a term globally is to remove it from the ban list, never carve unconditionally.
    empty_aw_raw   = {"term": "bud", "applies_when": {}, "marker": "[bud-per-directive 2026-07-30]", "active": True}
    missing_aw_raw = {"term": "bud", "marker": "[bud-per-directive 2026-07-30]", "active": True}
    good2_raw      = {"term": "bud", "applies_when": {"media_type": "video"},
                       "marker": "[bud-per-directive 2026-07-30]", "active": True}
    fd2, path2 = tempfile.mkstemp(suffix=".json")
    with open(fd2, "w") as f:
        json.dump({"hard": [{"m_code": "M-2", "pattern": "bud", "note": "x"}],
                   "candidate": [{"m_code": "M-1", "pattern": "xyz123", "note": "x"}],
                   "version": "1.0.11",
                   "carve_outs": [empty_aw_raw, missing_aw_raw, good2_raw]}, f)
    try:
        loaded2 = vc._load_carve_outs({"BANNED_TERMS_JSON": path2})
        assert len(loaded2) == 1, \
            f"(h) empty/missing applies_when must be rejected (unconditional carve-out = fail-open); only the conditional one loads: {loaded2}"
        assert loaded2[0]["applies_when"] == {"media_type": "video"}, f"(h) wrong entry survived: {loaded2}"
    finally:
        os.unlink(path2)
    cases += 1

    print(f"OK: {cases} bud-carve-out cases pass (a-h)")


if __name__ == "__main__":
    test_all()
