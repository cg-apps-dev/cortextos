#!/usr/bin/env python3
"""Zero-model completed-card to sheet reconciliation for Meta intake.

Checks completed ClickUp cards against the upload sheet by Drive file ID first, with
ClickUp Card ID as the authoritative already-intaken fallback for re-exports:
- MISSING: no finished creative file IDs or ClickUp Card ID from the completed card are on the sheet.
- UNSCANNED: a sheet row has a blank Meta Compliance Agent verdict and active/ambiguous launch state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Iterable

import engine
import resolve_cards


COMPLIANCE_HEADER = "Meta Compliance Agent"
ADMANAGE_HEADER = "ADMANAGE"
CARD_ID_HEADER = "ClickUp Card ID"
ACCOUNT_HEADER_SIGNATURE = " | "  # every per-account launch header is 'ShortName | descriptor'
# DEAD / RETIRED per-account launch columns: Adam deliberately killed these
# accounts, so stale historical "Active" stamps must not drive launch-state
# classification. Existing stamps stay historical; real reactivation should be
# handled by removing the account from this set.
# E-0496 retired 2026-06-27; E-0842/E-0930 killed 2026-07-16.
DEAD_ACCOUNTS = {"E-0496", "E-0842", "E-0930"}
DEFAULT_BASELINE_PATH = os.path.expanduser("~/.cortextos/default/state/meta-ads-agent/reconcile-baseline.json")
ADVERSE_STATE_PATH = os.path.expanduser("~/.cortextos/default/state/meta-ads-agent/adverse-requeue-state.json")
ADVERSE_DIRECT_TOKENS = {"rejected", "disapproved"}
POLICY_ERROR_CODE = 2490468  # "Cannot enable ad with ad review rejected"
AD_ID_RE = re.compile(r"Ad ID:\s*(\d+)")
META_ADSREAD_PATH = "/Users/adamfolker/cortextos/integrations/meta-adsread/meta_adsread.py"
ACCOUNT_ALIASES = {"JCG1 - Flow": "JCG1", "JCG2 - Flow": "JCG2"}
ACCOUNT_STATE_TAGS = {
    "E-0496": "account retired 2026-06-27",
    "E-0930": "account Adam-killed 2026-07-16, verified dead",
    "AliCG3": "account DISABLED at account level",
}
UNVERIFIED_TRIPWIRE_THRESHOLD = 10
NON_AD_FOLDER_RE = re.compile(r"b-?roll|raw|selects?|project files?|working|archive", re.I)
EXCLUDED_KEYS = (
    "partial_card",
    "card_id_present",
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
ACTOR_SHEETS = {
    "Jennifer Stone": "1sQ-11HAzbMPIAlrvT_0bJVctYO7FtIEno_OHC939hro",
    "Gary Sullivan": "1yI5dWDOMSzonf_VVQdQWDdpasUyMl24jrQeSbWk3Sug",
    "Megan Cole": "1vYXcBUqPVGriH2MwBjgNARvMOHyDM1g3iwYGDKeA_Wo",
    "Sarah's Finds": "1LeLV4eThmqiGaS9xL6gm5m1N274C6BYiubn_lePC_HA",
    "Ashley Monroe": "1L-ImOau4cOnfyqTEGZ6o0N7MKDhcdh2-li1IP0ssi8s",
}
ACTOR_SHEET_TABS = ("IMAGES", "VIDEOS")
DEFAULT_LISTS = {
    "901711558014": "image",  # Static Image Ads
    "901711553702": "video",  # Video Ads
    "901711560388": "video",  # Pod 1 UGC
    "901712123770": "video",  # Pod 2 UGC
}
CLICKUP_TASK_ID_RE = re.compile(r"(?=.*[A-Za-z])[A-Za-z0-9]{9,10}")


@dataclass(frozen=True)
class SheetPresence:
    tab: str
    row: int
    verdict: str
    launch_state: str = DORMANT


@dataclass(frozen=True)
class SheetCardPresence:
    tab: str
    row: int


@dataclass(frozen=True)
class SheetTarget:
    spreadsheet_id: str
    tab: str
    label: str


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


def _card_id_from_cell(cell: str | None) -> str | None:
    value = (cell or "").strip()
    if not value:
        return None
    match = re.search(r"/t/([A-Za-z0-9]+)", value)
    if match:
        candidate = match.group(1)
        return candidate if CLICKUP_TASK_ID_RE.fullmatch(candidate) else None
    return value if CLICKUP_TASK_ID_RE.fullmatch(value) else None


def _assert_not_truncated(tab: str, values: list[list[str]], limit: int, consumed_cols: Iterable[int]) -> None:
    if len(values) < limit - 1:
        return
    cols = list(consumed_cols)
    last_substantive = 0
    for row_number, row in enumerate(values, start=1):
        if any(len(row) > col and str(row[col]).strip() for col in cols):
            last_substantive = row_number
    if last_substantive >= limit - 1:
        raise RuntimeError(
            f"sheet read on {tab}: substantive data reaches row {last_substantive} at the "
            f"{limit}-row range cap - population may be truncated; raise the cap before "
            f"trusting any result"
        )


def _fetch_issue_codes(account: str, timeout_s: int = 180) -> dict[str, list[int]] | None:
    """Return {ad_id: [issues_info error_codes]}, or None on any fetch failure."""
    key = ACCOUNT_ALIASES.get(account, account)
    try:
        proc = subprocess.run(
            [
                sys.executable,
                META_ADSREAD_PATH,
                "--account",
                key,
                "--endpoint",
                "ads",
                "--fields",
                "id,effective_status,issues_info",
                "--all",
            ],
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout)
        ads = data.get("data", data) if isinstance(data, dict) else data
        out: dict[str, list[int]] = {}
        for ad in ads:
            codes = [int(issue.get("error_code") or 0) for issue in (ad.get("issues_info") or [])]
            out[str(ad.get("id") or "")] = codes
        return out
    except Exception:
        return None


def scan_adverse_since_pass(
    tabs: Iterable[str | SheetTarget] = DEFAULT_SHEET_TABS,
    fetch: Callable[[str], dict[str, list[int]] | None] = _fetch_issue_codes,
) -> dict[str, object]:
    """Find PASS or unresolved rows with a later adverse Meta launch state."""
    instances: list[dict[str, object]] = []
    unverified: list[dict[str, object]] = []
    filtered_delivery = 0
    blank_adverse = 0
    pending: dict[str, list[dict[str, object]]] = {}
    for target in _normalize_sheet_targets(tabs):
        headers = _headers_target(target)
        if COMPLIANCE_HEADER not in headers or ADMANAGE_HEADER not in headers:
            continue
        cols_all = _resolve_launch_cols_all(headers)
        if not cols_all:
            continue
        asset_cols = [headers[name] for name in ("1x1", "4x5", "9x16") if name in headers]
        max_col = max([headers[COMPLIANCE_HEADER], *[c for c, _acct, _dead in cols_all], *asset_cols])
        values = _read_target(target, f"A1:{engine._col_letter(max_col)}5000")
        _assert_not_truncated(
            target.label,
            values,
            5000,
            [headers[COMPLIANCE_HEADER], *[c for c, _acct, _dead in cols_all], *asset_cols],
        )
        for offset, row in enumerate(values[1:], start=2):
            verdict = row[headers[COMPLIANCE_HEADER]].strip() if len(row) > headers[COMPLIANCE_HEADER] else ""
            verdict_upper = verdict.upper()
            if verdict_upper.startswith("FAIL"):
                continue
            if not verdict:
                verdict_class = "BLANK"
            elif verdict_upper.startswith("PASS"):
                verdict_class = "PASS"
            else:
                verdict_class = "UNRESOLVED"
            fids = sorted({fid for col in asset_cols if len(row) > col for fid in [engine._fid(row[col])] if fid})
            surfaces, question_open = _verdict_surfaces(verdict, target.tab)
            verdict_word = "PASS" if verdict_class == "PASS" else (verdict.split()[0].rstrip("-:") if verdict else "BLANK")
            for col, acct, _dead in cols_all:
                cell = (row[col] if len(row) > col else "").strip()
                if not cell:
                    continue
                token = cell.split(" - ", 1)[0].strip().lower()
                if token not in ADVERSE_DIRECT_TOKENS and token != "with_issues":
                    continue
                if verdict_class == "BLANK":
                    blank_adverse += 1
                    continue
                match = AD_ID_RE.search(cell)
                inst = {
                    "tab": target.label,
                    "row": offset,
                    "account": acct,
                    "account_state_tag": ACCOUNT_STATE_TAGS.get(acct, ""),
                    "token": token,
                    "ad_id": match.group(1) if match else "",
                    "verdict_token": verdict_word,
                    "verdict_class": verdict_class,
                    "asset_fileids": fids,
                    "error_code": None,
                    "verdict_surfaces": surfaces,
                    "creative_question_open": question_open,
                    "pass_freshness": _pass_freshness(verdict, cell),
                }
                if verdict_class != "PASS" or inst["pass_freshness"] != "fresh_after_adverse":
                    inst["non_creative_inference"] = "rescan_required"
                elif question_open:
                    inst["non_creative_inference"] = "open"
                else:
                    inst["non_creative_inference"] = "earned"
                if token in ADVERSE_DIRECT_TOKENS:
                    instances.append(inst)
                else:
                    pending.setdefault(acct, []).append(inst)
    for acct, insts in pending.items():
        codes_by_ad = fetch(acct)
        if codes_by_ad is None:
            for inst in insts:
                inst["error_code"] = "fetch-failed"
                unverified.append(inst)
            continue
        for inst in insts:
            codes = codes_by_ad.get(str(inst["ad_id"]))
            if codes is None:
                inst["error_code"] = "ad-not-in-account-pull"
                unverified.append(inst)
            elif POLICY_ERROR_CODE in codes:
                inst["error_code"] = POLICY_ERROR_CODE
                instances.append(inst)
            else:
                filtered_delivery += 1
    return {
        "instances": instances,
        "unverified": unverified,
        "filtered_delivery": filtered_delivery,
        "blank_adverse": blank_adverse,
    }


def _verdict_surfaces(verdict_cell: str, tab: str) -> tuple[list[str], bool]:
    lower = (verdict_cell or "").lower()
    surfaces: list[str] = []
    if re.search(r"whisper|vo audio|vo transcript|creative/vo", lower):
        surfaces.append("VO")
    if re.search(r"frames|phase 1-v|1fps", lower):
        surfaces.append("video-frames")
    if re.search(r"\(image\)|vision pass|ocr|tiled|re-scan.*1x1|creative scan v2", lower):
        surfaces.append("static-image+ocr")
    if not surfaces:
        surfaces = ["unstated"]
    question_open = tab.upper().startswith("VIDEOS") or surfaces == ["unstated"]
    return surfaces, question_open


_SCAN_DATE_RE = re.compile(r"(?:scanned|\[re-scan|eyeball-(?:confirmed|corrected))\s*:?\s*(\d{4}-\d{2}-\d{2})")
_STAMP_DATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _pass_freshness(verdict_cell: str, launch_cell: str) -> str:
    scan_m = _SCAN_DATE_RE.search(verdict_cell or "")
    if not scan_m:
        return "unknown"
    stamp_m = _STAMP_DATE_RE.search(launch_cell or "")
    if not stamp_m:
        return "unknown"
    scan_date = scan_m.group(1)
    mm, dd, yyyy = stamp_m.groups()
    stamp_date = f"{yyyy}-{mm}-{dd}"
    return "fresh_after_adverse" if scan_date >= stamp_date else "stale_or_predates"


def _resolution_hash(verdict_token: str, asset_fileids: list[str]) -> str:
    return hashlib.sha256((verdict_token + "|" + ",".join(sorted(asset_fileids))).encode("utf-8")).hexdigest()


def _instance_key(inst: dict[str, object]) -> str:
    return f"{inst['tab']}|{inst['row']}|{inst['ad_id'] or inst['account']}|{inst['token']}"


def _emit_unverified_tripwire(
    active_unverified: list[dict[str, object]],
    consec: int,
    state_path: str,
    now: int,
    run: Callable[..., object] = subprocess.run,
) -> dict[str, object]:
    keys = sorted(_instance_key(inst) for inst in active_unverified)
    message = (
        "meta-intake adverse-state unverified tripwire: "
        f"{len(active_unverified)} active unverified instances for {consec} consecutive runs "
        f"(state={state_path})"
    )
    meta = {
        "agent": os.environ.get("CTX_AGENT_NAME", "meta-ads-agent"),
        "state_path": state_path,
        "unverified_consec": consec,
        "active_unverified": len(active_unverified),
        "keys": keys,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
    }
    commands = [
        ["cortextos", "bus", "log-event", "error", "meta_intake_adverse_unverified_tripwire", "warning", "--meta", json.dumps(meta, sort_keys=True)],
        ["cortextos", "bus", "notify-agent", os.environ.get("CTX_ORCHESTRATOR_AGENT", "the-orchestrator"), message],
    ]
    results: list[dict[str, object]] = []
    for cmd in commands:
        try:
            proc = run(cmd, capture_output=True, text=True, timeout=30)
            results.append({"cmd": cmd[:4], "returncode": int(getattr(proc, "returncode", 0))})
        except Exception as exc:
            results.append({"cmd": cmd[:4], "error": str(exc)})
    return {"message": message, "keys": keys, "results": results}


def apply_adverse_state(
    scan: dict[str, object],
    state_path: str = ADVERSE_STATE_PATH,
    now: int | None = None,
    *,
    unverified_tripwire_threshold: int = UNVERIFIED_TRIPWIRE_THRESHOLD,
    alert_runner: Callable[..., object] = subprocess.run,
) -> dict[str, object]:
    """Resolution-keyed dedup plus a fail-loud tripwire for repeated unverified fetches."""
    now = int(time.time() if now is None else now)
    try:
        with open(state_path, encoding="utf-8") as fh:
            state = json.load(fh)
        if not isinstance(state, dict):
            state = {}
    except Exception:
        state = {}
    inst_state: dict[str, dict[str, object]] = state.setdefault("instances", {})
    new: list[dict[str, object]] = []
    outstanding: list[dict[str, object]] = []
    for inst in scan["instances"]:
        key = _instance_key(inst)
        current_hash = _resolution_hash(str(inst["verdict_token"]), list(inst["asset_fileids"]))
        rec = inst_state.get(key)
        if rec is None:
            inst_state[key] = {"first_seen": now, "last_seen": now, "resolution_hash": current_hash, "resolved": False}
            new.append(inst)
        elif rec.get("suppressed_reason"):
            continue
        elif rec.get("signed_off"):
            continue
        elif rec.get("resolved"):
            if rec.get("resolution_hash") != current_hash:
                inst_state[key] = {"first_seen": now, "last_seen": now, "resolution_hash": current_hash, "resolved": False}
                new.append(inst)
        elif rec.get("resolution_hash") != current_hash:
            rec["resolved"] = True
            rec["resolution_hash"] = current_hash
            rec["resolved_ts"] = now
        else:
            rec["last_seen"] = now
            inst["age_days"] = round((now - int(rec.get("first_seen", now))) / 86400, 1)
            outstanding.append(inst)
    active_unverified = [
        u for u in scan["unverified"]
        if not (inst_state.get(_instance_key(u)) or {}).get("suppressed_reason")
    ]
    state["unverified_consec"] = int(state.get("unverified_consec", 0)) + 1 if active_unverified else 0
    tripwire_alert: dict[str, object] | None = None
    if active_unverified and state["unverified_consec"] >= unverified_tripwire_threshold:
        tripwire_alert = _emit_unverified_tripwire(
            active_unverified,
            int(state["unverified_consec"]),
            state_path,
            now,
            alert_runner,
        )
        state["unverified_tripwire_last_fired"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
        state["unverified_consec"] = 0
    if "baseline" not in state:
        state["baseline"] = {
            "recorded_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "count": len(new) + len(outstanding),
            "keys": sorted(_instance_key(i) for i in [*new, *outstanding]),
        }
    if "baseline_v2_unresolved" not in state and any(i.get("verdict_class") == "UNRESOLVED" for i in [*new, *outstanding]):
        state["baseline_v2_unresolved"] = {
            "recorded_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "count_total": len(new) + len(outstanding),
            "count_unresolved_added": sum(1 for i in [*new, *outstanding] if i.get("verdict_class") == "UNRESOLVED"),
        }
    tmp = state_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=1, sort_keys=True)
    os.replace(tmp, state_path)
    return {
        "new": new,
        "outstanding": outstanding,
        "unverified": scan["unverified"],
        "filtered_delivery": scan["filtered_delivery"],
        "blank_adverse": scan.get("blank_adverse", 0),
        "suppressed": sum(1 for _key, rec in inst_state.items() if rec.get("suppressed_reason")),
        "unverified_consec": state["unverified_consec"],
        "unverified_tripwire": tripwire_alert,
        "baseline": state["baseline"],
    }


def _default_sheet_targets() -> tuple[SheetTarget, ...]:
    targets = [SheetTarget(engine.SHEET_ID, tab, tab) for tab in DEFAULT_SHEET_TABS]
    for actor, spreadsheet_id in ACTOR_SHEETS.items():
        for tab in ACTOR_SHEET_TABS:
            targets.append(SheetTarget(spreadsheet_id, tab, f"{actor}::{tab}"))
    return tuple(targets)


DEFAULT_SHEET_TARGETS = _default_sheet_targets()


def _normalize_sheet_targets(tabs: Iterable[str | SheetTarget] | None = None) -> list[SheetTarget]:
    if tabs is None:
        return list(DEFAULT_SHEET_TARGETS)
    targets: list[SheetTarget] = []
    for tab in tabs:
        if isinstance(tab, SheetTarget):
            targets.append(tab)
        else:
            targets.append(SheetTarget(engine.SHEET_ID, str(tab), str(tab)))
    return targets


def _read_target(target: SheetTarget, a1: str) -> list:
    if target.spreadsheet_id == engine.SHEET_ID:
        return engine._read(target.tab, a1)
    result = engine._rc([
        "sheets",
        "get",
        target.spreadsheet_id,
        engine._sheet_range(target.tab, a1),
        "--render",
        "FORMATTED_VALUE",
    ])
    return result.get("values", [])


def _headers_target(target: SheetTarget) -> dict[str, int]:
    if target.spreadsheet_id == engine.SHEET_ID:
        return engine._headers(target.tab)
    header_rows = _read_target(target, "A1:BZ1")
    header = header_rows[0] if header_rows else []
    index: dict[str, int] = {}
    duplicates: list[str] = []
    for i, name in enumerate(header):
        value = (name or "").strip()
        if not value:
            continue
        if value in index:
            duplicates.append(value)
        else:
            index[value] = i
    if duplicates:
        raise RuntimeError(f"DUP_HEADERS {target.label}: {duplicates}")
    return index


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
    return [col for col, _acct, dead in _resolve_launch_cols_all(headers) if not dead]


def _resolve_launch_cols_all(headers: dict[str, int]) -> list[tuple[int, str, bool]]:
    """Full contiguous account run as (col, account, is_dead), including dead accounts.

    Launch-state reconciliation skips dead accounts, but adverse-state requeue
    still needs the full run because a dead account can be a tagged trigger.
    """
    col_to_header = {col: name for name, col in headers.items()}
    out: list[tuple[int, str, bool]] = []
    col = headers[ADMANAGE_HEADER] + 1
    while col in col_to_header and ACCOUNT_HEADER_SIGNATURE in col_to_header[col]:
        acct = col_to_header[col].split(ACCOUNT_HEADER_SIGNATURE, 1)[0].strip()
        out.append((col, acct, acct in DEAD_ACCOUNTS))
        col += 1
    return out


def build_sheet_indexes(
    tabs: Iterable[str | SheetTarget] | None = None,
) -> tuple[dict[str, list[SheetPresence]], dict[str, list[SheetCardPresence]]]:
    index: dict[str, list[SheetPresence]] = {}
    card_index: dict[str, list[SheetCardPresence]] = {}
    for target in _normalize_sheet_targets(tabs):
        headers = _headers_target(target)
        if COMPLIANCE_HEADER not in headers:
            raise RuntimeError(f"missing header {COMPLIANCE_HEADER!r} on {target.label}")
        if ADMANAGE_HEADER not in headers:
            raise RuntimeError(f"missing header {ADMANAGE_HEADER!r} on {target.label}")
        launch_cols = _resolve_launch_cols(headers)
        if not launch_cols:
            raise RuntimeError(f"no per-account launch columns (header '<account> | <descriptor>') after {ADMANAGE_HEADER!r} on {target.label}")
        asset_cols = [headers[name] for name in ("1x1", "4x5", "9x16") if name in headers]
        card_id_col = headers.get(CARD_ID_HEADER)
        if not asset_cols and card_id_col is None:
            continue
        max_col = max([
            headers[COMPLIANCE_HEADER],
            headers[ADMANAGE_HEADER],
            *launch_cols,
            *asset_cols,
            *([card_id_col] if card_id_col is not None else []),
        ])
        values = _read_target(target, f"A1:{engine._col_letter(max_col)}5000")
        _assert_not_truncated(
            target.label,
            values,
            5000,
            [
                headers[COMPLIANCE_HEADER],
                *launch_cols,
                *asset_cols,
                *([card_id_col] if card_id_col is not None else []),
            ],
        )
        for offset, row in enumerate(values[1:], start=2):
            verdict = row[headers[COMPLIANCE_HEADER]].strip() if len(row) > headers[COMPLIANCE_HEADER] else ""
            launch_cells = [row[col] if len(row) > col else "" for col in launch_cols]
            launch_state = classify_launch_state(launch_cells)
            if card_id_col is not None and len(row) > card_id_col:
                card_id = _card_id_from_cell(row[card_id_col])
                if card_id:
                    card_index.setdefault(card_id, []).append(SheetCardPresence(tab=target.label, row=offset))
            for col in asset_cols:
                if len(row) <= col:
                    continue
                file_id = engine._fid(row[col])
                if not file_id:
                    continue
                index.setdefault(file_id, []).append(SheetPresence(tab=target.label, row=offset, verdict=verdict, launch_state=launch_state))
    return index, card_index


def build_sheet_file_index(tabs: Iterable[str | SheetTarget] | None = None) -> dict[str, list[SheetPresence]]:
    file_index, _card_index = build_sheet_indexes(tabs)
    return file_index


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
    sheet_card_index: dict[str, list[SheetCardPresence]] | None = None,
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
            if sheet_card_index and sheet_card_index.get(card.card_id):
                excluded["card_id_present"] += 1
                continue
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
    adverse = result.get("adverse_since_pass")
    if isinstance(adverse, dict):
        lines.extend(["", "## Adverse State Since PASS", ""])
        if adverse.get("error"):
            lines.append(f"- Error: {adverse['error']}")
        else:
            lines.append(
                f"- New: {len(adverse.get('new') or [])}; "
                f"Outstanding: {len(adverse.get('outstanding') or [])}; "
                f"Unverified: {len(adverse.get('unverified') or [])}; "
                f"Suppressed: {adverse.get('suppressed', 0)}; "
                f"Filtered delivery: {adverse.get('filtered_delivery', 0)}; "
                f"Blank adverse: {adverse.get('blank_adverse', 0)}; "
                f"Unverified consecutive runs: {adverse.get('unverified_consec', 0)}"
            )
            if adverse.get("unverified_tripwire"):
                lines.append(f"- Tripwire: {adverse['unverified_tripwire'].get('message')}")
            rows = [*list(adverse.get("new") or []), *list(adverse.get("outstanding") or [])]
            if rows:
                lines.extend(["", "| Status | Tab | Row | Account | Token | Ad ID | Inference | Account state |", "|---|---|---:|---|---|---|---|---|"])
                for inst in rows:
                    status = "new" if inst in (adverse.get("new") or []) else "outstanding"
                    lines.append(
                        f"| {status} | {inst.get('tab')} | {inst.get('row')} | "
                        f"{inst.get('account')} | {inst.get('token')} | {inst.get('ad_id')} | "
                        f"{inst.get('non_creative_inference')} | {inst.get('account_state_tag', '')} |"
                    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reconcile completed ClickUp cards to sheet creative file IDs.")
    parser.add_argument("--card", action="append", default=[], help="audit a specific completed card ID")
    parser.add_argument("--kind", choices=("image", "video"), default="image", help="kind for --card mode")
    parser.add_argument("--list", action="append", dest="lists", default=[], help="ClickUp list ID to sweep")
    parser.add_argument("--tab", action="append", default=[], help="sheet tab to scan")
    parser.add_argument("--no-baseline", action="store_true", help="run full reconcile without applying baseline exclusions")
    parser.add_argument("--no-adverse", action="store_true", help="skip the adverse-drift-since-PASS requeue scan")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of markdown")
    args = parser.parse_args(argv)

    tabs = [SheetTarget(engine.SHEET_ID, tab, tab) for tab in args.tab] if args.tab else None
    if args.card:
        cards = resolve_completed_cards(args.card, args.kind)
    else:
        selected = {list_id: DEFAULT_LISTS[list_id] for list_id in (args.lists or DEFAULT_LISTS) if list_id in DEFAULT_LISTS}
        unknown = set(args.lists) - set(DEFAULT_LISTS)
        if unknown:
            raise SystemExit(f"unknown list IDs need kind mapping in code: {sorted(unknown)}")
        cards = list_completed_cards(selected)
    baseline = None if args.no_baseline else load_baseline()
    sheet_index, sheet_card_index = build_sheet_indexes(tabs)
    result = reconcile(cards, sheet_index, baseline=baseline, sheet_card_index=sheet_card_index)
    if not args.card and not args.no_adverse:
        try:
            result["adverse_since_pass"] = apply_adverse_state(scan_adverse_since_pass(tabs or DEFAULT_SHEET_TARGETS))
        except Exception as exc:
            result["adverse_since_pass"] = {"error": f"adverse-scan failed: {exc}"}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(render_markdown(result))
    return 1 if result["gaps"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
