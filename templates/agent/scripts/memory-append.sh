#!/usr/bin/env bash
# memory-append.sh - append one dated entry to today's daily-memory file, SAFELY.
#
# WHY THIS IS A SCRIPT AND NOT THE INLINE HEREDOC IN AGENTS.md / HEARTBEAT.md
# --------------------------------------------------------------------------
# The memory-write snippet in AGENTS.md (Session Start/End) and HEARTBEAT.md
# Step 5 is `cat >> "memory/$TODAY.md" << MEMEOF ... MEMEOF` with an UNQUOTED
# delimiter. That one snippet has TWO independent failure modes, both hit the
# same night (2026-08-27/28):
#
#   1. COMMAND SUBSTITUTION OF THE NOTE BODY. An unquoted heredoc expands any
#      backtick or $(...)/${...} in the note TEXT. A note carrying a literal
#      code ref (e.g. a bare `--` in backticks) RUNS it as a command
#      ("command not found: --"), silently drops the token, and corrupts the
#      note - and would EXECUTE any $(...) an agent happened to type (a mild
#      injection surface). (the-sop-keeper, 2026-08-28.)
#   2. ARG-PARSE BLANK TIMESTAMP. The inline `$(date -u +%H:%M:%S UTC)` errors
#      ("illegal time format") because the trailing ` UTC` sits OUTSIDE the
#      format-string quotes, so date parses it as a second operand and the
#      heredoc substitutes EMPTY - a blank heading. (the-orchestrator,
#      2026-08-27; the-sop-keeper, 2026-07-28.)
#
# This script resolves both: the TIMESTAMP is computed HERE (literal quoted
# INSIDE the format string - mode 2 fixed), and the NOTE BODY arrives as DATA
# and is written VERBATIM, never re-expanded by any shell (mode 1 fixed). A
# snippet retyped every cycle is a remembered rule wearing a code block's
# clothes; this one is invoked. (Same principle as kb-ingest-verified.sh.)
#
# TARGET-FILE DATE BASIS: LOCAL DAY, NOT `date -u` (the-orchestrator review,
# --------------------------------------------------------------------------
# 2026-08-28). The daily file should hold one CONTIGUOUS PT-DAY narrative. The
# AGENTS.md convention names it `memory/$(date -u +%F).md` - but from 00:00 to
# ~07:00 UTC (evening PT) `date -u` already reads TOMORROW while the PT day is
# still today, so a UTC-named file FRAGMENTS one PT day across two files (banked
# 2026-08-09; the evening-review SKILL carries the manual correction). This
# helper names the file by LOCAL day (TZ-aware; TZ/CTX_TIMEZONE is PT on this
# fleet), so every note in one PT day lands in one file. The 00:00-07:00Z window
# is where the two bases differ; going forward, files are named by local day.
# The template-doc swap must switch the docs' `date -u` reads (session-start
# read + the HEARTBEAT Step-10 kb-ingest path) to local day TOO, or the helper
# and the reingest step target different files during that window.
#
# USAGE - two body sources. <label> is the semantic heading (e.g.
# "Heartbeat (DAY)", "Session Start"); the script prepends "## " and appends
# " - <UTC> / <LOCAL>".
#
#   PREFERRED (zero expansion surface): write the note to a scratch file with a
#   no-shell tool (the Edit/Write tool), then point the helper at it:
#       ./scripts/memory-append.sh -f /path/to/note.txt "Heartbeat (DAY)"
#   The file is read byte-for-byte; NOTHING is ever expanded by any shell. This
#   is the recommended default for any agent that has file tools.
#
#   QUICK INLINE (stdin via a QUOTED heredoc):
#       ./scripts/memory-append.sh "Heartbeat (DAY)" <<'NOTE'
#       - WORKING ON: `task_123`   # backticks, $(...), ${...}, apostrophes: literal
#       NOTE
#
# THE NAMED RESIDUAL (per the-orchestrator, 2026-08-28). STDIN is safer than a
# single-quoted positional arg (which breaks on apostrophes - notes contain
# "agent's" - and caps length), and it moves the note-body OUT of argv. But the
# stdin form still depends on the caller QUOTING the delimiter: an agent who
# types <<NOTE instead of <<'NOTE' gets the body expanded IN THEIR OWN SHELL
# before the helper ever receives it, and the helper cannot detect that from
# inside. That is the remembered-rule dependency this fix exists to remove,
# surviving at ONE token instead of a whole block - a real shrink, not an
# elimination. The -f <file> form REMOVES even that residual (no heredoc, no
# delimiter to quote); it is the belt to stdin's suspenders, and the SOP shows
# -f as the default.
#
# ENV OVERRIDES
#   MEMORY_FILE       absolute path to the exact target file (highest priority;
#                     for edge cases / tests). Bypasses dir+date resolution.
#   MEMORY_DIR        directory to hold <local-day>.md (default: <agentdir>/memory).
#   MEMORY_NOW_EPOCH  unix seconds to treat as "now" (TEST hook; makes the
#                     rollover deterministic). Default: real now.
#
# DESIGN RULES (from kb-ingest-verified.sh, learned the hard way):
#   1. The BODY is DATA. It passes through unexpanded, verbatim, always.
#   2. FAIL CLOSED. If the append cannot be verified on disk, exit non-zero -
#      a false alarm costs a re-run; a false pass loses the memory silently.
#
# PLATFORM: BSD date (macOS) - uses `date -r <epoch>` (epoch ref) and
# `date -j -f` (parse). This fleet runs on darwin; kb-ingest-verified.sh and
# the templates already assume BSD date.
#
# EXIT CODES  0 appended + verified   3 write/verify failed   5 usage error
#
# SELF-TEST:  ./memory-append.sh --self-test
#   (a) drives build_entry() with an adversarial body and asserts every char
#       survives VERBATIM; (b) an e2e -f run; (c) a fixed-TZ ROLLOVER fixture
#       asserting the target file is named by LOCAL day, not UTC.

set -o pipefail

# --- entry assembly, separated from execution so it can be driven directly ---
# args: <label> <utc> <local>;  stdin: note body (verbatim);  stdout: entry block
build_entry() {
    local label="$1" utc="$2" local_time="$3"
    local body; body="$(cat)"
    printf '\n## %s - %s / %s\n%s\n' "$label" "$utc" "$local_time" "$body"
}

# --- the daily-file date: LOCAL day for MEMORY_NOW_EPOCH (or real now) ---
# Isolated so the self-test can drive it under a fixed TZ + epoch.
target_date() {
    local e="${MEMORY_NOW_EPOCH:-$(date +%s)}"
    date -r "$e" +'%Y-%m-%d'
}

usage() {
    echo "usage: $0 -f <file> \"<label>\"          # body from file (no shell, preferred)" >&2
    echo "       $0 \"<label>\" <<'NOTE' ... NOTE     # body from stdin (quote the delimiter)" >&2
    echo "       $0 --self-test" >&2
}

self_test() {
    local fails=0
    local utc="12:34 UTC" local_time="5:34 AM PDT"
    # Build the fixture with `read -r -d ''` (NOT $(cat <<...)): a quoted heredoc
    # nested in $(...)"..." trips bash quote-tracking on the apostrophe. read has
    # no such nesting. It hits EOF with no NUL and returns 1 - expected.
    local body
    IFS= read -r -d '' body <<'FIXTURE'
- backtick `--` and $(whoami) and ${HOME} and {a,b,c} stay literal; agent's note
NOTE
MEMEOF
- trailing line after the delimiter words
FIXTURE

    # (a) PURE build_entry - source-agnostic assembly.
    local out; out="$(printf '%s' "$body" | build_entry "Heartbeat (TEST)" "$utc" "$local_time")"
    local probe
    for probe in '`--`' '$(whoami)' '${HOME}' '{a,b,c}' "agent's note" \
                 'NOTE' 'MEMEOF' 'trailing line after the delimiter words'; do
        case "$out" in *"$probe"*) : ;; *) echo "self-test FAIL: verbatim lost: $probe"; fails=$((fails+1));; esac
    done
    case "$out" in
        *"## Heartbeat (TEST) - 12:34 UTC / 5:34 AM PDT"*) : ;;
        *) echo "self-test FAIL: header/timestamp malformed"; fails=$((fails+1));; esac

    # (b) END-TO-END via -f <file> into a throwaway MEMORY_DIR.
    local tmp; tmp="$(mktemp -d)" || { echo "self-test FAIL: mktemp"; return 1; }
    printf '%s\n' "$body" > "$tmp/note.txt"
    if MEMORY_DIR="$tmp/memory" "$0" -f "$tmp/note.txt" "E2E (TEST)" >/dev/null 2>&1; then
        local wrote; wrote="$(cat "$tmp/memory/"*.md 2>/dev/null)"
        for probe in '`--`' '$(whoami)' '${HOME}' '{a,b,c}' 'NOTE' 'MEMEOF'; do
            case "$wrote" in *"$probe"*) : ;; *) echo "self-test FAIL: e2e verbatim lost: $probe"; fails=$((fails+1));; esac
        done
        case "$wrote" in *"## E2E (TEST) - "*) : ;; *) echo "self-test FAIL: e2e header missing"; fails=$((fails+1));; esac
    else
        echo "self-test FAIL: e2e -f run exited non-zero"; fails=$((fails+1))
    fi
    rm -rf "$tmp"

    # (c) ROLLOVER: 2026-08-28 06:00Z == 2026-08-27 23:00 PDT. LOCAL basis must
    #     name the file by the PT day (08-27), NOT the UTC day (08-28).
    local ep; ep="$(date -u -j -f '%Y-%m-%d %H:%M:%S' '2026-08-28 06:00:00' +%s 2>/dev/null)"
    if [ -n "$ep" ]; then
        local d_pt d_utc
        d_pt="$(export TZ='America/Los_Angeles' MEMORY_NOW_EPOCH="$ep"; target_date)"
        d_utc="$(export TZ='UTC' MEMORY_NOW_EPOCH="$ep"; target_date)"
        [ "$d_pt" = "2026-08-27" ] || { echo "self-test FAIL: rollover local day = $d_pt, want 2026-08-27"; fails=$((fails+1)); }
        [ "$d_utc" = "2026-08-28" ] || { echo "self-test FAIL: rollover UTC day = $d_utc, want 2026-08-28 (sanity)"; fails=$((fails+1)); }
        [ "$d_pt" != "$d_utc" ] || { echo "self-test FAIL: rollover bases did not diverge"; fails=$((fails+1)); }
    else
        echo "self-test FAIL: could not build rollover epoch (BSD date -j -f)"; fails=$((fails+1))
    fi

    if [ "$fails" -eq 0 ]; then echo "self-test OK - verbatim (pure + e2e -f), timestamp intact, local-day rollover correct"; return 0; fi
    echo "self-test FAILED: $fails assertion(s)"; return 1
}

[ "${1:-}" = "--self-test" ] && { self_test; exit $?; }

# --- argument parsing: -f <file> <label>  |  <label> (stdin) ---
body_file=""
if [ "${1:-}" = "-f" ]; then
    [ $# -eq 3 ] || { usage; exit 5; }
    body_file="$2"; label="$3"
    [ -f "$body_file" ] || { echo "ERROR: -f file not found: $body_file" >&2; exit 5; }
else
    [ $# -eq 1 ] || { usage; exit 5; }
    label="$1"
fi
[ -n "$label" ] || { echo "usage error: <label> must be non-empty" >&2; exit 5; }

# Timestamp + filename from one reference epoch (real now, or the test hook).
# Literal quoted INSIDE the format string (mode-2 fix). Local time best-effort.
now_epoch="${MEMORY_NOW_EPOCH:-$(date +%s)}"
utc="$(date -u -r "$now_epoch" +'%H:%M UTC')"
local_time="$(date -r "$now_epoch" +'%-I:%M %p %Z' 2>/dev/null || date -r "$now_epoch")"

# Target file: MEMORY_FILE wins; else MEMORY_DIR/<local-day>.md; else agentdir.
if [ -n "${MEMORY_FILE:-}" ]; then
    target="$MEMORY_FILE"
    mkdir -p "$(dirname "$target")" || { echo "ERROR: cannot create dir for $target" >&2; exit 3; }
else
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    memory_dir="${MEMORY_DIR:-$(cd "$script_dir/.." && pwd)/memory}"
    mkdir -p "$memory_dir" || { echo "ERROR: cannot create $memory_dir" >&2; exit 3; }
    target="$memory_dir/$(target_date).md"
fi

header="## $label - $utc / $local_time"
if [ -n "$body_file" ]; then
    build_entry "$label" "$utc" "$local_time" < "$body_file" >> "$target" \
        || { echo "ERROR: append to $target failed" >&2; exit 3; }
else
    build_entry "$label" "$utc" "$local_time" >> "$target" \
        || { echo "ERROR: append to $target failed" >&2; exit 3; }
fi

# Fail-closed verify: the exact header line must now be present on disk.
if grep -qF -- "$header" "$target"; then
    echo "appended + verified -> $target"
    echo "  $header"
    exit 0
fi
echo "ERROR: append reported success but header not found in $target (fail-closed)" >&2
exit 3
