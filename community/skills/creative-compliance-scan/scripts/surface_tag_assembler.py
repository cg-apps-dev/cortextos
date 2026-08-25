#!/usr/bin/env python3
"""Close the IMG_770 false-PASS / unverified-surface-read-as-clear class.

The assembler is deterministic coverage bookkeeping for clearance stamps. It
derives applicable surfaces from media type, consumes explicit per-surface
verdict records, refuses malformed or mismatched handoffs, and emits only the
verdict word plus the bracketed surface tag fragment. It does not author human
judgment or decide where the fragment lands in the full col-B stamp.
"""
from dataclasses import dataclass
import json
import sys


VALID_SURFACES = ("copy", "creative", "vo")
VALID_VERDICTS = ("PASS", "UNCLEAR", "FAIL")
VALID_EYEBALL = ("true", "sampled", "none")
MEDIA_SURFACES = {
    "image": ("copy", "creative"),
    "video": ("copy", "creative", "vo"),
}
SURFACE_ORDER = {surface: idx for idx, surface in enumerate(VALID_SURFACES)}
VERDICT_SEVERITY = {"PASS": 0, "UNCLEAR": 1, "FAIL": 2}
STATUS_CLEAN = "clean"
STATUS_PARTIAL = "partial"


class SurfaceTagError(ValueError):
    """Fail-closed refusal with a caller-safe diagnostic."""


@dataclass(frozen=True)
class RowAssembly:
    row: object
    tab: str
    spreadsheet_id: str
    media_type: str
    letter: str
    surfaces: tuple[str, ...]
    status: str
    expected_surfaces: tuple[str, ...]
    consumed_surfaces: tuple[str, ...]

    @property
    def tag(self) -> str:
        return "[" + "+".join(self.surfaces) + "]"

    @property
    def fragment(self) -> str:
        return f"{self.letter} {self.tag}"


@dataclass(frozen=True)
class AssemblyBatch:
    rows: tuple[RowAssembly, ...]
    expected_count: int
    actual_count: int

    @property
    def status(self) -> str:
        return STATUS_PARTIAL if any(row.status == STATUS_PARTIAL for row in self.rows) else STATUS_CLEAN


def _normalize_surface(value: object, label: str) -> str:
    if not isinstance(value, str) or value not in VALID_SURFACES:
        raise SurfaceTagError(f"{label} unknown surface {value!r}")
    return value


def _normalize_verdict(value: object) -> str:
    if not isinstance(value, str):
        raise SurfaceTagError(f"unknown verdict {value!r}")
    verdict = value.upper()
    if verdict not in VALID_VERDICTS:
        raise SurfaceTagError(f"unknown verdict {value!r}")
    return verdict


def _applicable_surfaces(media_type: object) -> tuple[str, ...]:
    if not isinstance(media_type, str):
        raise SurfaceTagError(f"missing or unknown media_type {media_type!r}")
    normalized = media_type.lower()
    if normalized not in MEDIA_SURFACES:
        raise SurfaceTagError(f"missing or unknown media_type {media_type!r}")
    return MEDIA_SURFACES[normalized]


def _surface_sort(surfaces: set[str]) -> tuple[str, ...]:
    return tuple(sorted(surfaces, key=lambda surface: SURFACE_ORDER[surface]))


def _worst_verdict(verdicts: list[str]) -> str:
    if not verdicts:
        raise SurfaceTagError("no verified surfaces available to assemble a clearance letter")
    return max(verdicts, key=lambda verdict: VERDICT_SEVERITY[verdict])


def _required_record_value(record: dict, key: str) -> object:
    value = record.get(key)
    if value is None or value == "":
        row = record.get("row", "unknown")
        surface = record.get("surface", "unknown")
        raise SurfaceTagError(f"row {row} surface {surface}: missing {key}")
    return value


def _validate_record(record: object) -> dict:
    if not isinstance(record, dict):
        raise SurfaceTagError("malformed surface record: expected object")

    surface = _normalize_surface(record.get("surface"), "record")
    verdict = _normalize_verdict(record.get("verdict"))
    _required_record_value(record, "basis_file_id")
    _required_record_value(record, "gate_version")
    _required_record_value(record, "evidence")

    eyeball = record.get("eyeball")
    if not isinstance(eyeball, str) or eyeball not in VALID_EYEBALL:
        raise SurfaceTagError(f"row {record.get('row', 'unknown')} surface {surface}: malformed eyeball {eyeball!r}")
    if surface == "creative" and verdict == "PASS" and eyeball == "none":
        raise SurfaceTagError("creative PASS with eyeball=none cannot assemble a clean creative tag")

    return {
        **record,
        "surface": surface,
        "verdict": verdict,
        "eyeball": eyeball,
    }


def _identity(value: dict) -> tuple[object, str, str]:
    return (value.get("row"), str(value.get("tab", "")), str(value.get("spreadsheet_id", "")))


def assemble_row(row_spec: dict, records: list[dict]) -> RowAssembly:
    """Assemble one row from an explicit row spec and its per-surface records."""
    if not isinstance(row_spec, dict):
        raise SurfaceTagError("row spec must be an object")

    media_type = row_spec.get("media_type")
    applicable = set(_applicable_surfaces(media_type))
    claimed_raw = row_spec.get("claimed_surfaces")
    if not isinstance(claimed_raw, list):
        raise SurfaceTagError("row spec missing explicit claimed_surfaces list")
    claimed = {_normalize_surface(surface, "claimed") for surface in claimed_raw}

    non_applicable_claimed = claimed - applicable
    if non_applicable_claimed:
        raise SurfaceTagError(
            "claimed non-applicable surface(s): " + "+".join(_surface_sort(non_applicable_claimed))
        )

    expected = applicable & claimed
    validated = [_validate_record(record) for record in records]
    seen: dict[str, dict] = {}
    row_id = _identity(row_spec)

    for record in validated:
        surface = record["surface"]
        if surface not in applicable:
            raise SurfaceTagError(f"row {record.get('row', 'unknown')}: non-applicable surface record {surface}")
        record_id = _identity(record)
        if record_id != row_id:
            raise SurfaceTagError(f"surface record identity mismatch for surface {surface}")
        if surface in seen:
            raise SurfaceTagError(f"row {record.get('row', 'unknown')}: duplicate surface record {surface}")
        seen[surface] = record

    missing_claimed = expected - set(seen)
    if missing_claimed:
        raise SurfaceTagError("claimed surface(s) missing record: " + "+".join(_surface_sort(missing_claimed)))

    unexpected_records = set(seen) - expected
    if unexpected_records:
        raise SurfaceTagError("record surface(s) not claimed: " + "+".join(_surface_sort(unexpected_records)))

    consumed_surfaces = _surface_sort(set(seen))
    if not consumed_surfaces:
        raise SurfaceTagError("no surface records consumed")

    letter = _worst_verdict([seen[surface]["verdict"] for surface in consumed_surfaces])
    status = STATUS_CLEAN if set(consumed_surfaces) == applicable else STATUS_PARTIAL

    return RowAssembly(
        row=row_spec.get("row"),
        tab=str(row_spec.get("tab", "")),
        spreadsheet_id=str(row_spec.get("spreadsheet_id", "")),
        media_type=str(media_type).lower(),
        letter=letter,
        surfaces=consumed_surfaces,
        status=status,
        expected_surfaces=_surface_sort(expected),
        consumed_surfaces=consumed_surfaces,
    )


def assemble_batch(row_specs: list[dict], records: list[dict]) -> AssemblyBatch:
    """Assemble rows and refuse if rows x surfaces expected does not match actual."""
    if not isinstance(row_specs, list):
        raise SurfaceTagError("row specs must be a list")
    if not isinstance(records, list):
        raise SurfaceTagError("records must be a list")

    records_by_identity: dict[tuple[object, str, str], list[dict]] = {}
    for record in records:
        if not isinstance(record, dict):
            raise SurfaceTagError("malformed surface record: expected object")
        records_by_identity.setdefault(_identity(record), []).append(record)

    expected_total = 0
    actual_total = len(records)
    rows = []
    matched_record_total = 0
    for row_spec in row_specs:
        applicable = set(_applicable_surfaces(row_spec.get("media_type")))
        claimed_raw = row_spec.get("claimed_surfaces")
        if not isinstance(claimed_raw, list):
            raise SurfaceTagError("row spec missing explicit claimed_surfaces list")
        claimed = {_normalize_surface(surface, "claimed") for surface in claimed_raw}
        expected_total += len(applicable & claimed)
        row_records = records_by_identity.pop(_identity(row_spec), [])
        matched_record_total += len(row_records)
        rows.append(assemble_row(row_spec, row_records))

    if records_by_identity or matched_record_total != actual_total:
        actual_rows = sum(len(value) for value in records_by_identity.values()) + matched_record_total
        raise SurfaceTagError(
            f"expected-vs-actual mismatch: expected {expected_total} row-surfaces, "
            f"actual {actual_rows}; unclaimed row records={len(records_by_identity)}"
        )

    if expected_total != actual_total:
        raise SurfaceTagError(f"expected-vs-actual mismatch: expected {expected_total} row-surfaces, actual {actual_total}")

    return AssemblyBatch(rows=tuple(rows), expected_count=expected_total, actual_count=actual_total)


def compose_fragment(row: RowAssembly) -> str:
    """Thin adapter for verdict word plus tag; full stamp placement is deferred."""
    if "," in row.tag:
        raise SurfaceTagError("surface tag must never contain comma")
    if row.tag.startswith("[Adam accepted-risk "):
        raise SurfaceTagError("surface tag must never use accepted-risk prefix")
    leading_token = row.fragment.strip().split()[0].upper()
    if leading_token not in VALID_VERDICTS or leading_token != row.letter:
        raise SurfaceTagError("first whitespace token must be bare verdict word")
    return row.fragment


def _load_json(path: str) -> object:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _load_jsonl(path: str) -> list[dict]:
    out = []
    with open(path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SurfaceTagError(f"{path}:{line_no}: malformed jsonl: {exc}") from exc
            out.append(parsed)
    return out


def self_check() -> None:
    row = {"row": 1, "tab": "T", "spreadsheet_id": "S", "media_type": "image", "claimed_surfaces": ["copy", "creative"]}
    records = [
        {"row": 1, "tab": "T", "spreadsheet_id": "S", "surface": "copy", "verdict": "PASS", "evidence": "clean", "basis_file_id": "file1", "gate_version": "v1", "eyeball": "none"},
        {"row": 1, "tab": "T", "spreadsheet_id": "S", "surface": "creative", "verdict": "PASS", "evidence": "clean", "basis_file_id": "file1", "gate_version": "v1", "eyeball": "sampled"},
    ]
    result = assemble_batch([row], records)
    if len(result.rows) != 1 or compose_fragment(result.rows[0]) != "PASS [copy+creative]":
        raise SurfaceTagError("self-check failed")


def main(argv: list[str]) -> int:
    if argv == ["--self-check"]:
        try:
            self_check()
        except SurfaceTagError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print("surface_tag_assembler self-check OK")
        return 0

    if len(argv) != 2:
        print("usage: surface_tag_assembler.py <row-specs.json> <surface-records.jsonl>", file=sys.stderr)
        print("       surface_tag_assembler.py --self-check", file=sys.stderr)
        return 2

    try:
        row_specs = _load_json(argv[0])
        records = _load_jsonl(argv[1])
        result = assemble_batch(row_specs, records)
    except (OSError, json.JSONDecodeError, SurfaceTagError) as exc:
        print(f"surface-tag assembly refused: {exc}", file=sys.stderr)
        return 1

    for row in result.rows:
        print(json.dumps({
            "row": row.row,
            "tab": row.tab,
            "spreadsheet_id": row.spreadsheet_id,
            "letter": row.letter,
            "surfaces": list(row.surfaces),
            "status": row.status,
            "fragment": compose_fragment(row),
            "expected_surfaces": list(row.expected_surfaces),
            "consumed_surfaces": list(row.consumed_surfaces),
        }, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
