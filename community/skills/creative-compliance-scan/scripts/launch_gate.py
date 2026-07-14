#!/usr/bin/env python3
"""Pure two-surface launch-gate decision logic.

Phase 1 only: deterministic cell parsing and routing. The live sheet reader and
enforcement wiring are separate phases.
"""
from datetime import date
import re


COPY_HEADER = "Copy Compliance Agent"
CREATIVE_HEADER = "Meta Compliance Agent"
SHEET_ID = "1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"
FIXED_SCANNER_DATE = date(2026, 7, 13)
ACCEPTED_RISK_PREFIX = "[Adam accepted-risk "
CREATIVE_MARKERS = ("frames+VO", "VO audio+frames", "creative v2.1", "Phase 1-V")
COPY_MARKERS = ("copy-gate",)

_VERDICTS = {"PASS", "FAIL", "UNCLEAR"}
_SCANNED_RE = re.compile(r"\bscanned\s+(\d{4})-(\d{2})-(\d{2})\b")


def _cell_text(cell):
    return cell if isinstance(cell, str) else ""


def leading_verdict(cell):
    s = _cell_text(cell).strip()
    if s == "":
        return "NONE"
    tok = s.split()[0].upper()
    return tok if tok in _VERDICTS else "INVALID"


def has_accepted_risk(cell):
    return ACCEPTED_RISK_PREFIX in _cell_text(cell)


def _scanned_date(cell):
    match = _SCANNED_RE.search(_cell_text(cell))
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def is_fixed_scan(cell, surface):
    text = _cell_text(cell)
    if surface == "creative":
        markers = CREATIVE_MARKERS
    elif surface == "copy":
        markers = COPY_MARKERS
    else:
        return False
    marker_present = any(marker in text for marker in markers)
    scanned = _scanned_date(text)
    return bool(marker_present and scanned is not None and scanned >= FIXED_SCANNER_DATE)


def _surface_failure(surface, cell):
    verdict = leading_verdict(cell)
    if verdict in ("NONE", "INVALID"):
        return {
            "surface": surface,
            "kind": "unscanned",
            "route": f"{surface}: trigger scan",
            "reason": f"{surface} unscanned or invalid verdict",
        }
    if verdict == "PASS" and not is_fixed_scan(cell, surface):
        return {
            "surface": surface,
            "kind": "stale_pass",
            "route": f"{surface}: re-scan",
            "reason": f"{surface} stale PASS, re-scan with fixed scanner",
        }
    if verdict == "FAIL":
        return {
            "surface": surface,
            "kind": "fail",
            "route": "creative: re-edit" if surface == "creative" else "copy: copy-rewrite",
            "reason": f"{surface} FAIL",
        }
    if verdict == "UNCLEAR":
        return {
            "surface": surface,
            "kind": "unclear",
            "route": f"{surface}: mc/Adam review",
            "reason": f"{surface} UNCLEAR, mc/Adam review",
        }
    return {
        "surface": surface,
        "kind": "unscanned",
        "route": f"{surface}: trigger scan",
        "reason": f"{surface} malformed verdict",
    }


def _block(failures):
    failing_surface = failures[0]["surface"] if len(failures) == 1 else None
    return {
        "decision": "BLOCK",
        "reason": "; ".join(failure["reason"] for failure in failures),
        "route": "; ".join(failure["route"] for failure in failures),
        "failing_surface": failing_surface,
    }


def launch_gate(creative_cell, copy_cell):
    if has_accepted_risk(creative_cell) or has_accepted_risk(copy_cell):
        return {
            "decision": "ELIGIBLE",
            "reason": "accepted-risk override",
            "route": "accepted-risk override",
            "failing_surface": None,
        }

    failures = []
    for surface, cell in (("creative", creative_cell), ("copy", copy_cell)):
        verdict = leading_verdict(cell)
        if not (verdict == "PASS" and is_fixed_scan(cell, surface)):
            failures.append(_surface_failure(surface, cell))

    if not failures:
        return {
            "decision": "ELIGIBLE",
            "reason": "clean two-surface fixed PASS",
            "route": "launch eligible",
            "failing_surface": None,
        }
    return _block(failures)


def launch_gate_single(cell):
    if has_accepted_risk(cell):
        return {
            "decision": "ELIGIBLE",
            "reason": "accepted-risk override",
            "route": "accepted-risk override",
            "failing_surface": None,
        }
    if leading_verdict(cell) == "PASS" and is_fixed_scan(cell, "creative"):
        return {
            "decision": "ELIGIBLE",
            "reason": "clean fixed PASS",
            "route": "launch eligible",
            "failing_surface": None,
        }
    return _block([_surface_failure("creative", cell)])


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) != 3:
        print("usage: launch_gate.py <creative-cell> <copy-cell>", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(launch_gate(sys.argv[1], sys.argv[2]), sort_keys=True))
