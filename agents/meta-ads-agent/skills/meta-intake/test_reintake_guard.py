#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import engine


IMAGE_HEADERS = {
    "Code": 1,
    "Description": 2,
    "Writer": 3,
    "Designer": 4,
    "ClickUp Card ID": 5,
    "1x1": 6,
    "9x16": 7,
    "Ad Name": 8,
}

VIDEO_HEADERS = {
    "Variant #": 1,
    "Actor": 2,
    "Hook #": 3,
    "Writer": 4,
    "Designer": 5,
    "ClickUp Card ID": 6,
    "4x5": 7,
    "9x16": 8,
    "Ad Name": 9,
}


def image_files():
    return [
        {"id": "old-1x1", "name": "1x1 - MB_CG_IMG_100_V1.jpg", "mimeType": "image/jpeg"},
        {"id": "old-9x16", "name": "9x16 - MB_CG_IMG_100_V1.jpg", "mimeType": "image/jpeg"},
        {"id": "new-1x1", "name": "1x1 - MB_CG_IMG_100_V2.jpg", "mimeType": "image/jpeg"},
        {"id": "new-9x16", "name": "9x16 - MB_CG_IMG_100_V2.jpg", "mimeType": "image/jpeg"},
    ]


def video_files():
    return [
        {"id": "old-4x5", "name": "UGC-1 - V01 - Helen - Hook 1 - 4x5.mp4", "mimeType": "video/mp4"},
        {"id": "old-9x16", "name": "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "mimeType": "video/mp4"},
        {"id": "new-4x5", "name": "UGC-1 - V02 - Helen - Hook 1 - 4x5.mp4", "mimeType": "video/mp4"},
        {"id": "new-9x16", "name": "UGC-1 - V02 - Helen - Hook 1 - 9x16.mp4", "mimeType": "video/mp4"},
    ]


def folder(fid, name):
    return {"id": fid, "name": name, "mimeType": "application/vnd.google-apps.folder"}


def vid(fid, name, modified):
    return {"id": fid, "name": name, "mimeType": "video/mp4", "modifiedTime": modified}


def img(fid, name):
    return {"id": fid, "name": name, "mimeType": "image/jpeg"}


def video_pair(stem, actor, variant=1, hook=1, modified="2026-06-01T00:00:00.000Z", prefix="UGC-1"):
    return [
        vid(f"{stem}-4x5", f"{prefix} - V{variant:02d} - {actor} - Hook {hook} - 4x5.mp4", modified),
        vid(f"{stem}-9x16", f"{prefix} - V{variant:02d} - {actor} - Hook {hook} - 9x16.mp4", modified),
    ]


def sheet_url(fid):
    return f"https://drive.google.com/file/d/{fid}/view?usp=drive_link"


def sheet_row(headers, values):
    row = [""] * (max(headers.values()) + 1)
    for key, value in values.items():
        row[headers[key]] = value
    return row


class FinishedFolderTests(unittest.TestCase):
    def test_newest_parseable_file_wins_even_without_finished_keyword(self):
        folders = {
            "root": [folder("finished", "Finished"), folder("new", "NEW Product Re-edit")],
            "finished": [vid("old", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "new": [vid("new", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-20T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("new", "NEW Product Re-edit"))

    def test_dnu_subfolders_and_files_are_excluded(self):
        folders = {
            "root": [folder("finished", "Finished"), folder("dnu", "Do Not Use"), folder("new", "NEW")],
            "finished": [vid("old", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "dnu": [vid("dnu", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-25T00:00:00.000Z")],
            "new": [vid("unused", "unused UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-24T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("finished", "Finished"))

    def test_recent_raw_clip_does_not_hijack_parseable_selection(self):
        folders = {
            "root": [folder("finished", "Finished"), folder("new", "NEW Product Re-edit")],
            "finished": [vid("old", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "new": [vid("raw", "Hook raw camera clip.mov", "2026-06-25T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("finished", "Finished"))

    def test_finished_wins_when_new_folder_has_only_non_parseable_names(self):
        folders = {
            "root": [folder("finished", "Finished"), folder("new", "NEW")],
            "finished": [vid("old", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "new": [vid("bad", "BrandonM3 export 9x16.mp4", "2026-06-25T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("finished", "Finished"))

    def test_no_parseable_files_falls_back_to_finished_keyword(self):
        folders = {
            "root": [folder("finished", "Finished"), folder("new", "NEW")],
            "finished": [vid("bad1", "Final render 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "new": [vid("bad2", "Raw camera clip.mov", "2026-06-25T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("finished", "Finished"))

    def test_no_parseable_files_and_no_keyword_returns_none(self):
        folders = {
            "root": [folder("new", "NEW")],
            "new": [vid("bad", "Raw camera clip.mov", "2026-06-25T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), (None, None))

    # --- v1.2.1: Axon-folder exclusion (Adam hard-rule 2026-06-25) ---
    def test_axon_subfolders_are_excluded_even_when_newest(self):
        # Axon-named folders are the AXON platform, NOT Meta: excluded despite a newer parseable file.
        folders = {
            "root": [folder("finished", "Finished"), folder("axon", "Axon Re-edit"), folder("axon2", "AxonFinished")],
            "finished": [vid("old", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "axon": [vid("a1", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-25T00:00:00.000Z")],
            "axon2": [vid("a2", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-24T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("finished", "Finished"))

    def test_axon_named_file_is_excluded_from_parseable_set(self):
        # an Axon-named FILE is dropped even inside a kept folder -> a clean (older) folder wins.
        folders = {
            "root": [folder("finished", "Finished"), folder("other", "Exports")],
            "finished": [vid("ax", "Axon UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-25T00:00:00.000Z")],
            "other": [vid("ok", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("other", "Exports"))

    def test_axon_does_not_false_drop_midword_actor_names(self):
        # "Saxon" contains "axon" mid-word (not at a word-start) -> NOT excluded; it wins over a newer real Axon folder.
        folders = {
            "root": [folder("saxon", "Saxon"), folder("axon", "Axon")],
            "saxon": [vid("s", "UGC-1 - V01 - Saxon - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "axon": [vid("a", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-25T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("saxon", "Saxon"))

    def test_axon_only_deliverable_returns_none(self):
        # if the ONLY parseable deliverable lives in an Axon folder -> None (intake then flags not-ready), never picked.
        folders = {
            "root": [folder("axon", "Axon Finished")],
            "axon": [vid("a", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-25T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), (None, None))

    def test_picks_newest_plain_folder_over_old_and_disclaimer(self):
        # Adam 2026-06-26: Meta = the NEWEST PLAIN cut, NOT old re-edit, NOT disclaimer.
        # The disclaimer folder has the NEWEST mtime but is excluded; among plain folders the newest wins (not the old).
        folders = {
            "root": [folder("old", "Finished Old"), folder("new", "Finished New"), folder("disc", "Disclaimer")],
            "old": [vid("o", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z")],
            "new": [vid("n", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-20T00:00:00.000Z")],
            "disc": [vid("d", "UGC-1 - V01 - Helen - Hook 1 - 9x16 - Disclaimer.mp4", "2026-06-26T00:00:00.000Z")],
        }
        with patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
            self.assertEqual(engine._find_finished_folder("root"), ("new", "Finished New"))


class ReintakeGuardTests(unittest.TestCase):
    def test_image_partial_present_new_variant_returns_guard_without_confirm(self):
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()), \
             patch.object(engine, "_ids_on_tab", return_value={"old-1x1"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_preflight_empty") as preflight:
            result = engine.intake_image_card("card-a", "folder", "IMAGES", "WR", "DS", "desc")
        self.assertEqual(result["status"], "RE_INTAKE_GUARD")
        self.assertEqual(result["fresh"], ["IMG_100_V2"])
        self.assertEqual(result["fresh_file_ids"], ["new-1x1", "new-9x16"])
        self.assertEqual(result["present_file_ids"], ["old-1x1"])
        preflight.assert_not_called()

    def test_image_confirm_reintake_allows_ready_plan(self):
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()), \
             patch.object(engine, "_ids_on_tab", return_value={"old-1x1"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_image_card(
                "card-a", "folder", "IMAGES", "WR", "DS", "desc", confirm_reintake=True
            )
        self.assertEqual(result["status"], "READY")
        self.assertEqual([row["code"] for row in result["rows"]], ["IMG_100_V2"])
        self.assertEqual(result["dup_skipped"], ["IMG_100_V1"])

    def test_first_time_multi_variant_image_does_not_guard(self):
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_image_card("card-a", "folder", "IMAGES", "WR", "DS", "desc")
        self.assertEqual(result["status"], "READY")
        self.assertEqual(len(result["rows"]), 2)

    def test_first_time_card_id_not_on_tab_does_not_guard(self):
        values = [
            ["", "", "", "", "", "ClickUp Card ID", "1x1", "9x16"],
            ["", "", "", "", "", "othercard", sheet_url("old-1x1"), sheet_url("old-9x16")],
        ]
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value={"old-1x1", "old-9x16"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=values), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_image_card("carda", "folder", "IMAGES", "WR", "DS", "desc")
        self.assertEqual(result["status"], "READY")

    def test_card_id_already_on_tab_with_different_assets_returns_guard(self):
        values = [
            ["", "", "", "", "", "ClickUp Card ID", "1x1", "9x16"],
            ["", "", "", "", "", "https://app.clickup.com/t/carda", sheet_url("old-1x1"), sheet_url("old-9x16")],
        ]
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value={"old-1x1", "old-9x16"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=values), \
             patch.object(engine, "_preflight_empty") as preflight:
            result = engine.intake_image_card("carda", "folder", "IMAGES", "WR", "DS", "desc")
        self.assertEqual(result["status"], "RE_INTAKE_GUARD")
        self.assertEqual(result["prior_row_numbers"], [2])
        self.assertEqual(result["prior_file_ids"], ["old-1x1", "old-9x16"])
        self.assertIn("already on IMAGES rows [2] with different assets", result["reason"])
        preflight.assert_not_called()

    def test_card_id_already_on_tab_confirm_allows_ready_plan(self):
        values = [
            ["", "", "", "", "", "ClickUp Card ID", "1x1", "9x16"],
            ["", "", "", "", "", "carda", sheet_url("old-1x1"), sheet_url("old-9x16")],
        ]
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value={"old-1x1", "old-9x16"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=values), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_image_card(
                "carda", "folder", "IMAGES", "WR", "DS", "desc", confirm_reintake=True
            )
        self.assertEqual(result["status"], "READY")
        self.assertEqual([row["code"] for row in result["rows"]], ["IMG_100_V2"])

    def test_completed_card_with_new_image_files_guards_even_without_present_ids(self):
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=True):
            result = engine.intake_image_card("card-a", "folder", "IMAGES", "WR", "DS", "desc")
        self.assertEqual(result["status"], "RE_INTAKE_GUARD")
        self.assertTrue(result["already_complete"])
        self.assertEqual(result["present_file_ids"], [])

    def test_retargets_ad_name_formula_cell_rows_only(self):
        formula = '=Y10&" - "&Z10&" fixed 10"&$AA$10&TEXT(TODAY(),"MM-DD-YYYY")'
        self.assertEqual(
            engine._retarget_formula_row(formula, 10, 11),
            '=Y11&" - "&Z11&" fixed 10"&$AA$11&TEXT(TODAY(),"MM-DD-YYYY")',
        )

    def test_image_append_writes_ad_name_formula_and_gates_readback(self):
        formula_neighbors = [[] for _ in range(8)] + [['=B10&" - "&F10']]
        readback = [sheet_row(IMAGE_HEADERS, {
            "Code": "IMG_100_V2",
            "1x1": sheet_url("new-1x1"),
            "9x16": sheet_url("new-9x16"),
            "Ad Name": "IMG 100 - ID=card-a",
        })]
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")), \
             patch.object(engine, "_read_formula", return_value=formula_neighbors), \
             patch.object(engine, "_read", return_value=readback), \
             patch.object(engine, "_write_multi") as write_multi, \
             patch.object(engine, "_share", return_value=(2, 2)), \
             patch.object(engine, "_thumbs", return_value=[True]):
            result = engine.intake_image_card("card-a", "folder", "IMAGES", "WR", "DS", "desc", dry_run=False)
        self.assertTrue(result["all_ok"])
        blocks = dict(write_multi.call_args.args[1])
        self.assertEqual(blocks["I11"], [['=B11&" - "&F11']])

    def test_image_readback_requires_ad_name_ok(self):
        formula_neighbors = [[] for _ in range(8)] + [['=B10&" - "&F10']]
        readback = [sheet_row(IMAGE_HEADERS, {
            "Code": "IMG_100_V2",
            "1x1": sheet_url("new-1x1"),
            "9x16": sheet_url("new-9x16"),
            "Ad Name": "",
        })]
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=image_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")), \
             patch.object(engine, "_read_formula", return_value=formula_neighbors), \
             patch.object(engine, "_read", return_value=readback), \
             patch.object(engine, "_write_multi"), \
             patch.object(engine, "_share", return_value=(2, 2)), \
             patch.object(engine, "_thumbs", return_value=[True]):
            result = engine.intake_image_card("card-a", "folder", "IMAGES", "WR", "DS", "desc", dry_run=False)
        self.assertFalse(result["all_ok"])
        self.assertFalse(result["readback"][0]["adname_ok"])

    def test_video_partial_present_new_variant_returns_guard_without_confirm(self):
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_find_finished_folder", return_value=("finished", "Finished")), \
             patch.object(engine, "_list_folder", return_value=video_files()), \
             patch.object(engine, "_ids_on_tab", return_value={"old-4x5"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_preflight_empty") as preflight:
            result = engine.intake_video_card("card-v", "folder", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "RE_INTAKE_GUARD")
        self.assertEqual(result["fresh"], ["Helen V02 H1"])
        self.assertEqual(result["fresh_file_ids"], ["new-4x5", "new-9x16"])
        preflight.assert_not_called()

    def test_video_confirm_reintake_allows_ready_plan(self):
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_find_finished_folder", return_value=("finished", "Finished")), \
             patch.object(engine, "_list_folder", return_value=video_files()), \
             patch.object(engine, "_ids_on_tab", return_value={"old-4x5"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card(
                "card-v", "folder", "VIDEOS", "WR", "DS", confirm_reintake=True
            )
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["rows"][0]["variant"], "V02")
        self.assertEqual(result["dup_skipped"], ["V1H1"])

    def test_video_append_writes_ad_name_formula_and_gates_readback(self):
        formula_neighbors = [[] for _ in range(8)] + [['=B10&" - "&F10']]
        readback = [sheet_row(VIDEO_HEADERS, {
            "Variant #": "V02",
            "4x5": sheet_url("new-4x5"),
            "9x16": sheet_url("new-9x16"),
            "Ad Name": "V02 - Helen - ID=card-v",
        })]
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_find_finished_folder", return_value=("finished", "Finished")), \
             patch.object(engine, "_list_folder", return_value=video_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")), \
             patch.object(engine, "_read_formula", return_value=formula_neighbors), \
             patch.object(engine, "_read", return_value=readback), \
             patch.object(engine, "_write_multi") as write_multi, \
             patch.object(engine, "_share", return_value=(2, 2)), \
             patch.object(engine, "_thumbs", return_value=[True]):
            result = engine.intake_video_card("card-v", "folder", "VIDEOS", "WR", "DS", dry_run=False)
        self.assertTrue(result["all_ok"])
        blocks = dict(write_multi.call_args.args[1])
        self.assertEqual(blocks["J11"], [['=B11&" - "&F11']])

    def test_video_readback_requires_ad_name_ok(self):
        formula_neighbors = [[] for _ in range(8)] + [['=B10&" - "&F10']]
        readback = [sheet_row(VIDEO_HEADERS, {
            "Variant #": "V02",
            "4x5": sheet_url("new-4x5"),
            "9x16": sheet_url("new-9x16"),
            "Ad Name": "",
        })]
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_find_finished_folder", return_value=("finished", "Finished")), \
             patch.object(engine, "_list_folder", return_value=video_files()[2:]), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")), \
             patch.object(engine, "_read_formula", return_value=formula_neighbors), \
             patch.object(engine, "_read", return_value=readback), \
             patch.object(engine, "_write_multi"), \
             patch.object(engine, "_share", return_value=(2, 2)), \
             patch.object(engine, "_thumbs", return_value=[True]):
            result = engine.intake_video_card("card-v", "folder", "VIDEOS", "WR", "DS", dry_run=False)
        self.assertFalse(result["all_ok"])
        self.assertFalse(result["readback"][0]["adname_ok"])

    def test_video_axon_subfolder_inside_picked_folder_skipped_during_collection(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [*video_pair("real", "Helen"), folder("axon", "AXON")],
            "axon": video_pair("axon", "Raymond", modified="2026-06-25T00:00:00.000Z"),
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            self.assertEqual(engine._find_finished_folder("root"), ("finished", "Finished"))
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"], row["hook"]) for row in result["rows"]], [("Helen", "V01", "H1")])

    def test_video_axon_grandparent_depth2_and_depth3_files_are_excluded(self):
        cases = {
            "depth2": {
                "root": [folder("finished", "Finished")],
                "finished": [folder("axon", "AXON")],
                "axon": video_pair("nested", "Raymond"),
            },
            "depth3": {
                "root": [folder("finished", "Finished")],
                "finished": [folder("axon", "AXON")],
                "axon": [folder("raymond", "Raymond")],
                "raymond": video_pair("nested", "Raymond"),
            },
        }
        for label, folders in cases.items():
            with self.subTest(label=label), \
                 patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
                 patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])):
                result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
            self.assertEqual(result["status"], "EMPTY_FOLDER")

    def test_video_axon_named_file_directly_in_non_axon_folder_is_excluded(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [
                *video_pair("real", "Helen"),
                vid("axon-4x5", "AXON UGC-1 - V02 - Raymond - Hook 1 - 4x5.mp4", "2026-06-25T00:00:00.000Z"),
                vid("axon-9x16", "AXON UGC-1 - V02 - Raymond - Hook 1 - 9x16.mp4", "2026-06-25T00:00:00.000Z"),
            ],
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"]) for row in result["rows"]], [("Helen", "V01")])

    def test_video_disclaimer_subfolder_inside_picked_folder_is_excluded(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [
                folder("disclaimer", "Disclaimer"),
                vid("plain-4x5", "UGC-1 - V01 - Helen - Hook 1 - 4x5.mp4", "2026-06-01T00:00:00.000Z"),
                vid("plain-9x16", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z"),
            ],
            "disclaimer": [
                vid("disclaimer-9x16", "UGC-1 - V01 - Helen - Hook 1 - 9x16 - Disclaimer.mp4", "2026-06-25T00:00:00.000Z"),
            ],
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value={"disclaimer-9x16"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"], row["hook"]) for row in result["rows"]], [("Helen", "V01", "H1")])

    def test_video_disclaimer_named_file_directly_in_picked_folder_is_excluded(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [
                vid("plain-4x5", "UGC-1 - V01 - Helen - Hook 1 - 4x5.mp4", "2026-06-01T00:00:00.000Z"),
                vid("disclaimer-9x16", "UGC-1 - V01 - Helen - Hook 1 - 9x16_disclaimer.mp4", "2026-06-25T00:00:00.000Z"),
                vid("plain-9x16", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4", "2026-06-01T00:00:00.000Z"),
            ],
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value={"disclaimer-9x16"}), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"], row["hook"]) for row in result["rows"]], [("Helen", "V01", "H1")])

    def test_video_with_disclaimer_subfolder_is_excluded(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [
                *video_pair("real", "Helen"),
                folder("with-disclaimer", "with-disclaimer"),
            ],
            "with-disclaimer": [
                vid("pathb-4x5", "UGC-1 - V02 - Raymond - Hook 1 - 4x5.mp4", "2026-06-25T00:00:00.000Z"),
                vid("pathb-9x16", "UGC-1 - V02 - Raymond - Hook 1 - 9x16 - with-disclaimer-pathB-final.mp4", "2026-06-25T00:00:00.000Z"),
            ],
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"], row["hook"]) for row in result["rows"]], [("Helen", "V01", "H1")])

    def test_video_plain_double_mp4_extension_is_kept(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [
                vid("plain-4x5", "UGC-1 - V01 - Helen - Hook 1 - 4x5.mp4", "2026-06-01T00:00:00.000Z"),
                vid("plain-9x16", "UGC-1 - V01 - Helen - Hook 1 - 9x16.mp4.mp4", "2026-06-01T00:00:00.000Z"),
            ],
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"], row["hook"]) for row in result["rows"]], [("Helen", "V01", "H1")])

    def test_normal_non_disclaimer_non_axon_video_card_collects_unchanged(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": video_pair("real", "Sofia", variant=2, hook=3),
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"], row["hook"]) for row in result["rows"]], [("Sofia", "V02", "H3")])

    def test_image_axon_and_dnu_named_files_leave_missing_variants_unparsed(self):
        files = [
            img("axon-v1-1x1", "AXON 1x1 - MB_CG_IMG_100_V1.jpg"),
            img("real-v1-9x16", "9x16 - MB_CG_IMG_100_V1.jpg"),
            img("real-v2-1x1", "1x1 - MB_CG_IMG_100_V2.jpg"),
            img("axon-v2-9x16", "AXON 9x16 - MB_CG_IMG_100_V2.jpg"),
            img("dnu-v4-1x1", "DNU 1x1 - MB_CG_IMG_100_V4.jpg"),
            img("real-v4-9x16", "9x16 - MB_CG_IMG_100_V4.jpg"),
            img("real-v3-1x1", "1x1 - MB_CG_IMG_100_V3.jpg"),
            img("real-v3-9x16", "9x16 - MB_CG_IMG_100_V3.jpg"),
        ]
        with patch.object(engine, "_headers", return_value=IMAGE_HEADERS), \
             patch.object(engine, "_list_folder", return_value=files), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_image_card("card-a", "folder", "IMAGES", "WR", "DS", "desc")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([row["code"] for row in result["rows"]], ["IMG_100_V3"])
        self.assertEqual(result["unparsed"], ["V1 missing 1x1 or 9x16", "V2 missing 1x1 or 9x16", "V4 missing 1x1 or 9x16"])

    def test_normal_non_axon_video_nested_card_collects_unchanged(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [folder("raymond", "Raymond")],
            "raymond": video_pair("nested", "Raymond"),
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"], row["hook"]) for row in result["rows"]], [("Raymond", "V01", "H1")])

    def test_dnu_subfolder_and_file_excluded_during_video_collection(self):
        folders = {
            "root": [folder("finished", "Finished")],
            "finished": [
                *video_pair("real", "Helen"),
                folder("dnu", "Do Not Use"),
                vid("dnu-file-4x5", "DNU UGC-1 - V02 - Raymond - Hook 1 - 4x5.mp4", "2026-06-25T00:00:00.000Z"),
                vid("dnu-file-9x16", "DNU UGC-1 - V02 - Raymond - Hook 1 - 9x16.mp4", "2026-06-25T00:00:00.000Z"),
            ],
            "dnu": video_pair("dnu-folder", "Sofia", variant=3, modified="2026-06-25T00:00:00.000Z"),
        }
        with patch.object(engine, "_headers", return_value=VIDEO_HEADERS), \
             patch.object(engine, "_list_folder", side_effect=lambda fid: folders.get(fid, [])), \
             patch.object(engine, "_ids_on_tab", return_value=set()), \
             patch.object(engine, "_posted_to_sheet_status", return_value=False), \
             patch.object(engine, "_read", return_value=[[]]), \
             patch.object(engine, "_max_nonempty", return_value=10), \
             patch.object(engine, "_preflight_empty", return_value=(True, "ok")):
            result = engine.intake_video_card("card-v", "root", "VIDEOS", "WR", "DS")
        self.assertEqual(result["status"], "READY")
        self.assertEqual([(row["actor"], row["variant"]) for row in result["rows"]], [("Helen", "V01")])


if __name__ == "__main__":
    unittest.main()
