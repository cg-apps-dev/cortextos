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

# --- 6. NO OUTPUT IS NOT A RESULT --------------------------------------------
# Fourth axis, and the only one the other five cannot reach, because it has no
# value to inspect. THREE INSTANCES ON 2026-07-25 (the-orchestrator once,
# the-analyst twice): an unquoted glob or a guessed path, zsh answers
# "no matches found", the command NEVER RUNS, and a conclusion gets published
# under it. One nearly closed a durability task on the finding that the tree it
# protects does not exist; there were 14 tracked files.
#
# ALL THREE PRODUCED NO OUTPUT AND A CONCLUSION ANYWAY. NOT ONE PRODUCED A WRONG
# VALUE -- which is why the class lands on careful people: THERE IS NOTHING TO
# CHECK. A wrong number invites arithmetic; an empty result invites a conclusion.
# It is also exactly where the night's one working detector goes blind:
# IMPLAUSIBILITY CANNOT FIRE ON ABSENCE, BECAUSE ABSENCE HAS NO MAGNITUDE TO BE
# ABSURD ABOUT (the-orchestrator).
GLOBDIR="$(mktemp -d)"; trap 'rm -f "$CONT"; rm -rf "$GLOBDIR"' EXIT
printf 'needle_is_here\n' > "$GLOBDIR/real.txt"
# THE FIRST DRAFT OF THIS AXIS FAILED ITS OWN FIXTURE, AND THE FAILURE IS THE
# FINDING. It asserted exit 1, because the three live instances were in zsh. Run
# under bash it returns 2. A PROBE WRITTEN FOR ONE SHELL AND RUN IN ANOTHER IS
# NOT A MEASUREMENT (SPEC-single-voice:426) -- committed while encoding a rule
# about unmeasured searches. Measured, both shells, rather than assumed:
#   bash: unmatched glob passes the literal through -> grep exit 2 = FILE ERROR
#   zsh:  "no matches found", THE COMMAND NEVER RUNS  -> exit 1
#   grep on a real file, genuinely absent             -> exit 1
# SO THE DANGER IS ZSH-SPECIFIC AND THE FLEET RUNS ZSH: zsh returns EXACTLY the
# code that means "searched, found nothing". bash at least returns a distinct 2 --
# a signal that exists and that nobody checks. In zsh there is no difference to
# ignore. That is why all three instances tonight were zsh.
grep -q 'needle_is_here' "$GLOBDIR"/*.nosuchext 2>/dev/null ; j=$?
expect "6. NO OUTPUT     bash: never-searched is exit 2, NOT 1" "$j" 2 "distinguishable -- if you check for 2"
if command -v zsh >/dev/null 2>&1; then
  zsh -c "grep -q needle_is_here '$GLOBDIR'/*.nosuchext 2>/dev/null" >/dev/null 2>&1; z=$?
  expect "6. NO OUTPUT     zsh: never-searched is exit 1 = 'absent'" "$z" 1 "IDENTICAL to a real zero"
fi
grep -q 'zzz_absent_needle' "$GLOBDIR"/real.txt 2>/dev/null ; m=$?
expect "6. NO OUTPUT     a REAL search that found nothing" "$m" 1 "same 1 zsh returns for never-ran"
# The fix is not a better pattern. It is asserting the search had something to
# search: resolve the target list FIRST and refuse when it is empty.
FILES=( "$GLOBDIR"/*.txt )
if [ ! -e "${FILES[0]}" ]; then k=2; else grep -q 'needle_is_here' "${FILES[@]}"; k=$?; fi
expect "6. NO OUTPUT     target list resolved and asserted first" "$k" 0 "ABSENCE WAS FALSE"
# And the guard itself must be exercised: an empty target list returns 2
# (UNMEASURED), never 1 (absent). Same shape as assert-the-value-not-the-key and
# as the positive control on the same pid -- prove the thing ran before reading it.
EMPTY=( "$GLOBDIR"/*.nosuchext )
if [ ! -e "${EMPTY[0]}" ]; then l=2; else grep -q 'needle_is_here' "${EMPTY[@]}"; l=$?; fi
expect "6. NO OUTPUT     empty target list returns UNMEASURED not absent" "$l" 2 "2 != 1: unmeasured != clean"

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
