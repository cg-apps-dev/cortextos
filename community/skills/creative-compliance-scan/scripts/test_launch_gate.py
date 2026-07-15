"""Deterministic tests for launch_gate.py.

Run: python3 test_launch_gate.py
"""
import launch_gate as g


CREATIVE_PASS = "PASS - clean creative scan - scanned 2026-07-13 (frames+VO)"
CREATIVE_PASS_ALT = "PASS - clean creative scan - scanned 2026-07-13 (Phase 1-V)"
COPY_PASS = "PASS - clean copy scan - scanned 2026-07-13 (copy-gate)"


def assert_gate(name, creative_cell, copy_cell, decision, surface=None, route_has=None, reason_has=None):
    got = g.launch_gate(creative_cell, copy_cell)
    assert got["decision"] == decision, f"{name}: decision {got}"
    assert got["failing_surface"] == surface, f"{name}: failing surface {got}"
    if route_has is not None:
        assert route_has in got["route"], f"{name}: route {got}"
    if reason_has is not None:
        assert reason_has in got["reason"], f"{name}: reason {got}"
    return got


def assert_single(name, cell, decision, route_has=None, reason_has=None):
    got = g.launch_gate_single(cell)
    assert got["decision"] == decision, f"{name}: decision {got}"
    if route_has is not None:
        assert route_has in got["route"], f"{name}: route {got}"
    if reason_has is not None:
        assert reason_has in got["reason"], f"{name}: reason {got}"
    return got


def test_leading_verdict():
    assert g.leading_verdict("") == "NONE"
    assert g.leading_verdict("   ") == "NONE"
    assert g.leading_verdict("COPY - not a verdict") == "INVALID"
    assert g.leading_verdict("pass - lowercase allowed") == "PASS"
    assert g.leading_verdict("   UNCLEAR - review") == "UNCLEAR"


def test_fixed_scan_date_boundary_and_markers():
    assert not g.is_fixed_scan("PASS - old - scanned 2026-07-12 (frames+VO)", "creative")
    assert g.is_fixed_scan("PASS - fixed - scanned 2026-07-13 (frames+VO)", "creative")
    assert g.is_fixed_scan("PASS - fixed - scanned 2026-07-13 (VO audio+frames)", "creative")
    assert g.is_fixed_scan("PASS - fixed - scanned 2026-07-13 (creative v2.1)", "creative")
    assert g.is_fixed_scan(CREATIVE_PASS_ALT, "creative")
    assert not g.is_fixed_scan("PASS - bare pass - scanned 2026-07-13", "creative")
    assert g.is_fixed_scan(COPY_PASS, "copy")
    assert not g.is_fixed_scan("PASS - fixed date but missing marker - scanned 2026-07-13", "copy")
    assert not g.is_fixed_scan("PASS - malformed - scanned 2026-13-99 (frames+VO)", "creative")


def test_clean_two_surface_pass_is_eligible():
    assert_gate("both fixed pass", CREATIVE_PASS, COPY_PASS, "ELIGIBLE")


def test_two_surface_independence():
    assert_gate(
        "creative fail copy pass",
        "FAIL - product visible - scanned 2026-07-13 (frames+VO)",
        COPY_PASS,
        "BLOCK",
        surface="creative",
        route_has="re-edit",
        reason_has="creative FAIL",
    )
    assert_gate(
        "copy fail creative pass",
        CREATIVE_PASS,
        "FAIL - banned copy - scanned 2026-07-13 (copy-gate)",
        "BLOCK",
        surface="copy",
        route_has="copy-rewrite",
        reason_has="copy FAIL",
    )


def test_accepted_risk_override_either_cell():
    assert_gate(
        "creative accepted risk",
        "FAIL - known asset [Adam accepted-risk 2026-07-14]",
        COPY_PASS,
        "ELIGIBLE",
    )
    assert_gate(
        "copy accepted risk",
        "FAIL - creative still failing",
        "FAIL - copy risk [Adam accepted-risk 2026-07-14]",
        "ELIGIBLE",
    )


def test_blank_invalid_and_none_block_unscanned():
    assert_gate("creative blank", "", COPY_PASS, "BLOCK", surface="creative", route_has="trigger scan")
    assert_gate("copy invalid", CREATIVE_PASS, "COPY - pending", "BLOCK", surface="copy", route_has="trigger scan")
    assert_gate("none creative", None, COPY_PASS, "BLOCK", surface="creative", route_has="trigger scan")


def test_stale_pass_blocks_rescan():
    assert_gate(
        "creative old pass",
        "PASS - old - scanned 2026-07-12 (frames+VO)",
        COPY_PASS,
        "BLOCK",
        surface="creative",
        route_has="re-scan",
        reason_has="creative stale PASS",
    )
    assert_gate(
        "copy marker absent bare pass",
        CREATIVE_PASS,
        "PASS - clean looking - scanned 2026-07-13",
        "BLOCK",
        surface="copy",
        route_has="re-scan",
        reason_has="copy stale PASS",
    )


def test_unclear_blocks_review():
    assert_gate(
        "creative unclear",
        "UNCLEAR - lab/de-code - scanned 2026-07-13 (frames+VO)",
        COPY_PASS,
        "BLOCK",
        surface="creative",
        route_has="mc/Adam review",
    )
    assert_single(
        "single fixed unclear is held",
        "UNCLEAR - single vision product term - scanned 2026-07-13 (frames+VO)",
        "BLOCK",
        route_has="mc/Adam review",
        reason_has="creative UNCLEAR",
    )
    assert_gate(
        "copy unclear",
        CREATIVE_PASS,
        "UNCLEAR - copy needs ruling - scanned 2026-07-13 (copy-gate)",
        "BLOCK",
        surface="copy",
        route_has="mc/Adam review",
    )


def test_both_surfaces_fail_names_both_and_has_no_single_surface():
    got = assert_gate(
        "both fail",
        "FAIL - bad creative - scanned 2026-07-13 (frames+VO)",
        "",
        "BLOCK",
        surface=None,
    )
    assert "creative FAIL" in got["reason"]
    assert "copy unscanned" in got["reason"]
    assert "re-edit" in got["route"]
    assert "trigger scan" in got["route"]


def test_fail_safe_malformed_inputs_never_eligible():
    malformed_cases = [
        (None, None),
        ("", ""),
        ("PASS - no date (frames+VO)", COPY_PASS),
        (CREATIVE_PASS, "PASS - no date (copy-gate)"),
        ("PASS - garbage date scanned 2026-99-99 (frames+VO)", COPY_PASS),
        ({"verdict": "PASS"}, COPY_PASS),
        (CREATIVE_PASS, ["PASS"]),
    ]
    for creative_cell, copy_cell in malformed_cases:
        got = g.launch_gate(creative_cell, copy_cell)
        assert got["decision"] == "BLOCK", f"malformed input failed open: {got}"


def test_launch_gate_single_paths():
    assert_single(
        "single accepted risk",
        "FAIL - known asset [Adam accepted-risk 2026-07-14]",
        "ELIGIBLE",
    )
    assert_single("single fixed pass", CREATIVE_PASS, "ELIGIBLE")
    assert_single(
        "single stale date",
        "PASS - old - scanned 2026-07-12 (frames+VO)",
        "BLOCK",
        route_has="re-scan",
    )
    assert_single(
        "single bare pass",
        "PASS - no marker - scanned 2026-07-13",
        "BLOCK",
        route_has="re-scan",
    )
    assert_single("single fail", "FAIL - product visible", "BLOCK", route_has="re-edit")
    assert_single("single unclear", "UNCLEAR - needs review", "BLOCK", route_has="mc/Adam review")
    assert_single("", "", "BLOCK", route_has="trigger scan")
    assert_single("blank", "   ", "BLOCK", route_has="trigger scan")
    assert_single("none", None, "BLOCK", route_has="trigger scan")
    assert_single("garbage", "COPY - PASS scanned 2026-07-13 (frames+VO)", "BLOCK", route_has="trigger scan")
    assert_single(
        "copy narrative pass is not leading verdict",
        "Narrative says PASS - scanned 2026-07-13 (frames+VO)",
        "BLOCK",
    )


def test_all():
    test_leading_verdict()
    test_fixed_scan_date_boundary_and_markers()
    test_clean_two_surface_pass_is_eligible()
    test_two_surface_independence()
    test_accepted_risk_override_either_cell()
    test_blank_invalid_and_none_block_unscanned()
    test_stale_pass_blocks_rescan()
    test_unclear_blocks_review()
    test_both_surfaces_fail_names_both_and_has_no_single_surface()
    test_fail_safe_malformed_inputs_never_eligible()
    test_launch_gate_single_paths()


if __name__ == "__main__":
    test_all()
    print("OK: launch-gate contract cases pass")
