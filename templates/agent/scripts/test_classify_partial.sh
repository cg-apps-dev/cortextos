#!/usr/bin/env bash
# test_classify_partial.sh - planted-partial invariant test for kb-ingest-verified.sh classify().
#
# Security-authored (the-security-agent) two-touch of the checkpoint-resume classify() branch.
# Self-contained: extracts classify() from the target script and drives it with inline
# fixtures - no external fixture files, so it tracks and runs anywhere.
#
# THE LOAD-BEARING INVARIANT: a budget-bounded PARTIAL (mmrag exit 75 + INGEST_PARTIAL
# marker) must NEVER render as a green/complete result, and any INCONSISTENT partial-shaped
# state must fail CLOSED - never green. mmrag prints "Done! Ingested N new chunk(s)" on EVERY
# run including partials (mmrag.py ~1449), so a real partial's stdout carries the OK success
# text; classify must disambiguate on the EXIT CODE, not the text.
#
# Usage:  ./test_classify_partial.sh [path-to-kb-ingest-verified.sh]
#         defaults to the sibling kb-ingest-verified.sh next to this test.
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/kb-ingest-verified.sh}"
[ -f "$SCRIPT" ] || { echo "test FAILED: target script not found: $SCRIPT"; exit 1; }

# Extract classify() in isolation so we drive the exact shipped function.
CLS="$(awk '/^classify\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$SCRIPT")"
[ -n "$CLS" ] || { echo "test FAILED: could not extract classify() from $SCRIPT"; exit 1; }
eval "$CLS"

fails=0 total=0
check() { # name  expected  exit_code  stdin-content
    total=$((total+1))
    local name="$1" expected="$2" ec="$3" body="$4" got
    got="$(printf '%s' "$body" | classify "$ec")"
    case "$got" in
        "$expected"|"$expected"_*) printf '  PASS  %-38s -> %s\n' "$name" "$got" ;;
        *) printf '  FAIL  %-38s -> %s (expected %s)\n' "$name" "$got" "$expected"; fails=$((fails+1)) ;;
    esac
}

# The realistic partial: exit 75 + marker + the "Ingested N new chunk(s)" success text mmrag
# always prints. Must be PARTIAL, NOT OK - proves classify keys on exit before the count check.
check "partial_realistic_with_ok_text" PARTIAL 75 \
'Done! Ingested 5 new chunk(s) into '\''c'\''
INGEST_PARTIAL done=5 total=20 remaining=15'

# exit 75 with NO marker: a bare 75 is not a trusted partial -> fail CLOSED to ERROR.
check "bare_exit75_no_marker" ERROR 75 \
'Done! Ingested 5 new chunk(s) into '\''c'\'''

# exit 75, marker only (no Done-text) -> PARTIAL.
check "partial_marker_only" PARTIAL 75 \
'INGEST_PARTIAL done=5 total=20 remaining=15'

# THE PLANTED GAP (red on 749e4f70, green on the guard): marker present but exit 0 is an
# INCONSISTENT partial-shaped state (marker<->exit75 is the engine contract). It must fail
# CLOSED to UNRECOGNISED, never green - even though the OK success text is present.
check "marker_with_exit0_okcount_FAILCLOSED" UNRECOGNISED 0 \
'Done! Ingested 5 new chunk(s) into '\''c'\''
INGEST_PARTIAL done=5 total=20 remaining=15'

# Same gap, VERIFIED-green variant: marker + exit 0 + "Ingested 0 new chunk".
check "marker_with_exit0_zerocount_FAILCLOSED" UNRECOGNISED 0 \
'Done! Ingested 0 new chunk(s) into '\''c'\''
INGEST_PARTIAL done=0 total=20 remaining=20'

# exit-other-nonzero + marker stays ERROR (guard must sit AFTER the ERROR branch).
check "exit1_with_marker_stays_ERROR" ERROR 1 \
'error: embedding API 503
INGEST_PARTIAL done=5 total=20 remaining=15'

# Untouched happy paths - guard must not regress a normal complete/zero run (exit 0, NO marker).
check "complete_no_marker" OK 0 \
'Done! Ingested 20 new chunk(s) into '\''c'\'''
check "zero_unchanged_no_marker" VERIFIED 0 \
'Done! Ingested 0 new chunk(s) into '\''c'\'''

echo
if [ "$fails" -eq 0 ]; then
    echo "classify partial-invariant test OK - $total/$total"
    exit 0
fi
echo "classify partial-invariant test FAILED: $fails of $total"
exit 1
