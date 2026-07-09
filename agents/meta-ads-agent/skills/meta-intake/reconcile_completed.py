#!/usr/bin/env python3
"""Zero-model completed-card to sheet reconciliation for Meta intake.

Checks completed ClickUp cards against the upload sheet by Drive file ID only:
- MISSING: no finished creative file IDs from the completed card are on the sheet.
- UNSCANNED: a sheet row has a blank Meta Compliance Agent verdict and active/ambiguous launch state.

Card IDs are metadata only. They are never used as the reconciliation key.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable

import engine
import resolve_cards


COMPLIANCE_HEADER = "Meta Compliance Agent"
ADMANAGE_HEADER = "ADMANAGE"
ACCOUNT_HEADER_SIGNATURE = " | "  # every per-account launch header is 'ShortName | descriptor'
DEFAULT_BASELINE_PATH = os.path.expanduser("~/.cortextos/default/state/meta-ads-agent/reconcile-baseline.json")
NON_AD_FOLDER_RE = re.compile(r"b-?roll|raw|selects?|project files?|working|archive", re.I)
EXCLUDED_KEYS = (
    "partial_card",
    "non_ad_folder",
    "dormant_unscanned",
    "paused_unscanned",
    "baseline_dropped_fail",
    "baseline_testimonial",
    "ended_zero_spend",
    "adam_cleared",
)
ACTIVE = "ACTIVE"
AMBIGUOUS = "AMBIGUOUS"
PAUSED = "PAUSED"
DORMANT = "DORMANT"
NOT_SERVING_TOKENS = {
    "campaign_paused",
    "adset_paused",
    "paused",
    "rejected",
    "disapproved",
    "pending",
    "in_review",
    "with_issues",
    "archived",
}
DEFAULT_SHEET_TABS = (
    "IMAGES (Flower)",
    "IMAGES (Sleep Gummies)",
    "VIDEOS (Flower)",
    "VIDEOS (Sleep Gummies)",
)
DEFAULT_LISTS = {
    "901711558014": "image",  # Static Image Ads
    "901711553702": "video",  # Video Ads
    "901711560388": "video",  # Pod 1 UGC
    "901712123770": "video",  # Pod 2 UGC
}


@dataclass(frozen=True)
class SheetPresence:
    tab: str
    row: int
    verdict: str
    launch_state: str = DORMANT


@dataclass(frozen=True)
class CompletedCard:
    card_id: str
    kind: str
    name: str
    status: str
    folder_id: str
    product: str


@dataclass(frozen=True)
class Gap:
    gap_type: str
    card_id: str
    card_name: str
    file_id: str
    detail: str
    tab: str | None = None
    row: int | None = None
    file_count: int | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "type": self.gap_type,
            "card_id": self.card_id,
            "card_name": self.card_name,
            "file_id": self.file_id,
            "detail": self.detail,
            "tab": self.tab,
            "row": self.row,
            "file_count": self.file_count,
        }


def _clickup_get(path: str, params: dict[str, object] | None = None) -> dict[str, object]:
    query = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"https://api.clickup.com/api/v2/{path}"
    if query:
        url = f"{url}?{query}"
    req = urllib.request.Request(url, headers=resolve_cards.H)
    return json.load(urllib.request.urlopen(req, timeout=30))


def _is_completed_status(status: str | None) -> bool:
    return "posted to sheet" in (status or "").lower()


def list_completed_cards(list_kind: dict[str, str] = DEFAULT_LISTS) -> list[CompletedCard]:
    cards: list[CompletedCard] = []
    for list_id, kind in list_kind.items():
        page = 0
        while True:
            data = _clickup_get(
                f"list/{list_id}/task",
                {"include_closed": "true", "subtasks": "true", "page": page},
            )
            tasks = data.get("tasks") or []
            if not tasks:
                break
            for task in tasks:
                status = ((task.get("status") or {}).get("status") or "").strip()
                if not _is_completed_status(status):
                    continue
                card_id = str(task.get("id") or "")
                resolved = resolve_cards.resolve(card_id)
                cards.append(_completed_card_from_resolved(card_id, kind, status, resolved))
            page += 1
    return cards


def resolve_completed_cards(card_ids: Iterable[str], kind: str) -> list[CompletedCard]:
    cards: list[CompletedCard] = []
    for card_id in card_ids:
        resolved = resolve_cards.resolve(card_id)
        status = str(resolved.get("status") or "")
        if not _is_completed_status(status):
            continue
        cards.append(_completed_card_from_resolved(card_id, kind, status, resolved))
    return cards


def _completed_card_from_resolved(card_id: str, kind: str, status: str, resolved: dict[str, object]) -> CompletedCard:
    return CompletedCard(
        card_id=card_id,
        kind=kind,
        name=str(resolved.get("name") or ""),
        status=status,
        folder_id=str(resolved.get("folder") or ""),
        product=str(resolved.get("product") or ""),
    )


def classify_launch_state(launch_cells: list[str]) -> str:
    saw_paused = False
    saw_ambiguous = False
    for cell in launch_cells:
        value = (cell or "").strip()
        if not value:
            continue
        token = value.split(" - ", 1)[0].strip().lower()
        if token == "active":
            return ACTIVE
        if token in NOT_SERVING_TOKENS:
            saw_paused = True
            continue
        saw_ambiguous = True
    if saw_ambiguous:
        return AMBIGUOUS
    if saw_paused:
        return PAUSED
    return DORMANT


def load_baseline(path: str = DEFAULT_BASELINE_PATH) -> dict[str, object]:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise RuntimeError(f"baseline must be a JSON object: {path}")
    return {
        "dropped_fail_cards": list(data.get("dropped_fail_cards") or []),
        "testimonial_file_ids": list(data.get("testimonial_file_ids") or []),
        **{k: v for k, v in data.items() if k not in {"dropped_fail_cards", "testimonial_file_ids"}},
    }


def _count_nested_items(folder_id: str, depth: int = 0) -> int:
    count = 0
    for item in engine._list_folder(folder_id):
        count += 1
        mime = str(item.get("mimeType") or "")
        if mime.startswith("application/vnd.google-apps.folder") and depth < 3:
            count += _count_nested_items(str(item["id"]), depth + 1)
    return count


def _skip_non_ad_folder(item: dict[str, object], excluded: dict[str, int] | None) -> bool:
    name = str(item.get("name") or "")
    if not NON_AD_FOLDER_RE.search(name):
        return False
    if excluded is not None:
        excluded["non_ad_folder"] += 1 + _count_nested_items(str(item["id"]))
    return True


def _collect_nested_files(folder_id: str, depth: int = 0, excluded: dict[str, int] | None = None) -> list[dict[str, object]]:
    files: list[dict[str, object]] = []
    for item in engine._list_folder(folder_id):
        name = str(item.get("name") or "")
        mime = str(item.get("mimeType") or "")
        if mime.startswith("application/vnd.google-apps.folder"):
            if engine._is_axon_or_dnu(name) or _skip_non_ad_folder(item, excluded):
                continue
            if depth < 3:
                files.extend(_collect_nested_files(str(item["id"]), depth + 1, excluded))
            continue
        if engine._is_axon_or_dnu(name):
            continue
        files.append(item)
    return files


def collect_finished_file_ids(card: CompletedCard, excluded: dict[str, int] | None = None) -> set[str]:
    if not card.folder_id:
        return set()
    if card.kind == "image":
        return collect_image_file_ids(card.folder_id, excluded)
    if card.kind == "video":
        return collect_video_file_ids(card.folder_id, excluded)
    raise ValueError(f"unknown card kind {card.kind!r} for {card.card_id}")


def collect_image_file_ids(folder_id: str, excluded: dict[str, int] | None = None) -> set[str]:
    file_ids: set[str] = set()
    for item in engine._list_folder(folder_id):
        mime = str(item.get("mimeType") or "")
        if mime.startswith("application/vnd.google-apps.folder"):
            _skip_non_ad_folder(item, excluded)
            continue
        name = str(item.get("name") or "")
        if engine._is_axon_or_dnu(name):
            continue
        if engine.IMG_NV.search(name) and engine.IMG_RATIO.search(name):
            file_ids.add(str(item["id"]))
    return file_ids


def collect_video_file_ids(folder_id: str, excluded: dict[str, int] | None = None) -> set[str]:
    finished_id, _ = engine._find_finished_folder(folder_id)
    scan_folder = finished_id or folder_id
    file_ids: set[str] = set()
    for item in _collect_nested_files(scan_folder, excluded=excluded):
        name = str(item.get("name") or "")
        if engine.VID_RE.search(name):
            file_ids.add(str(item["id"]))
    return file_ids


def _resolve_launch_cols(headers: dict[str, int]) -> list[int]:
    """Per-account launch columns = the contiguous run of account-signature headers
    ('ShortName | descriptor', e.g. 'E-0681 | Flower 2') immediately after ADMANAGE.
    The RIGHT boundary varies by tab (Code on IMAGES, 'Variant #' on VIDEOS), so detect
    by the account-header signature, never a fixed end-header. Drift-tolerant: a new
    account header carries the ' | ' signature; content columns never do."""
    col_to_header = {col: name for name, col in headers.items()}
    launch_cols: list[int] = []
    col = headers[ADMANAGE_HEADER] + 1
    while col in col_to_header and ACCOUNT_HEADER_SIGNATURE in col_to_header[col]:
        launch_cols.append(col)
        col += 1
    return launch_cols


def build_sheet_file_index(tabs: Iterable[str] = DEFAULT_SHEET_TABS) -> dict[str, list[SheetPresence]]:
    index: dict[str, list[SheetPresence]] = {}
    for tab in tabs:
        headers = engine._headers(tab)
        if COMPLIANCE_HEADER not in headers:
            raise RuntimeError(f"missing header {COMPLIANCE_HEADER!r} on {tab}")
        if ADMANAGE_HEADER not in headers:
            raise RuntimeError(f"missing header {ADMANAGE_HEADER!r} on {tab}")
        launch_cols = _resolve_launch_cols(headers)
        if not launch_cols:
            raise RuntimeError(f"no per-account launch columns (header '<account> | <descriptor>') after {ADMANAGE_HEADER!r} on {tab}")
        asset_cols = [headers[name] for name in ("1x1", "4x5", "9x16") if name in headers]
        if not asset_cols:
            continue
        max_col = max([headers[COMPLIANCE_HEADER], headers[ADMANAGE_HEADER], *launch_cols, *asset_cols])
        values = engine._read(tab, f"A1:{engine._col_letter(max_col)}5000")
        for offset, row in enumerate(values[1:], start=2):
            verdict = row[headers[COMPLIANCE_HEADER]].strip() if len(row) > headers[COMPLIANCE_HEADER] else ""
            launch_cells = [row[col] if len(row) > col else "" for col in launch_cols]
            launch_state = classify_launch_state(launch_cells)
            for col in asset_cols:
                if len(row) <= col:
                    continue
                file_id = engine._fid(row[col])
                if not file_id:
                    continue
                index.setdefault(file_id, []).append(SheetPresence(tab=tab, row=offset, verdict=verdict, launch_state=launch_state))
    return index


def _empty_excluded() -> dict[str, int]:
    return {key: 0 for key in EXCLUDED_KEYS}


def _accounting_line(result: dict[str, object]) -> str:
    excluded = result["excluded"]
    counts = result["gap_counts"]
    excluded_line = ", ".join(f"{key}:{excluded[key]}" for key in EXCLUDED_KEYS)
    return (
        f"raw {result['raw_gap_count']} -> excluded [{excluded_line}] -> "
        f"NEW gaps: {counts['MISSING_cards']} MISSING-cards, "
        f"{counts['ACTIVE_UNSCANNED']} ACTIVE-unscanned, "
        f"{counts['AMBIGUOUS_UNSCANNED']} AMBIGUOUS-unscanned"
    )


def reconcile(
    cards: Iterable[CompletedCard],
    sheet_index: dict[str, list[SheetPresence]],
    baseline: dict[str, object] | None = None,
) -> dict[str, object]:
    gaps: list[Gap] = []
    pending: list[dict[str, object]] = []
    excluded = _empty_excluded()
    dropped_fail_cards = {str(card_id) for card_id in (baseline or {}).get("dropped_fail_cards", [])}
    testimonial_file_ids = {str(file_id) for file_id in (baseline or {}).get("testimonial_file_ids", [])}
    # ROW-keyed (tab,row) set of rows verified zero-spend across BOTH 14d+30d windows and
    # ALL account-cells (the row-AND, built at baseline-construction). These ENDED rows are
    # excluded ONLY in the AMBIGUOUS branch below - a verified-$0 signal is the one thing that
    # beats the AMBIGUOUS-surface invariant. ACTIVE rows NEVER consult this set (always surface).
    ended_rows = {(str(tab), int(row)) for tab, row in (baseline or {}).get("ended_zero_spend_rows", [])}
    # Adam-cleared (2026-07-09 directive): reconcile gaps that Adam confirmed are ALL already on
    # the sheet - ignore permanently, never scan/re-intake/re-surface. Applied as a final post-filter
    # so it drops BOTH the MISSING-card gaps (by card_id) and the AMBIGUOUS-row gaps (by tab,row).
    adam_cleared_cards = {str(cid) for cid in (baseline or {}).get("adam_cleared_cards", [])}
    adam_cleared_rows = {(str(tab), int(row)) for tab, row in (baseline or {}).get("adam_cleared_rows", [])}
    checked_cards = 0
    checked_file_ids = 0
    for card in cards:
        checked_cards += 1
        file_ids = sorted(collect_finished_file_ids(card, excluded))
        if not file_ids:
            pending.append({
                "card_id": card.card_id,
                "card_name": card.name,
                "reason": "no finished creative file IDs found",
            })
            continue
        checked_file_ids += len(file_ids)
        present_count = sum(1 for file_id in file_ids if sheet_index.get(file_id))
        if present_count == 0:
            if card.card_id in dropped_fail_cards:
                excluded["baseline_dropped_fail"] += 1
            else:
                gaps.append(Gap(
                    gap_type="MISSING",
                    card_id=card.card_id,
                    card_name=card.name,
                    file_id="",
                    detail="completed card has zero finished file IDs present on sheet",
                    file_count=len(file_ids),
                ))
            continue
        if present_count < len(file_ids):
            excluded["partial_card"] += 1
        for file_id in file_ids:
            presences = sheet_index.get(file_id) or []
            for presence in presences:
                if presence.verdict.strip():
                    continue
                if presence.launch_state == ACTIVE:
                    gaps.append(Gap(
                        gap_type="ACTIVE_UNSCANNED",
                        card_id=card.card_id,
                        card_name=card.name,
                        file_id=file_id,
                        detail="active sheet row exists but Meta Compliance Agent verdict is blank",
                        tab=presence.tab,
                        row=presence.row,
                    ))
                    continue
                if presence.launch_state == AMBIGUOUS:
                    if (presence.tab, presence.row) in ended_rows:
                        # Verified zero-spend across both windows + every account-cell (row-AND).
                        # The ONE override of the AMBIGUOUS-surface invariant - gated on a positive
                        # verified-$0 signal, never inference. Point-in-time: a relaunch re-surfaces
                        # via the --no-baseline audit + re-spend revalidation.
                        excluded["ended_zero_spend"] += 1
                        continue
                    gaps.append(Gap(
                        gap_type="AMBIGUOUS_UNSCANNED",
                        card_id=card.card_id,
                        card_name=card.name,
                        file_id=file_id,
                        detail="ambiguous launch stamp and blank Meta Compliance Agent verdict",
                        tab=presence.tab,
                        row=presence.row,
                    ))
                    continue
                if file_id in testimonial_file_ids:
                    excluded["baseline_testimonial"] += 1
                    continue
                if presence.launch_state == PAUSED:
                    excluded["paused_unscanned"] += 1
                    continue
                if presence.launch_state == DORMANT:
                    excluded["dormant_unscanned"] += 1
                    continue
                gaps.append(Gap(
                    gap_type="AMBIGUOUS_UNSCANNED",
                    card_id=card.card_id,
                    card_name=card.name,
                    file_id=file_id,
                    detail="unrecognized launch state and blank Meta Compliance Agent verdict",
                    tab=presence.tab,
                    row=presence.row,
                ))
    # Adam-cleared post-filter: drop gaps Adam confirmed are already on the sheet (never re-surface).
    if adam_cleared_cards or adam_cleared_rows:
        kept: list[Gap] = []
        for gap in gaps:
            if gap.card_id in adam_cleared_cards:
                excluded["adam_cleared"] += 1
                continue
            if gap.tab is not None and gap.row is not None and (str(gap.tab), int(gap.row)) in adam_cleared_rows:
                excluded["adam_cleared"] += 1
                continue
            kept.append(gap)
        gaps = kept
    counts = {
        "MISSING_cards": sum(1 for gap in gaps if gap.gap_type == "MISSING"),
        "ACTIVE_UNSCANNED": sum(1 for gap in gaps if gap.gap_type == "ACTIVE_UNSCANNED"),
        "AMBIGUOUS_UNSCANNED": sum(1 for gap in gaps if gap.gap_type == "AMBIGUOUS_UNSCANNED"),
    }
    raw = counts["MISSING_cards"] + counts["ACTIVE_UNSCANNED"] + counts["AMBIGUOUS_UNSCANNED"] + sum(excluded.values())
    result = {
        "checked_cards": checked_cards,
        "checked_file_ids": checked_file_ids,
        "raw_gap_count": raw,
        "excluded": excluded,
        "gap_counts": counts,
        "gaps": [gap.as_dict() for gap in gaps],
        "pending_cards": pending,
    }
    result["accounting"] = _accounting_line(result)
    return result


def render_markdown(result: dict[str, object]) -> str:
    lines = [
        "# Completed-card file-ID reconciliation",
        "",
        f"- Checked cards: {result['checked_cards']}",
        f"- Checked file IDs: {result['checked_file_ids']}",
        f"- Accounting: {result['accounting']}",
        "",
    ]
    gaps = result["gaps"]
    if gaps:
        lines.extend(["| Type | Card | File ID | Count | Sheet row | Detail |", "|---|---|---|---|---|---|"])
        for gap in gaps:
            row = f"{gap.get('tab')}:{gap.get('row')}" if gap.get("tab") else ""
            count = gap.get("file_count") or ""
            lines.append(f"| {gap['type']} | {gap['card_id']} | {gap['file_id']} | {count} | {row} | {gap['detail']} |")
    else:
        lines.append("No reconciliation gaps found.")
    pending = result["pending_cards"]
    if pending:
        lines.extend(["", "## Pending Cards", "", "| Card | Reason |", "|---|---|"])
        for card in pending:
            lines.append(f"| {card['card_id']} | {card['reason']} |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reconcile completed ClickUp cards to sheet creative file IDs.")
    parser.add_argument("--card", action="append", default=[], help="audit a specific completed card ID")
    parser.add_argument("--kind", choices=("image", "video"), default="image", help="kind for --card mode")
    parser.add_argument("--list", action="append", dest="lists", default=[], help="ClickUp list ID to sweep")
    parser.add_argument("--tab", action="append", default=[], help="sheet tab to scan")
    parser.add_argument("--no-baseline", action="store_true", help="run full reconcile without applying baseline exclusions")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of markdown")
    args = parser.parse_args(argv)

    tabs = args.tab or list(DEFAULT_SHEET_TABS)
    if args.card:
        cards = resolve_completed_cards(args.card, args.kind)
    else:
        selected = {list_id: DEFAULT_LISTS[list_id] for list_id in (args.lists or DEFAULT_LISTS) if list_id in DEFAULT_LISTS}
        unknown = set(args.lists) - set(DEFAULT_LISTS)
        if unknown:
            raise SystemExit(f"unknown list IDs need kind mapping in code: {sorted(unknown)}")
        cards = list_completed_cards(selected)
    baseline = None if args.no_baseline else load_baseline()
    result = reconcile(cards, build_sheet_file_index(tabs), baseline=baseline)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(render_markdown(result))
    return 1 if result["gaps"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
