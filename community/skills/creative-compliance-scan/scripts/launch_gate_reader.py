#!/usr/bin/env python3
"""Single-column launch-gate sheet reader.

Reads only the trusted Meta Compliance Agent verdict cell. Copy text is not a
launch-gate surface under the folded single-column contract.
"""
import json
import os
import subprocess

from launch_gate import CREATIVE_HEADER, SHEET_ID, launch_gate_single


ROW_KEY_HEADERS = ("Ad Name", "ClickUp Card ID", "Code", "Variant #")
TABS = (
    "IMAGES (Flower)",
    "VIDEOS (Flower)",
    "IMAGES (Sleep Gummies)",
    "VIDEOS (Sleep Gummies)",
)
GOG_ACCOUNT = os.environ.get("GOG_ACCOUNT", "adam@cleangreen.com")
GOG_BIN = os.environ.get("GOG_BIN", "gog")


class SheetReadError(RuntimeError):
    pass


def _gog_fetch(tab):
    sheet_range = f"'{tab}'!A:ZZ"
    cmd = [
        GOG_BIN,
        "sheets",
        "get",
        SHEET_ID,
        sheet_range,
        "--account",
        GOG_ACCOUNT,
        "-j",
    ]
    try:
        proc = subprocess.run(cmd, text=True, capture_output=True, check=False)
    except Exception as exc:
        raise SheetReadError(f"gog fetch failed for {tab}: {exc}") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise SheetReadError(f"gog fetch failed for {tab}: {detail[:300]}")
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise SheetReadError(f"gog fetch returned invalid JSON for {tab}") from exc
    values = payload.get("values") if isinstance(payload, dict) else None
    if not values:
        raise SheetReadError(f"gog fetch returned no rows for {tab}")
    return values


def _fetch_tab_values(tab, fetch_fn=_gog_fetch):
    try:
        values = fetch_fn(tab)
    except SheetReadError:
        raise
    except Exception as exc:
        raise SheetReadError(f"sheet fetch failed for {tab}: {exc}") from exc
    if not values:
        raise SheetReadError(f"sheet fetch returned no rows for {tab}")
    return values


def resolve_header_index(header_row, name):
    for idx, cell in enumerate(header_row or []):
        if str(cell).strip() == name:
            return idx
    return None


def resolve_row_key_index(header_row):
    for name in ROW_KEY_HEADERS:
        idx = resolve_header_index(header_row, name)
        if idx is not None:
            return idx
    return None


def _cell_at(row, idx):
    if idx is None or idx >= len(row):
        return ""
    return row[idx]


def read_creative_cell(ad_key, tab, fetch_fn=_gog_fetch):
    values = _fetch_tab_values(tab, fetch_fn=fetch_fn)
    header = values[0] if values else []
    creative_idx = resolve_header_index(header, CREATIVE_HEADER)
    row_key_idx = resolve_row_key_index(header)
    if creative_idx is None or row_key_idx is None:
        return None
    target = str(ad_key).strip()
    for row in values[1:]:
        if str(_cell_at(row, row_key_idx)).strip() == target:
            return _cell_at(row, creative_idx)
    return None


def gate_ad(ad_key, tab, fetch_fn=_gog_fetch):
    try:
        cell = read_creative_cell(ad_key, tab, fetch_fn=fetch_fn)
    except SheetReadError:
        cell = None
    return launch_gate_single(cell or "")
