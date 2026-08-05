#!/usr/bin/env python3
import contextlib
import io
import subprocess
import sys
import unittest
from unittest.mock import patch

import intake_completeness_check as check


IMAGE_HEADERS = ["Preview", "Code", "ClickUp Card ID", "1x1", "9x16", "Actor Age Bracket", "Gender"]
VIDEO_HEADERS = [
    "Preview",
    "Variant #",
    "Actor",
    "Hook #",
    "Writer",
    "Designer",
    "ClickUp Card ID",
    "4x5",
    "9x16",
    "Ad Name",
    "Actor Age Bracket",
    "Gender",
]


def col_index(letter):
    n = 0
    for ch in letter:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def cells_to_row(cells, row):
    values = []
    max_idx = -1
    for cell, render in cells:
        if render is not None:
            continue
        m = __import__("re").match(r"([A-Z]+)(\d+)$", cell)
        if not m or int(m.group(2)) != row:
            continue
        max_idx = max(max_idx, col_index(m.group(1)))
    if max_idx < 0:
        return "No data found"
    values = [""] * (max_idx + 1)
    for (cell, render), value in cells.items():
        if render is not None:
            continue
        m = __import__("re").match(r"([A-Z]+)(\d+)$", cell)
        if not m or int(m.group(2)) != row:
            continue
        values[col_index(m.group(1))] = value
    while values and values[-1] == "":
        values.pop()
    return "\t".join(values) if values else "No data found"


def make_getter(headers, cells):
    def fake_getter(ss, rng, account, render=None):
        if rng.endswith("!1:1"):
            return "\t".join(headers)
        cell = rng.split("!", 1)[1]
        if ":" in cell and render is None:
            row = int(cell.split(":", 1)[0])
            return cells_to_row(cells, row)
        key = (cell, render)
        if key in cells:
            return cells[key]
        return cells.get((cell, None), "")
    return fake_getter


def hmap(headers, schema):
    required = check.required_headers_for(schema)
    if schema == "video":
        required = [*required, "Ad Name"]
    return check.header_map(headers, required)


def image_complete_cells():
    return {
        ("A2", "FORMULA"): '=IMAGE("https://drive.google.com/thumbnail?id=file123&sz=w1000")',
        ("B2", None): "IMG_100_V1",
        ("C2", None): "https://app.clickup.com/t/card",
        ("D2", None): "https://drive.google.com/file/d/one/view",
        ("E2", None): "https://drive.google.com/file/d/nine/view",
        ("F2", None): "35-44",
        ("G2", None): "Female",
    }


def video_complete_cells(ad_name="V01 - Actor - H1", writer="", designer=""):
    return {
        ("A2", "FORMULA"): '=IMAGE("https://drive.google.com/thumbnail?id=file123&sz=w1000")',
        ("B2", None): "V01",
        ("C2", None): "Tanya",
        ("D2", None): "H1",
        ("E2", None): writer,
        ("F2", None): designer,
        ("G2", None): "https://app.clickup.com/t/card",
        ("H2", None): "https://drive.google.com/file/d/four/view",
        ("I2", None): "https://drive.google.com/file/d/nine/view",
        ("J2", None): ad_name,
        ("J2", "FORMATTED_VALUE"): ad_name,
        ("K2", None): "35-44",
        ("L2", None): "Female",
    }


class CompletenessCheckTests(unittest.TestCase):
    def test_gog_get_returns_value_on_zero_rc(self):
        cp = subprocess.CompletedProcess(["gog"], 0, stdout="No data found\n", stderr="")
        with patch.object(check.subprocess, "run", return_value=cp):
            self.assertEqual(check.gog_get("ss", "Tab!A2", "acct"), "No data found")

    def test_gog_get_raises_on_nonzero_rc_with_range_and_stderr(self):
        cp = subprocess.CompletedProcess(["gog"], 1, stdout="", stderr="Google API error (400 badRequest): bad range")
        with patch.object(check.subprocess, "run", return_value=cp):
            with self.assertRaisesRegex(RuntimeError, r"Tab!A2.*400 badRequest"):
                check.gog_get("ss", "Tab!A2", "acct")

    def test_gog_get_retries_transient_then_returns_value(self):
        first = subprocess.CompletedProcess(["gog"], 1, stdout="", stderr="Google API error: 429 rate limit")
        second = subprocess.CompletedProcess(["gog"], 0, stdout="ok\n", stderr="")
        with patch.object(check.subprocess, "run", side_effect=[first, second]) as run, \
             patch.object(check.time, "sleep") as sleep:
            self.assertEqual(check.gog_get("ss", "Tab!A2", "acct"), "ok")
        self.assertEqual(run.call_count, 2)
        sleep.assert_called_once()

    def test_gog_get_nontransient_does_not_retry(self):
        cp = subprocess.CompletedProcess(["gog"], 1, stdout="", stderr="Google API error (400 badRequest): bad range")
        with patch.object(check.subprocess, "run", return_value=cp) as run:
            with self.assertRaises(RuntimeError):
                check.gog_get("ss", "Tab!A2", "acct")
        self.assertEqual(run.call_count, 1)

    def test_gog_get_transient_exhaustion_raises_after_bounded_attempts(self):
        cp = subprocess.CompletedProcess(["gog"], 1, stdout="", stderr="Google API error: quota exceeded")
        with patch.object(check.subprocess, "run", return_value=cp) as run, \
             patch.object(check.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "quota exceeded"):
                check.gog_get("ss", "Tab!A2", "acct")
        self.assertEqual(run.call_count, 3)

    def test_schema_auto_detects_image_and_video(self):
        self.assertEqual(check.detect_schema(IMAGE_HEADERS), "image")
        self.assertEqual(check.detect_schema(VIDEO_HEADERS), "video")

    def test_schema_auto_detect_halts_for_neither_or_both(self):
        self.assertIsNone(check.detect_schema(["Preview", "Writer"]))
        self.assertIsNone(check.detect_schema(["Preview", "Code", "1x1", "Variant #", "4x5"]))

    def test_video_complete_row_passes(self):
        getter = make_getter(VIDEO_HEADERS, video_complete_cells())
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, [])

    def test_video_missing_required_cell_fails_named_field(self):
        cells = video_complete_cells()
        cells[("C2", None)] = ""
        getter = make_getter(VIDEO_HEADERS, cells)
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertIn("Actor(C) blank", problems)

    def test_batched_short_row_reports_trailing_required_cells_blank(self):
        cells = video_complete_cells()
        for key in [("K2", None), ("L2", None)]:
            cells.pop(key)
        getter = make_getter(VIDEO_HEADERS, cells)
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertIn("Actor Age Bracket(K) blank", problems)
        self.assertIn("Gender(L) blank", problems)

    def test_batched_whole_row_no_data_reports_required_cells_blank(self):
        cells = {
            ("A2", "FORMULA"): '=IMAGE("https://drive.google.com/thumbnail?id=file123&sz=w1000")',
            ("J2", "FORMATTED_VALUE"): "V01 ad",
        }
        getter = make_getter(VIDEO_HEADERS, cells)
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertIn("Variant #(B) blank", problems)
        self.assertIn("Gender(L) blank", problems)

    def test_batched_row_uses_two_letter_header_indexes(self):
        headers = [""] * (col_index("BH") + 1)
        placements = {
            "Preview": "A",
            "Variant #": "B",
            "Actor": "C",
            "Hook #": "D",
            "ClickUp Card ID": "E",
            "4x5": "F",
            "9x16": "G",
            "Ad Name": "H",
            "Gender": "I",
            "Actor Age Bracket": "BH",
        }
        for name, letter in placements.items():
            headers[col_index(letter)] = name

        cells = {
            ("A2", "FORMULA"): '=IMAGE("https://drive.google.com/thumbnail?id=file123&sz=w1000")',
            ("B2", None): "V01",
            ("C2", None): "Tanya",
            ("D2", None): "H1",
            ("E2", None): "https://app.clickup.com/t/card",
            ("F2", None): "https://drive.google.com/file/d/four/view",
            ("G2", None): "https://drive.google.com/file/d/nine/view",
            ("H2", None): "CG V01 - Tanya - H1",
            ("H2", "FORMATTED_VALUE"): "CG V01 - Tanya - H1",
            ("I2", None): "Female",
            ("BH2", None): "35-44",
        }
        getter = make_getter(headers, cells)
        required = [*check.required_headers_for("video"), "Ad Name"]
        problems = check.check_row(
            "VIDEOS",
            2,
            "video",
            check.header_map(headers, required),
            getter,
            "acct",
            no_thumb=True,
            imap=check.header_indexes(headers, required),
        )
        self.assertEqual(problems, [])

        cells.pop(("BH2", None))
        problems = check.check_row(
            "VIDEOS",
            2,
            "video",
            check.header_map(headers, required),
            getter,
            "acct",
            no_thumb=True,
            imap=check.header_indexes(headers, required),
        )
        self.assertIn("Actor Age Bracket(BH) blank", problems)

    def test_video_degenerate_ad_name_without_variant_fails(self):
        skeleton = " -  -  -  - W= - D= - ID= - hp= - lp= - 08-04-2026"
        getter = make_getter(VIDEO_HEADERS, video_complete_cells(ad_name=skeleton))
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, ["Ad Name(J) blank/degenerate - does not contain Variant# 'V01'"])

    def test_video_empty_ad_name_fails(self):
        getter = make_getter(VIDEO_HEADERS, video_complete_cells(ad_name=""))
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, ["Ad Name(J) blank/degenerate - does not contain Variant# 'V01'"])

    def test_video_formula_error_ad_name_fails(self):
        getter = make_getter(VIDEO_HEADERS, video_complete_cells(ad_name="#REF!"))
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, ["Ad Name(J) blank/degenerate - does not contain Variant# 'V01'"])

    def test_video_name_formula_error_ad_name_fails(self):
        getter = make_getter(VIDEO_HEADERS, video_complete_cells(ad_name="#NAME?"))
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, ["Ad Name(J) blank/degenerate - does not contain Variant# 'V01'"])

    def test_video_good_ad_name_contains_variant_passes(self):
        getter = make_getter(VIDEO_HEADERS, video_complete_cells(ad_name="CG V01 - Tanya - H1"))
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, [])

    def test_video_blank_writer_designer_do_not_fail(self):
        getter = make_getter(VIDEO_HEADERS, video_complete_cells(writer="", designer=""))
        problems = check.check_row("VIDEOS", 2, "video", hmap(VIDEO_HEADERS, "video"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, [])

    def test_image_regression_complete_row_passes_without_ad_name(self):
        getter = make_getter(IMAGE_HEADERS, image_complete_cells())
        problems = check.check_row("IMAGES", 2, "image", hmap(IMAGE_HEADERS, "image"), getter, "acct", no_thumb=True)
        self.assertEqual(problems, [])

    def test_main_halts_exit_2_on_read_error_not_incomplete_or_blank(self):
        # Negative control: the old gog_get error-swallow path would return "" here,
        # print INCOMPLETE with a blank field, and exit 1 instead of HALT exit 2.
        def fake_gog(ss, rng, account, render=None):
            if rng.endswith("!1:1"):
                return "\t".join(VIDEO_HEADERS)
            if rng.endswith("!A2"):
                return '=IMAGE("https://drive.google.com/thumbnail?id=file123&sz=w1000")'
            raise RuntimeError("gog read failed for VIDEOS!2:2 (rc=1): 429 rate limit")

        out = io.StringIO()
        with patch.object(check, "gog_get", side_effect=fake_gog), \
             patch.object(sys, "argv", ["intake_completeness_check.py", "VIDEOS", "2", "--no-thumb"]), \
             contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as cm:
                check.main()
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("HALT: read error on row 2", out.getvalue())
        self.assertNotIn("INCOMPLETE", out.getvalue())
        self.assertNotIn("blank", out.getvalue())

    def test_main_halts_exit_2_when_real_gog_get_sees_subprocess_error(self):
        # Negative control: the old gog_get ignored rc and would turn this 429
        # row-read failure into an empty row, then exit 1 INCOMPLETE.
        def fake_run(cmd, capture_output=True, text=True):
            rng = cmd[4]
            if rng.endswith("!1:1"):
                return subprocess.CompletedProcess(cmd, 0, stdout="\t".join(VIDEO_HEADERS) + "\n", stderr="")
            if rng.endswith("!A2"):
                formula = '=IMAGE("https://drive.google.com/thumbnail?id=file123&sz=w1000")\n'
                return subprocess.CompletedProcess(cmd, 0, stdout=formula, stderr="")
            if rng.endswith("!2:2"):
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="429 rate limit")
            self.fail(f"unexpected gog range {rng}")

        out = io.StringIO()
        with patch.object(check.subprocess, "run", side_effect=fake_run), \
             patch.object(check.time, "sleep"), \
             patch.object(sys, "argv", ["intake_completeness_check.py", "VIDEOS", "2", "--no-thumb"]), \
             contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as cm:
                check.main()
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("HALT: read error on row 2", out.getvalue())
        self.assertNotIn("INCOMPLETE", out.getvalue())
        self.assertNotIn("blank", out.getvalue())

    def test_main_genuine_blank_still_exits_1_incomplete(self):
        cells = video_complete_cells()
        cells[("C2", None)] = ""
        getter = make_getter(VIDEO_HEADERS, cells)
        out = io.StringIO()
        with patch.object(check, "gog_get", side_effect=getter), \
             patch.object(sys, "argv", ["intake_completeness_check.py", "VIDEOS", "2", "--no-thumb"]), \
             contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as cm:
                check.main()
        self.assertEqual(cm.exception.code, 1)
        self.assertIn("INCOMPLETE", out.getvalue())
        self.assertIn("Actor(C) blank", out.getvalue())


if __name__ == "__main__":
    unittest.main()
