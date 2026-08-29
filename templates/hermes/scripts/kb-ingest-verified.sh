#!/usr/bin/env bash
# kb-ingest-verified.sh - ingest memory to the KB, one file at a time, and VERIFY it indexed.
#
# WHY THIS IS A SCRIPT AND NOT A SNIPPET IN HEARTBEAT.md
# ------------------------------------------------------
# The inline guard at HEARTBEAT.md:136 was never wrong. It has all four
# branches. It failed on 2026-07-27 because it has to be RETYPED CORRECTLY
# EVERY CYCLE, and that cycle I improvised a substitute that negative-matched
# for "0 chunks" and used --collection, the exact flag the same block warns
# does not exist, four lines away. My version printed a green tick directly
# beneath an "unknown option" error.
#
# A guard that must be retyped is a remembered rule wearing a code block's
# clothes. This one is invoked.
#
# 2026-07-29 SYNTHESIS (the-sop-keeper, propagating fleet-wide): this script
# and the-team-lead's inline HEARTBEAT.md Step 10 guard were each missing what
# the other one had. This script had no defense against the-team-lead's
# 2026-07-28 incident: `cortextos bus kb-ingest "$@" ...` passes every file
# argument to ONE spawnSync call under a wall-clock timeout, not a token
# ceiling - two files combined (~109,591 embedding tokens, measured) SIGTERM'd
# silently while still exiting through a green-looking path. The inline guard
# had no defense against what THIS script already solved: a guard that must be
# retyped every cycle is a remembered rule wearing a code block's clothes, and
# fails exactly like the 2026-07-27 incident that motivated writing this file
# in the first place. Fixed here: loop callers to ONE cortextos bus kb-ingest
# call PER FILE (below), and added a query-back per file, because the-team-lead
# also measured a mid-write ingest reporting real chunk counts for content that
# was not yet current (a query five minutes later, for content banked in the
# gap, came back absent - the chunk count confirms the write happened and
# cannot see this). Everything below this note - classify(), self-test, the
# pre-flight checks - is unchanged from the original.
#
# DESIGN RULES, both learned the hard way on 2026-07-27:
#   1. ASSERT SUCCESS POSITIVELY. Do not enumerate failures - enumerating bad
#      shapes only ever finds the ones you already imagined.
#   2. FAIL CLOSED on anything unrecognised. A fail-closed guard yields false
#      ALARMS (cost: a re-run). A fail-open guard yields false PASSES (cost: a
#      silent gap). Take the first every time.
#
# EXIT CODES  0 verified  3 ingest error/child-kill  4 unrecognised (closed)
#             5 usage error
#             (with multiple files: exit code is the WORST across all files)
#
# SELF-TEST:  ./kb-ingest-verified.sh --self-test
#             Drives classify() with known-bad inputs. Run it after any edit;
#             a classifier that has never returned non-zero is a claim about a
#             check, not a check.

set -o pipefail

# --- classification, separated from execution so it can be driven directly ---
# stdin: merged stdout+stderr capture.
# arg 1: child exit code.
# stdout: one of OK_<n> / VERIFIED / CHILD_KILL / ERROR / UNRECOGNISED
classify() {
    local exit_code="${1:-0}"
    local out; out="$(cat)"

    # Ordered fail-first. CHILD_KILL must beat both a success-looking exit and
    # an "Ingested 0 new" line: the authentic failure artifact is the stable
    # spawnSync-result tail plus Node crash banner, not a wall-clock value.
    if printf '%s' "$out" | grep -qE "stderr:[[:space:]]*null" &&
       printf '%s' "$out" | grep -qE "Node[.]js v[0-9]+[.][0-9]+[.][0-9]+"; then
        printf 'CHILD_KILL'; return
    fi
    if [ "$exit_code" -ne 0 ] 2>/dev/null ||
       printf '%s' "$out" | grep -qiE "error:|Traceback|Errors: [1-9]|Killed|command not found"; then
        printf 'ERROR'; return
    fi
    # POSITIVE assertion: a real count, captured, not merely "not a failure".
    local n
    n="$(printf '%s' "$out" | grep -oE "Ingested [0-9]+ new chunk" | grep -oE "[0-9]+" | head -1)"
    if [ -n "$n" ] && [ "$n" -gt 0 ] 2>/dev/null; then
        printf 'OK_%s' "$n"; return
    fi
    # 0-new is verified current as of the ingest's own file-read snapshot:
    # mmrag computes desired chunk IDs from the current file content and deletes
    # stale IDs. HEARTBEAT Step 10 must still run ingest last so no post-read
    # memory write is missed by that snapshot.
    if [ -n "$n" ] && [ "$n" -eq 0 ] 2>/dev/null; then
        printf 'VERIFIED'; return
    fi
    printf 'UNRECOGNISED'
}

self_test() {
    # Resolve fixtures relative to THIS script (BASH_SOURCE), never a hardcoded
    # operator-home path. An absolute /Users/... default is an operator-home leak
    # shape AND a cross-agent absolute dep - both block templating this script
    # fleet-wide. On a copy that lacks the fixtures this falls through to the
    # "manifest missing" check below (fine: the fixtures are this agent's own
    # authored test data, not a fleet dependency).
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
    local manifest="${1:-$script_dir/../research/kb-ingest-fixtures/manifest.tsv}"
    local fixture_dir
    fixture_dir="$(dirname "$manifest")"
    [ -f "$manifest" ] || { echo "self-test FAILED: manifest missing: $manifest"; return 1; }

    local fails=0 total=0 got expected_prefix name fixture_file exit_code expected_class fixture_path
    while IFS=$'\t' read -r name fixture_file exit_code expected_class; do
        [ -z "$name" ] && continue
        [ "$name" = "name" ] && continue
        total=$((total+1))
        fixture_path="$fixture_dir/$fixture_file"
        if [ ! -f "$fixture_path" ]; then
            printf '  FAIL  %-34s -> missing fixture %s\n' "$name" "$fixture_file"
            fails=$((fails+1))
            continue
        fi
        got="$(classify "$exit_code" < "$fixture_path")"
        expected_prefix="$expected_class"
        [ "$expected_class" = "OK" ] && expected_prefix="OK_"
        case "$got" in
            "$expected_prefix"*) printf '  PASS  %-34s -> %s\n' "$name" "$got" ;;
            *)                   printf '  FAIL  %-34s -> %s (expected %s)\n' "$name" "$got" "$expected_class"; fails=$((fails+1)) ;;
        esac
    done < "$manifest"
    echo
    if [ "$fails" -eq 0 ]; then
        echo "self-test OK - $total/$total fixtures"
        return 0
    fi
    echo "self-test FAILED: $fails of $total fixture(s)"; return 1
}

# query-back: an independent witness that content just ingested is actually
# retrievable, not just reported as chunked (the-team-lead, 2026-07-28: an
# ingest is a snapshot at its START - a mid-write ingest can report a real
# chunk count for content that, five minutes later, is still absent from a
# query, because the file kept changing after the snapshot was taken).
query_back() {
    local f="$1"
    local snippet
    snippet="$(tail -c 400 "$f" 2>/dev/null | tr -s '[:space:]' ' ' | tail -c 100)"
    [ -z "$snippet" ] && return 0
    local qout
    # --json + no truncation (not `| head -8` on pretty-printed output - that
    # was a false-MISS found by codex-dev-agent, 2026-07-29, fixed once already).
    # --top-k 30, not the default 5 (a SECOND false-MISS mode, found and
    # diagnosed by meta-compliance-agent, 2026-07-29, same day): an agent with
    # consistent memory-writing style produces daily files that are
    # semantically homogeneous to EACH OTHER - a tail snippet of general
    # principle-language can match every other day's file at least as well as
    # today's, so today's file can rank outside a narrow top-N while still
    # being genuinely, correctly indexed. This is DETERMINISTIC and a same-query
    # retry does not help it (verified directly: repeating an identical top-15
    # query twice gave 0/0, top-30 found it both times) - only widening the net
    # fixes it, and the right width isn't a universal constant: meta-compliance's
    # case needed 15, the-sop-keeper's own needed 30 (one sibling day's file
    # dominated the top-20 with 9 near-duplicate hits). 30 is a practical
    # compromise, not a guarantee - a sufficiently repetitive corpus could still
    # exceed it. Widening beats querying on a guaranteed-unique token (the
    # alternative meta-compliance also verified working) because it doesn't
    # depend on the file's own content containing its date string, which isn't
    # true for every agent's format.
    #
    # A candidate THIRD failure mode (read-after-write index lag / ANN-search
    # nondeterminism) was proposed on 2026-07-29 from an observed MISS->OK flip
    # on a byte-identical re-run, and briefly justified a bounded retry here.
    # WITHDRAWN by its own reporter within the hour: the flip was pre-patch, on
    # the old top-k 5 code, misdated as post-patch by a `stat` timestamp that
    # printed LOCAL time with a UTC "Z" suffix wrongly appended. The flip is
    # fully explained by the top-k fix above (the file crossed the rank-5
    # boundary between two runs, before top-k was widened) - no second
    # mechanism is confirmed. NOT adding a retry on unevidenced grounds - if a
    # genuine post-patch flip is ever demonstrated (ingest+query immediately,
    # query again after a pause, same file, MISS then HIT at the current top-k),
    # that is the point to revisit this, not before.
    qout="$(cortextos bus kb-query "$snippet" --org "$CTX_ORG" --agent "$CTX_AGENT_NAME" --scope private --json --top-k 30 2>&1)"
    if printf '%s' "$qout" | grep -oE '"source_file": *"[^"]*"' | grep -qF "$(basename "$f")"; then
        echo "   query-back OK: $(basename "$f") is retrievable"
        return 0
    fi
    # SECOND, ORTHOGONAL SIGNAL (meta-compliance-agent, 2026-07-29): even top-30
    # missed a 9-chunk file whose tail was a truncated task ID + a prose clause -
    # not distinctive to begin with, so no amount of widening rescues it (a weak
    # query stays weak). Widening helps homogeneity (many similar files); it
    # cannot help a query that was never discriminative. Fix: also try a query
    # on the FILE'S OWN DATE-STEM (e.g. "2026-07-29", from its filename, not its
    # content) - content-independent, format-independent, no assumption the file
    # happens to mention its own date (the exact objection that killed
    # meta-compliance's original unique-token proposal). team-lead's "a unique
    # token misses just as reliably if the index hasn't committed" doesn't apply
    # here as a reason to skip this second try: if the index truly hasn't
    # committed, THIS query fails too and the MISS is reported correctly, same
    # as the first. Pass if EITHER signal surfaces the file - a genuinely absent
    # file still fails both; a merely-low-ranking one is rescued without crying
    # wolf on a real ingest.
    #
    # SECOND CORRECTION, by the same reporter (meta-compliance-agent, 2026-07-29,
    # within the hour, with a controlled measurement): the "content-independent"
    # claim above is FALSE. The stem query only works because the file's own
    # TEXT happens to repeat its date (e.g. full ISO timestamps in every entry
    # heading) - it is a second semantic query, not a lexical lookup, and a date
    # string embeds distinctively only when the surrounding text keeps saying it.
    # Measured: two of their own indexed files (confirmed via chunk count first,
    # so an absence couldn't be confused with never-ingested) contain ZERO
    # occurrences of their own date and the bare stem query missed both - 13/41
    # of their files (32%, all pre-dating a heading-format change) are in this
    # position. The fallback is real and worth trying, but its reliability rides
    # on an agent's own formatting habit, not a property of the mechanism.
    #
    # ROOT CONSTRAINT (meta-compliance-agent): `kb-query` has no source_file
    # filter and no lexical path at all - there is no way to directly ask "is
    # THIS file present," only to ask semantically and inspect what comes back.
    # Every fix at this layer is therefore a better SEMANTIC guess, never a
    # definitive check - which is why this function reports two DIFFERENT
    # things below rather than one verdict.
    local stem
    stem="$(basename "$f" .md)"
    if [ -n "$stem" ] && [ "$stem" != "MEMORY" ]; then
        local qout2
        qout2="$(cortextos bus kb-query "$stem" --org "$CTX_ORG" --agent "$CTX_AGENT_NAME" --scope private --json --top-k 30 2>&1)"
        if printf '%s' "$qout2" | grep -oE '"source_file": *"[^"]*"' | grep -qF "$(basename "$f")"; then
            echo "   query-back OK: $(basename "$f") is retrievable (via filename-stem query)"
            return 0
        fi
    fi
    # TWO DIFFERENT PROPERTIES, REPORTED AS TWO LINES, NOT ONE VERDICT
    # (meta-compliance-agent's fix, smaller than a rewrite): "did it ingest" is
    # already answered ORTHOGONALLY AND RELIABLY by the chunk count printed
    # above (classify()'s job, proven by the-team-lead's and meta-compliance's
    # own append-and-recount tests) - this function's MISS says nothing about
    # that and should not be read as casting doubt on it. "Can I retrieve it"
    # is what this line actually tests, and a MISS here is a genuine, often
    # benign fact about retrieval modality (no lexical path, a short/generic
    # tail, or a filename the file's own text never repeats) - not evidence the
    # ingest failed. Do not re-run the ingest on this signal alone; the chunk
    # count already told you whether that part worked.
    echo "ℹ️  retrieval note: $(basename "$f") - ingestion already confirmed by the chunk count above; NOT surfaced by either semantic query tried here (tail content, filename stem). This reflects a retrieval-modality limit (same-day content homogeneity, a non-discriminative tail, or a filename this file's own text doesn't repeat) - not a sign the ingest itself is wrong. If you specifically need to confirm retrievability, query with a phrase you know is unusually distinctive in this file's content."
}

[ "$1" = "--self-test" ] && { shift; self_test "$1"; exit $?; }

[ $# -eq 0 ] && { echo "usage: $0 <file>... | --self-test" >&2; exit 5; }
: "${CTX_ORG:?CTX_ORG not set}" ; : "${CTX_AGENT_NAME:?CTX_AGENT_NAME not set}"

# PRE-FLIGHT, added after a negative control on this script found the gap:
# a NONEXISTENT file ingests as "0 chunks", so it classified as ZERO (exit 2)
# and printed "zero chunks on a file with content" - which is false, and points
# at the wrong remedy. A missing input and a genuine zero-chunk result need
# different actions, so they need different exit codes.
for f in "$@"; do
    [ -f "$f" ] || { echo "🚨 INPUT MISSING: $f does not exist. Nothing was ingested." >&2; exit 3; }
    [ -s "$f" ] || { echo "🚨 INPUT EMPTY: $f exists but has zero bytes." >&2; exit 3; }
done

# ONE FILE PER kb-ingest CALL, ALWAYS. Never `kb-ingest "$@"` with more than one
# path: the CLI runs the Python ingester via spawnSync under a WALL-CLOCK
# TIMEOUT (a work-per-spawn budget, not a token ceiling) and SIGTERMs it -
# the-team-lead measured two files combined (~109,591 embedding tokens) time
# out silently while each file alone (78,507 and 31,084 tokens) succeeded.
WORST=0
for f in "$@"; do
    OUT="$(cortextos bus kb-ingest "$f" --org "$CTX_ORG" --agent "$CTX_AGENT_NAME" --scope private 2>&1)"
    RC=$?
    VERDICT="$(printf '%s' "$OUT" | classify "$RC")"

    case "$VERDICT" in
        OK_*)
            echo "✅ KB ingest VERIFIED: $f - ${VERDICT#OK_} chunks"
            query_back "$f"
            ;;
        VERIFIED)
            echo "✅ KB ingest VERIFIED: $f - already current in KB (0 new chunks)"
            query_back "$f"
            ;;
        CHILD_KILL)
            echo "🚨 KB ingest CHILD_KILL on $f - child process was killed before verification completed."
            echo "$OUT" | tail -5
            [ "$WORST" -lt 3 ] && WORST=3
            ;;
        ERROR)
            echo "🚨 KB ingest ERRORED on $f - memory did NOT reach the KB."; echo "$OUT" | tail -5
            [ "$WORST" -lt 3 ] && WORST=3
            ;;
        *)
            echo "🚨 KB ingest output UNRECOGNISED for $f - FAILING CLOSED."
            echo "   Not an error and not a confirmed count. Treat as NOT ingested."
            echo "$OUT" | tail -5
            [ "$WORST" -lt 4 ] && WORST=4
            ;;
    esac
done

exit "$WORST"
