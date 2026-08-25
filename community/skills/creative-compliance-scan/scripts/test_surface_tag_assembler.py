#!/usr/bin/env python3
"""Fail-closed tests for surface_tag_assembler.

Run from repo root:
  python3 -m pytest community/skills/creative-compliance-scan/scripts/test_surface_tag_assembler.py
"""
import json
import subprocess
import sys

import pytest

import surface_tag_assembler as s
import verdict_core


def row(media_type="image", claimed=None, row_id=1):
    return {
        "row": row_id,
        "tab": "Scan",
        "spreadsheet_id": "sheet1",
        "media_type": media_type,
        "claimed_surfaces": list(claimed if claimed is not None else ("copy", "creative")),
    }


def rec(surface, verdict="PASS", row_id=1, eyeball=None, basis_file_id="file1"):
    return {
        "row": row_id,
        "tab": "Scan",
        "spreadsheet_id": "sheet1",
        "surface": surface,
        "verdict": verdict,
        "evidence": "clean",
        "basis_file_id": basis_file_id,
        "gate_version": "v1",
        "eyeball": eyeball if eyeball is not None else ("sampled" if surface == "creative" else "none"),
    }


def assert_refuses(message, fn, *args):
    with pytest.raises(s.SurfaceTagError, match=message):
        fn(*args)


def test_image_all_clean_full_pass_tag():
    out = s.assemble_row(row("image", ("copy", "creative")), [rec("copy"), rec("creative")])
    assert out.letter == "PASS"
    assert out.surfaces == ("copy", "creative")
    assert out.status == "clean"
    assert s.compose_fragment(out) == "PASS [copy+creative]"


def test_video_all_clean_full_pass_tag():
    out = s.assemble_row(row("video", ("copy", "creative", "vo")), [rec("copy"), rec("creative"), rec("vo")])
    assert out.letter == "PASS"
    assert out.surfaces == ("copy", "creative", "vo")
    assert out.status == "clean"
    assert s.compose_fragment(out) == "PASS [copy+creative+vo]"


def test_video_copy_only_is_partial_not_error():
    out = s.assemble_row(row("video", ("copy",)), [rec("copy")])
    assert out.letter == "PASS"
    assert out.surfaces == ("copy",)
    assert out.status == "partial"
    assert s.compose_fragment(out) == "PASS [copy]"


def test_creative_pass_with_eyeball_none_refuses():
    assert_refuses(
        "creative PASS with eyeball=none",
        s.assemble_row,
        row("image", ("copy", "creative")),
        [rec("copy"), rec("creative", eyeball="none")],
    )


def test_missing_basis_file_id_refuses():
    assert_refuses(
        "missing basis_file_id",
        s.assemble_row,
        row("image", ("copy",)),
        [rec("copy", basis_file_id="")],
    )


def test_claimed_but_missing_surface_refuses():
    assert_refuses(
        "claimed surface\\(s\\) missing record: creative",
        s.assemble_row,
        row("image", ("copy", "creative")),
        [rec("copy")],
    )


def test_not_claimed_missing_surface_is_partial():
    out = s.assemble_row(row("image", ("copy",)), [rec("copy")])
    assert out.status == "partial"
    assert out.fragment == "PASS [copy]"


def test_worst_of_fail_surface_never_emits_pass():
    out = s.assemble_row(row("image", ("copy", "creative")), [rec("copy"), rec("creative", "FAIL", eyeball="none")])
    assert out.letter == "FAIL"
    assert out.fragment == "FAIL [copy+creative]"
    assert not out.fragment.startswith("PASS")


def test_verdict_order_parity_with_verdict_core_tier_outcome():
    for token in ("PASS", "UNCLEAR", "FAIL"):
        assert verdict_core._Verdict(verdict=token).tier_outcome == token
    assert s._worst_verdict(["PASS", "UNCLEAR"]) == verdict_core._Verdict(verdict="UNCLEAR").tier_outcome
    assert s._worst_verdict(["FAIL", "UNCLEAR", "PASS"]) == verdict_core._Verdict(verdict="FAIL").tier_outcome


def test_expected_vs_actual_mismatch_refuses_with_breakdown():
    rows = [row("image", ("copy",))]
    records = [rec("copy"), rec("copy", row_id=99)]
    assert_refuses("expected-vs-actual mismatch: expected 1 row-surfaces, actual 2", s.assemble_batch, rows, records)


def test_tag_never_uses_comma_and_verdict_word_leads():
    out = s.assemble_row(row("video", ("copy", "creative", "vo")), [rec("copy"), rec("creative"), rec("vo")])
    fragment = s.compose_fragment(out)
    assert "," not in fragment
    assert fragment.startswith("PASS ")
    assert fragment == "PASS [copy+creative+vo]"


def test_emitted_stamp_first_whitespace_token_is_bare_verdict():
    rows = [
        s.assemble_row(row("image", ("copy", "creative"), row_id=1), [rec("copy", row_id=1), rec("creative", row_id=1)]),
        s.assemble_row(
            row("image", ("copy", "creative"), row_id=2),
            [rec("copy", "UNCLEAR", row_id=2), rec("creative", row_id=2)],
        ),
        s.assemble_row(
            row("image", ("copy", "creative"), row_id=3),
            [rec("copy", row_id=3), rec("creative", "FAIL", row_id=3, eyeball="none")],
        ),
    ]
    for assembled in [s.compose_fragment(item) for item in rows]:
        assert assembled.split()[0] in {"PASS", "FAIL", "UNCLEAR"}


def test_surface_tag_never_starts_with_accepted_risk_prefix():
    out = s.assemble_row(row("video", ("copy", "creative", "vo")), [rec("copy"), rec("creative"), rec("vo")])
    assert not out.tag.startswith("[Adam accepted-risk ")
    assert not s.compose_fragment(out).split()[-1].startswith("[Adam accepted-risk ")


def test_unknown_surface_refuses():
    assert_refuses("unknown surface", s.assemble_row, row("image", ("copy",)), [rec("copy"), rec("story")])


def test_unknown_verdict_refuses():
    assert_refuses("unknown verdict", s.assemble_row, row("image", ("copy",)), [rec("copy", "MAYBE")])


def test_non_applicable_surface_record_refuses():
    assert_refuses("non-applicable surface record vo", s.assemble_row, row("image", ("copy", "creative")), [rec("copy"), rec("creative"), rec("vo")])


def test_unknown_media_type_refuses():
    assert_refuses("missing or unknown media_type", s.assemble_row, row("carousel", ("copy",)), [rec("copy")])


def test_record_not_claimed_refuses():
    assert_refuses("record surface\\(s\\) not claimed: creative", s.assemble_row, row("image", ("copy",)), [rec("copy"), rec("creative")])


def test_malformed_record_refuses():
    assert_refuses("malformed surface record", s.assemble_row, row("image", ("copy",)), ["not an object"])


def test_cli_refusal_is_stderr_only_no_partial_stdout(tmp_path):
    rows = tmp_path / "rows.json"
    records = tmp_path / "records.jsonl"
    rows.write_text(json.dumps([row("image", ("copy", "creative"))]), encoding="utf-8")
    records.write_text(json.dumps(rec("copy")) + "\n", encoding="utf-8")

    proc = subprocess.run(
        [sys.executable, s.__file__, str(rows), str(records)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    assert proc.returncode != 0
    assert proc.stdout == ""
    assert "claimed surface(s) missing record: creative" in proc.stderr


def test_self_check_cli_passes():
    proc = subprocess.run(
        [sys.executable, s.__file__, "--self-check"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    assert proc.returncode == 0
    assert proc.stderr == ""
    assert "self-check OK" in proc.stdout
