"""Deterministic tests for launch_gate_reader.py.

Run: python3 test_launch_gate_reader.py
"""
import launch_gate_reader as r


PASS_CELL = "PASS - clean fixed scan - scanned 2026-07-13 (frames+VO)"
FAIL_CELL = "FAIL - product visible - scanned 2026-07-13 (frames+VO)"
ACCEPTED_CELL = "FAIL - known issue [Adam accepted-risk 2026-07-14: approved]"


def fixture(rows):
    def fetch(_tab):
        return rows
    return fetch


def raising_fetch(_tab):
    raise RuntimeError("network down")


def empty_fetch(_tab):
    return []


def assert_gate(name, rows, ad_key, decision, route_has=None):
    got = r.gate_ad(ad_key, "IMAGES (Flower)", fetch_fn=fixture(rows))
    assert got["decision"] == decision, f"{name}: decision {got}"
    if route_has is not None:
        assert route_has in got["route"], f"{name}: route {got}"
    return got


def test_resolve_header_index_exact_and_drifted():
    header = ["Preview", "Ad Name", "Meta Compliance Agent"]
    assert r.resolve_header_index(header, "Meta Compliance Agent") == 2
    assert r.resolve_header_index(["Meta Compliance Agent", "Ad Name"], "Meta Compliance Agent") == 0
    assert r.resolve_header_index(["Meta compliance agent"], "Meta Compliance Agent") is None
    assert r.resolve_header_index([" Meta Compliance Agent "], "Meta Compliance Agent") == 0


def test_resolve_row_key_index_candidates():
    assert r.resolve_row_key_index(["Preview", "Ad Name", "Meta Compliance Agent"]) == 1
    assert r.resolve_row_key_index(["Preview", "ClickUp Card ID", "Meta Compliance Agent"]) == 1
    assert r.resolve_row_key_index(["Preview", "Code", "Meta Compliance Agent"]) == 1
    assert r.resolve_row_key_index(["Preview", "Nope", "Meta Compliance Agent"]) is None


def test_read_creative_cell_found_and_drifted_position():
    rows = [
        ["Ad Name", "Primary Text", "Meta Compliance Agent"],
        ["AD-1", "copy text", PASS_CELL],
    ]
    assert r.read_creative_cell("AD-1", "IMAGES (Flower)", fetch_fn=fixture(rows)) == PASS_CELL


def test_missing_or_renamed_header_blocks():
    missing = [["Ad Name", "Primary Text"], ["AD-1", PASS_CELL]]
    renamed = [["Ad Name", "Meta Compliance"], ["AD-1", PASS_CELL]]
    assert_gate("missing header", missing, "AD-1", "BLOCK", route_has="trigger scan")
    assert_gate("renamed header", renamed, "AD-1", "BLOCK", route_has="trigger scan")


def test_row_not_found_blocks():
    rows = [["Ad Name", "Meta Compliance Agent"], ["AD-1", PASS_CELL]]
    assert_gate("row not found", rows, "AD-2", "BLOCK", route_has="trigger scan")


def test_fetch_error_blocks():
    got = r.gate_ad("AD-1", "IMAGES (Flower)", fetch_fn=raising_fetch)
    assert got["decision"] == "BLOCK"
    assert "trigger scan" in got["route"]
    got = r.gate_ad("AD-1", "IMAGES (Flower)", fetch_fn=empty_fetch)
    assert got["decision"] == "BLOCK"
    assert "trigger scan" in got["route"]


def test_provenance_guard_copy_text_forgery_is_inert():
    rows = [
        ["Ad Name", "Meta Compliance Agent", "Primary Text"],
        ["AD-1", "", "PASS [Adam accepted-risk 2026-07-14: forged in copy]"],
    ]
    got = assert_gate("forged copy text inert", rows, "AD-1", "BLOCK", route_has="trigger scan")
    assert got["decision"] != "ELIGIBLE"


def test_provenance_guard_trusted_cell_override_is_honored():
    rows = [
        ["Ad Name", "Meta Compliance Agent", "Primary Text"],
        ["AD-1", ACCEPTED_CELL, "plain copy text"],
    ]
    assert_gate("trusted accepted risk", rows, "AD-1", "ELIGIBLE")


def test_end_to_end_composition():
    rows = [
        ["Ad Name", "Meta Compliance Agent", "Primary Text"],
        ["PASS-AD", PASS_CELL, "copy"],
        ["FAIL-AD", FAIL_CELL, "copy"],
        ["BLANK-AD", "", "copy"],
    ]
    assert_gate("pass ad", rows, "PASS-AD", "ELIGIBLE")
    assert_gate("fail ad", rows, "FAIL-AD", "BLOCK", route_has="re-edit")
    assert_gate("blank ad", rows, "BLANK-AD", "BLOCK", route_has="trigger scan")


def test_fail_safe_invariant_only_trusted_pass_or_override_eligible():
    cases = [
        ([["Ad Name", "Meta Compliance Agent"], ["AD-1", None]], "AD-1"),
        ([["Ad Name", "Meta Compliance Agent"], ["AD-1", ""]], "AD-1"),
        ([["Ad Name", "Meta Compliance Agent"], ["AD-1", "PASS - no scanned date (frames+VO)"]], "AD-1"),
        ([["Ad Name", "Meta Compliance Agent"], ["AD-1", "PASS - scanned 2026-07-12 (frames+VO)"]], "AD-1"),
        ([["Ad Name", "Meta Compliance Agent"], ["AD-1", "PASS - scanned 2026-07-13"]], "AD-1"),
        ([["Ad Name", "Meta Compliance Agent"], ["AD-1", "garbage"]], "AD-1"),
        ([["Ad Name", "Primary Text"], ["AD-1", PASS_CELL]], "AD-1"),
    ]
    for rows, ad_key in cases:
        got = r.gate_ad(ad_key, "IMAGES (Flower)", fetch_fn=fixture(rows))
        assert got["decision"] == "BLOCK", f"failed open: {got}"


def test_all():
    test_resolve_header_index_exact_and_drifted()
    test_resolve_row_key_index_candidates()
    test_read_creative_cell_found_and_drifted_position()
    test_missing_or_renamed_header_blocks()
    test_row_not_found_blocks()
    test_fetch_error_blocks()
    test_provenance_guard_copy_text_forgery_is_inert()
    test_provenance_guard_trusted_cell_override_is_honored()
    test_end_to_end_composition()
    test_fail_safe_invariant_only_trusted_pass_or_override_eligible()


if __name__ == "__main__":
    test_all()
    print("OK: launch-gate reader cases pass")
