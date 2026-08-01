#!/usr/bin/env python3
import io
import json
import unittest
from unittest.mock import patch

import reconcile_completed as rc


def card(card_id="abc", kind="image", folder_id=None):
    return rc.CompletedCard(
        card_id=card_id,
        kind=kind,
        name=f"Card {card_id}",
        status="✅ Posted To Sheet",
        folder_id=folder_id or f"folder-{card_id}",
        product="Flower",
    )


def presence(verdict="", launch_state=rc.DORMANT, row=12):
    return rc.SheetPresence("IMAGES (Flower)", row, verdict, launch_state)


def zero_counts():
    return {"MISSING_cards": 0, "ACTIVE_UNSCANNED": 0, "AMBIGUOUS_UNSCANNED": 0}


class ReconcileCompletedTests(unittest.TestCase):
    def test_classify_launch_state_cases(self):
        self.assertEqual(rc.classify_launch_state(["Active - 06/24/2026 - Ad ID: 1"]), rc.ACTIVE)
        self.assertEqual(rc.classify_launch_state(["campaign_paused - 06/24/2026", "pending - 06/24/2026"]), rc.PAUSED)
        self.assertEqual(rc.classify_launch_state(["", "   "]), rc.DORMANT)
        self.assertEqual(rc.classify_launch_state(["Act - 06/24/2026"]), rc.AMBIGUOUS)
        self.assertEqual(rc.classify_launch_state(["paused - 06/24/2026", "garbled stamp"]), rc.AMBIGUOUS)
        self.assertEqual(rc.classify_launch_state(["garbled stamp", "active - 06/24/2026"]), rc.ACTIVE)
        self.assertEqual(rc.classify_launch_state(["Archived - 06/24/2026"]), rc.PAUSED)
        self.assertEqual(rc.classify_launch_state(["2026-05-13"]), rc.AMBIGUOUS)  # bare-date legacy stamp surfaces (fail-safe), pending serving-vs-ended

    def test_zero_presence_card_is_one_missing_card(self):
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a", "file-b"}):
            result = rc.reconcile([card()], {})
        self.assertEqual(result["gap_counts"], {"MISSING_cards": 1, "ACTIVE_UNSCANNED": 0, "AMBIGUOUS_UNSCANNED": 0})
        self.assertEqual(result["gaps"][0]["type"], "MISSING")
        self.assertEqual(result["gaps"][0]["card_id"], "abc")
        self.assertEqual(result["gaps"][0]["file_count"], 2)

    def test_zero_file_id_presence_but_card_id_on_sheet_is_excluded(self):
        sheet_card_index = {"abc": [rc.SheetCardPresence("Ashley Monroe::VIDEOS", 8)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"reexport-a", "reexport-b"}):
            result = rc.reconcile([card()], {}, sheet_card_index=sheet_card_index)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["card_id_present"], 1)
        self.assertEqual(result["gaps"], [])

    def test_card_id_present_takes_precedence_over_baseline_dropped_fail(self):
        baseline = {"dropped_fail_cards": ["abc"], "testimonial_file_ids": []}
        sheet_card_index = {"abc": [rc.SheetCardPresence("Ashley Monroe::VIDEOS", 8)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"reexport-a", "reexport-b"}):
            result = rc.reconcile([card()], {}, baseline=baseline, sheet_card_index=sheet_card_index)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["card_id_present"], 1)
        self.assertEqual(result["excluded"]["baseline_dropped_fail"], 0)

    def test_card_id_from_cell_only_accepts_default_clickup_id_shape(self):
        self.assertEqual(rc._card_id_from_cell("86e2b3fvx"), "86e2b3fvx")
        self.assertEqual(rc._card_id_from_cell("https://app.clickup.com/t/86e2b3fvx"), "86e2b3fvx")
        self.assertEqual(rc._card_id_from_cell("ab12cd34ef"), "ab12cd34ef")
        self.assertIsNone(rc._card_id_from_cell("60320"))
        self.assertIsNone(rc._card_id_from_cell("TRELLO"))
        self.assertIsNone(rc._card_id_from_cell("ABC-123"))

    def test_partial_card_excludes_remaining_missing_variants(self):
        sheet_index = {"file-a": [presence("PASS")]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a", "file-b", "file-c"}):
            result = rc.reconcile([card()], sheet_index)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["partial_card"], 1)
        self.assertEqual(result["gaps"], [])

    def test_non_ad_folder_files_are_skipped_not_missing(self):
        def list_folder(folder_id):
            if folder_id == "folder-abc":
                return [{"id": "broll", "name": "B-Roll Edits", "mimeType": "application/vnd.google-apps.folder"}]
            if folder_id == "broll":
                return [{"id": "file-a", "name": "MB_CG_IMG_1_V1_1x1.jpg", "mimeType": "image/jpeg"}]
            return []

        with patch.object(rc.engine, "_list_folder", side_effect=list_folder):
            result = rc.reconcile([card(folder_id="folder-abc")], {})
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["non_ad_folder"], 2)
        self.assertEqual(result["pending_cards"][0]["reason"], "no finished creative file IDs found")

    def test_active_blank_compliance_is_active_unscanned(self):
        sheet_index = {"file-a": [presence("", rc.ACTIVE)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index)
        self.assertEqual(result["gap_counts"]["ACTIVE_UNSCANNED"], 1)
        self.assertEqual(result["gaps"][0]["type"], "ACTIVE_UNSCANNED")
        self.assertEqual(result["gaps"][0]["tab"], "IMAGES (Flower)")
        self.assertEqual(result["gaps"][0]["row"], 12)

    def test_dormant_blank_compliance_is_excluded(self):
        sheet_index = {"file-a": [presence("", rc.DORMANT)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["dormant_unscanned"], 1)

    def test_paused_blank_compliance_is_excluded(self):
        sheet_index = {"file-a": [presence("", rc.PAUSED)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["paused_unscanned"], 1)

    def test_ambiguous_blank_compliance_surfaces(self):
        sheet_index = {"file-a": [presence("", rc.AMBIGUOUS)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index)
        self.assertEqual(result["gap_counts"]["AMBIGUOUS_UNSCANNED"], 1)
        self.assertEqual(result["excluded"]["dormant_unscanned"], 0)
        self.assertEqual(result["excluded"]["paused_unscanned"], 0)

    def test_recognized_paused_is_not_ambiguous(self):
        self.assertEqual(rc.classify_launch_state(["paused - 06/24/2026"]), rc.PAUSED)

    def test_partial_truncated_stamp_surfaces_as_ambiguous(self):
        self.assertEqual(rc.classify_launch_state(["Active -"]), rc.AMBIGUOUS)

    def test_baseline_dropped_fail_card_excludes_missing(self):
        baseline = {"dropped_fail_cards": ["abc"], "testimonial_file_ids": []}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], {}, baseline=baseline)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["baseline_dropped_fail"], 1)

    def test_baseline_testimonial_excludes_non_active_unscanned(self):
        baseline = {"dropped_fail_cards": [], "testimonial_file_ids": ["file-a"]}
        sheet_index = {"file-a": [presence("", rc.DORMANT)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index, baseline=baseline)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["excluded"]["baseline_testimonial"], 1)
        self.assertEqual(result["excluded"]["dormant_unscanned"], 0)

    def test_active_unscanned_in_baseline_still_surfaces(self):
        baseline = {"dropped_fail_cards": [], "testimonial_file_ids": ["file-a"]}
        sheet_index = {"file-a": [presence("", rc.ACTIVE)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index, baseline=baseline)
        self.assertEqual(result["gap_counts"]["ACTIVE_UNSCANNED"], 1)
        self.assertEqual(result["excluded"]["baseline_testimonial"], 0)

    def test_ambiguous_unscanned_in_baseline_still_surfaces(self):
        baseline = {"dropped_fail_cards": [], "testimonial_file_ids": ["file-a"]}
        sheet_index = {"file-a": [presence("", rc.AMBIGUOUS)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index, baseline=baseline)
        self.assertEqual(result["gap_counts"]["AMBIGUOUS_UNSCANNED"], 1)
        self.assertEqual(result["excluded"]["baseline_testimonial"], 0)

    def test_ended_zero_spend_excludes_ambiguous_row(self):
        # A bare-date AMBIGUOUS row verified zero-spend (row-AND, both windows) -> excluded.
        baseline = {"ended_zero_spend_rows": [["IMAGES (Flower)", 12]]}
        sheet_index = {"file-a": [presence("", rc.AMBIGUOUS, 12)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index, baseline=baseline)
        self.assertEqual(result["gap_counts"]["AMBIGUOUS_UNSCANNED"], 0)
        self.assertEqual(result["excluded"]["ended_zero_spend"], 1)

    def test_ended_zero_spend_NEVER_masks_active(self):
        # CRITICAL invariant: an ACTIVE row is ALWAYS surfaced even if its (tab,row) is in the
        # ended set - the verified-$0 override applies ONLY in the AMBIGUOUS branch. A live-active
        # ad can never be excluded by a stale/wrong ended entry.
        baseline = {"ended_zero_spend_rows": [["IMAGES (Flower)", 12]]}
        sheet_index = {"file-a": [presence("", rc.ACTIVE, 12)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index, baseline=baseline)
        self.assertEqual(result["gap_counts"]["ACTIVE_UNSCANNED"], 1)
        self.assertEqual(result["excluded"]["ended_zero_spend"], 0)

    def test_ambiguous_row_not_in_ended_set_surfaces(self):
        # A bare-date AMBIGUOUS row NOT in the verified-ended set keeps surfacing (e.g. a spanning
        # row that serves on a connected account, or any unverified row).
        baseline = {"ended_zero_spend_rows": [["IMAGES (Flower)", 99]]}  # different row
        sheet_index = {"file-a": [presence("", rc.AMBIGUOUS, 12)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index, baseline=baseline)
        self.assertEqual(result["gap_counts"]["AMBIGUOUS_UNSCANNED"], 1)
        self.assertEqual(result["excluded"]["ended_zero_spend"], 0)

    def test_seeded_new_zero_presence_card_surfaces_as_missing(self):
        baseline = {"dropped_fail_cards": ["other"], "testimonial_file_ids": ["other-file"]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card("fresh")], {}, baseline=baseline)
        self.assertEqual(result["gap_counts"]["MISSING_cards"], 1)
        self.assertEqual(result["excluded"]["baseline_dropped_fail"], 0)

    def test_no_baseline_reincludes_baseline_excluded_entries(self):
        baseline = {"dropped_fail_cards": ["abc"], "testimonial_file_ids": []}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            baseline_result = rc.reconcile([card()], {}, baseline=baseline)
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            full_result = rc.reconcile([card()], {}, baseline=None)
        self.assertEqual(baseline_result["excluded"]["baseline_dropped_fail"], 1)
        self.assertEqual(full_result["gap_counts"]["MISSING_cards"], 1)

    def test_main_no_baseline_does_not_load_baseline(self):
        out = io.StringIO()
        with (
            patch.object(rc, "resolve_completed_cards", return_value=[card()]),
            patch.object(rc, "build_sheet_file_index", return_value={}),
            patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}),
            patch.object(rc, "load_baseline", side_effect=AssertionError("baseline should not load")),
            patch("sys.stdout", out),
        ):
            code = rc.main(["--card", "abc", "--json", "--no-baseline"])
        payload = json.loads(out.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(payload["gap_counts"]["MISSING_cards"], 1)

    def test_same_file_id_present_and_scanned_has_no_card_id_false_flag(self):
        sheet_index = {"file-a": [presence("PASS", rc.ACTIVE)]}
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card("legacy-card-id")], sheet_index)
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["gaps"], [])

    def test_scanned_presence_does_not_hide_active_blank_presence(self):
        sheet_index = {
            "file-a": [
                presence("", rc.ACTIVE, 12),
                presence("PASS", rc.DORMANT, 14),
            ]
        }
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index)
        self.assertEqual(result["gap_counts"]["ACTIVE_UNSCANNED"], 1)

    def test_multi_row_blank_file_id_surfaces_if_any_presence_is_active(self):
        sheet_index = {
            "file-a": [
                presence("", rc.DORMANT, 12),
                presence("", rc.ACTIVE, 14),
            ]
        }
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], sheet_index)
        self.assertEqual(result["gap_counts"]["ACTIVE_UNSCANNED"], 1)

    def test_no_finished_file_ids_is_pending_not_gap(self):
        with patch.object(rc, "collect_finished_file_ids", return_value=set()):
            result = rc.reconcile([card()], {})
        self.assertEqual(result["gap_counts"], zero_counts())
        self.assertEqual(result["pending_cards"][0]["reason"], "no finished creative file IDs found")

    def test_sheet_index_header_resolves_compliance_assets_and_launch_state(self):
        headers = {
            "Meta Compliance Agent": 1,
            "ADMANAGE": 2,
            "E-0681 | Flower 2": 3,
            "E-0650 | Flower 2": 4,
            "Code": 5,
            "1x1": 6,
            "9x16": 8,
        }
        values = [
            ["Preview", "Meta Compliance Agent", "ADMANAGE", "E-0681 | Flower 2", "E-0650 | Flower 2", "Code", "1x1", "Other", "9x16"],
            ["", "PASS", "", "Active - 06/24/2026 - Ad ID: 1", "", "", "https://drive.google.com/file/d/file-a/view", "", ""],
            ["", "", "", "pending - 06/24/2026", "", "", "", "", "https://drive.google.com/file/d/file-b/view"],
        ]
        with patch.object(rc.engine, "_headers", return_value=headers), patch.object(rc.engine, "_read", return_value=values):
            index = rc.build_sheet_file_index(["IMAGES (Flower)"])
        self.assertEqual(index["file-a"][0], rc.SheetPresence("IMAGES (Flower)", 2, "PASS", rc.ACTIVE))
        self.assertEqual(index["file-b"][0], rc.SheetPresence("IMAGES (Flower)", 3, "", rc.PAUSED))

    def test_sheet_indexes_extracts_card_ids_and_actor_sheet_targets(self):
        target = rc.SheetTarget("actor-sheet-id", "VIDEOS", "Ashley Monroe::VIDEOS")
        headers = {
            "Meta Compliance Agent": 1,
            "ADMANAGE": 2,
            "E-0681 | Flower 2": 3,
            "Variant #": 4,
            "ClickUp Card ID": 5,
            "4x5": 6,
            "9x16": 7,
        }
        values = [
            ["P", "Meta Compliance Agent", "ADMANAGE", "E-0681 | Flower 2", "Variant #", "ClickUp Card ID", "4x5", "9x16"],
            ["", "PASS", "", "Active - 06/24/2026 - Ad ID: 1", "V01", "https://app.clickup.com/t/86e2b3fvx", "https://drive.google.com/file/d/file-a/view", ""],
            ["", "", "", "", "V02", "ab12cd34ef", "", "https://drive.google.com/file/d/file-b/view"],
        ]
        with patch.object(rc, "_headers_target", return_value=headers), patch.object(rc, "_read_target", return_value=values):
            file_index, card_index = rc.build_sheet_indexes([target])
        self.assertEqual(file_index["file-a"][0], rc.SheetPresence("Ashley Monroe::VIDEOS", 2, "PASS", rc.ACTIVE))
        self.assertEqual(card_index["86e2b3fvx"][0], rc.SheetCardPresence("Ashley Monroe::VIDEOS", 2))
        self.assertEqual(card_index["ab12cd34ef"][0], rc.SheetCardPresence("Ashley Monroe::VIDEOS", 3))

    def test_sheet_indexes_fail_loud_when_read_range_may_be_truncated(self):
        target = rc.SheetTarget("actor-sheet-id", "VIDEOS", "Ashley Monroe::VIDEOS")
        headers = {
            "Meta Compliance Agent": 1,
            "ADMANAGE": 2,
            "E-0681 | Flower 2": 3,
            "Variant #": 4,
            "ClickUp Card ID": 5,
            "4x5": 6,
        }
        values = [[""] * 7 for _ in range(4999)]
        values[0] = ["P", "Meta Compliance Agent", "ADMANAGE", "E-0681 | Flower 2", "Variant #", "ClickUp Card ID", "4x5"]
        values[-1][5] = "86e2b3fvx"
        with patch.object(rc, "_headers_target", return_value=headers), patch.object(rc, "_read_target", return_value=values):
            with self.assertRaisesRegex(RuntimeError, "population may be truncated"):
                rc.build_sheet_indexes([target])

    def test_default_sheet_targets_include_known_actor_sheets(self):
        labels = {target.label for target in rc.DEFAULT_SHEET_TARGETS}
        self.assertIn("Ashley Monroe::VIDEOS", labels)
        self.assertIn("Sarah's Finds::IMAGES", labels)

    def test_sheet_index_halts_without_launch_boundaries(self):
        headers = {"Meta Compliance Agent": 1, "1x1": 3, "9x16": 5}
        with patch.object(rc.engine, "_headers", return_value=headers):
            with self.assertRaisesRegex(RuntimeError, "missing header 'ADMANAGE'"):
                rc.build_sheet_file_index(["IMAGES (Flower)"])

    def test_launch_cols_detected_by_signature_not_code_header(self):
        # VIDEOS tabs have NO 'Code' header - the launch block ends at 'Variant #'.
        # Detection must be by the ' | ' account signature, not a fixed end-header.
        headers = {
            "Meta Compliance Agent": 1,
            "ADMANAGE": 2,
            "E-0681 | Flower 2": 3,
            "E-0930 | Flower 2": 4,
            "Variant #": 5,
            "1x1": 6,
            "9x16": 7,
        }
        values = [
            ["P", "Meta Compliance Agent", "ADMANAGE", "E-0681 | Flower 2", "E-0930 | Flower 2", "Variant #", "1x1", "9x16"],
            ["", "", "", "Active - 06/24/2026 - Ad ID: 1", "", "1", "https://drive.google.com/file/d/file-a/view", ""],
        ]
        with patch.object(rc.engine, "_headers", return_value=headers), patch.object(rc.engine, "_read", return_value=values):
            index = rc.build_sheet_file_index(["VIDEOS (Flower)"])
        self.assertEqual(index["file-a"][0], rc.SheetPresence("VIDEOS (Flower)", 2, "", rc.ACTIVE))

    def test_resolve_launch_cols_contiguous_run(self):
        headers = {"ADMANAGE": 2, "E-0681 | Flower 2": 3, "E-0930 | Flower 2": 4, "Variant #": 5, "Writer": 6}
        self.assertEqual(rc._resolve_launch_cols(headers), [3, 4])

    def test_sheet_index_halts_without_account_columns(self):
        # ADMANAGE present but the column after it is a content header (no ' | ' signature).
        headers = {"Meta Compliance Agent": 1, "ADMANAGE": 2, "Code": 3, "1x1": 4, "9x16": 5}
        with patch.object(rc.engine, "_headers", return_value=headers):
            with self.assertRaisesRegex(RuntimeError, "no per-account launch columns"):
                rc.build_sheet_file_index(["IMAGES (Flower)"])

    def test_render_markdown_includes_never_silent_exclusion_accounting(self):
        with patch.object(rc, "collect_finished_file_ids", return_value={"file-a"}):
            result = rc.reconcile([card()], {})
        rendered = rc.render_markdown(result)
        self.assertIn("raw 1 -> excluded [partial_card:0", rendered)
        self.assertIn("NEW gaps: 1 MISSING-cards", rendered)


if __name__ == "__main__":
    unittest.main()
