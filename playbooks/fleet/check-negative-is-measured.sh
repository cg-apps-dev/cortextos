#!/usr/bin/env bash
# Fixture for the three-part negative control in SPEC-single-voice-bootstrap-conflict.md.
#
# This is a TEST, not an example. The rest of that spec is prose that needs a reader;
# this fires. It runs the real failed search from 2026-07-25 that was published
# fleet-wide as "the line does not exist" — a false zero that hid a bootstrap
# contradiction in 24 files for hours.
#
# The point: TWO OF THE THREE CONTROLS PASS ON THAT ZERO. Only varying the pattern
# catches it. If this script ever fails, the rule it encodes has stopped holding.
#
# Usage:  bash playbooks/fleet/check-negative-is-measured.sh
# Exit:   0 = the three-part control still behaves as documented
#         1 = a control no longer discriminates; the spec's guidance is stale

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
F=templates/agent/AGENTS.md
fail=0

say() { printf '%-58s %s\n' "$1" "$2"; }
expect() { # expect <label> <actual-exit> <wanted-exit> <note>
  if [ "$2" = "$3" ]; then say "$1" "exit $2  ok   $4"
  else say "$1" "exit $2  FAIL wanted $3 -- $4"; fail=1; fi
}

[ -f "$F" ] || { echo "fixture corpus missing: $F"; exit 1; }
echo "corpus: $F"
echo

# --- 1. RAN? -----------------------------------------------------------------
# An invalid pattern prints "0 matches" on some engines and exits 2. A valid
# pattern that is genuinely absent exits 1. Unpiped: $? in a pipeline is the
# LAST command's, so | head or | wc -l substitutes the formatter's exit.
grep -q 'NEVER LEAVE THE USER' "$F"; a=$?
expect "1. RAN?      all-caps form (the original search)" "$a" 1 "valid pattern, reads as absent -> PASSES"

# --- 2. REACHED? -------------------------------------------------------------
# A positive control proves the corpus is reachable and the scope is right.
grep -q 'Telegram message arrives' "$F"; b=$?
expect "2. REACHED?  positive control, different string" "$b" 0 "corpus reachable -> PASSES"

# --- 3. RIGHT PATTERN? -------------------------------------------------------
# Neither check above can see that the pattern itself is wrong, because a
# positive control uses a DIFFERENT pattern. Vary YOUR OWN string instead:
# drop the case, drop a word, take the distinctive middle fragment.
grep -qi 'NEVER LEAVE THE USER' "$F"; c=$?
expect "3. PATTERN?  same string, case dropped" "$c" 0 "ABSENCE WAS FALSE"
grep -q 'leave the user as the last' "$F"; d=$?
expect "3. PATTERN?  distinctive middle fragment" "$d" 0 "ABSENCE WAS FALSE"
grep -q 'last person to have sent' "$F"; e=$?
expect "3. PATTERN?  leading words dropped" "$e" 0 "ABSENCE WAS FALSE"

# --- 4. LINE CONTINUATION ----------------------------------------------------
# Second axis of the same defect: A PATTERN THAT DOES NOT MATCH THE TEXT FOR A
# REASON THE PATTERN CANNOT SEE. Axis 1 was case. This is line structure.
# Real instance 2026-07-25: the-analyst grepped its own cron scripts for bus calls
# ending in >/dev/null and got ZERO across three files -- because the redirect sits
# on a CONTINUATION LINE after a backslash. Joining continuations first gave 12.
# Caught by implausibility (it knew it had written them), not by design.
CONT="$(mktemp)"; trap 'rm -f "$CONT"' EXIT
printf '%s\n' 'cortextos bus log-event action thing info \' '    --meta "{}" >/dev/null 2>&1' > "$CONT"
grep -q 'log-event.*>/dev/null' "$CONT"; f=$?
expect "4. CONTINUATION  single-line grep over a wrapped call" "$f" 1 "reads as absent -> FALSE ZERO"
# Join continuations, then match. This is the fix, not a second pattern.
perl -0pe 's/\\\s*\n\s*/ /g' "$CONT" | grep -q 'log-event.*>/dev/null'; g=$?
expect "4. CONTINUATION  continuations joined first" "$g" 0 "ABSENCE WAS FALSE"

# --- 5. SPECIFIC BUT NOT SENSITIVE -------------------------------------------
# Third axis, and the one no negative control can reach: A NEGATIVE CONTROL IS THE
# SPECIFICITY TEST. It proves the detector does not fire on the wrong thing. It
# says nothing about whether the detector fires on the RIGHT thing.
# So a pattern that matches NOTHING AT ALL passes every negative control offered
# and catches nothing -- perfectly specific, perfectly blind.
grep -q 'zzz_this_string_exists_nowhere' "$F"; h=$?
expect "5. SENSITIVITY   a pattern that matches nothing" "$h" 1 "passes as 'no false positives'"
# The sensitivity test is a KNOWN-PRESENT needle. It is a different question and
# needs a different fixture; specificity cannot answer it.
grep -q 'Telegram message arrives' "$F"; i=$?
expect "5. SENSITIVITY   known-present needle (the real test)" "$i" 0 "detector can actually fire"

echo
# Derive the summary from the accumulated failure flag, NOT by re-checking the
# values. An earlier version re-tested $a/$b/$c here and printed HOLDS while
# exiting 1 -- a label asserting a conclusion its own exit code contradicted,
# which is the exact defect this spec documents. The summary must not be able to
# disagree with the exit status.
if [ "$fail" = 0 ]; then
  echo "HOLDS: two controls passed on a zero that was wrong. Only the pattern check caught it."
else
  echo "STALE: the documented behaviour no longer reproduces. Re-read the spec before trusting its guidance."
fi
exit "$fail"
