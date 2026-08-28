#!/usr/bin/env bash
#
# Complementary operational-shape scanner for the code backup push guard.
# Gitleaks owns secret-shaped data. This script catches non-secret operational
# leak shapes that gitleaks cannot model without false-blocking agent-state.

set -uo pipefail

fail=0

report() {
  printf '::error file=%s::SHAPE-GUARD: %s\n' "$1" "$2" >&2
  printf '  %s: %s\n' "$1" "$2" >&2
  fail=1
}

is_code_config_path() {
  case "$1" in
    src/*|dashboard/*|templates/*|scripts/*) return 0 ;;
    # .js/.cjs/.mjs added 2026-07-27. A root-level ecosystem.config.js matched no
    # directory prefix here, and .js was absent from this list, so a file carrying 13
    # committed operator home-path lines was invisible to scan_operator_paths while
    # this scan reported "clean". Verified: identical content at probe.json and
    # src/probe.ts was reported, at ecosystem.config.js was not.
    # NOTE: do not write a literal operator path in this comment. The first version of
    # this note did, and the scanner correctly flagged its own source file -- a rule
    # whose documentation trips the rule.
    *.json|*.ts|*.js|*.cjs|*.mjs|*.sh|*.yml|*.yaml|*.toml) return 0 ;;
    *) return 1 ;;
  esac
}

is_roster_cron_path() {
  case "$1" in
    community/*|docs/*|tests/*|*.md|*.mdx) return 1 ;;
    *) is_code_config_path "$1" ;;
  esac
}

is_operator_path_allowlisted_line() {
  local file="$1"
  local line="$2"
  if printf '%s' "$line" | grep -qE '/Users/(\.\.\.|foo|example)(/|[^A-Za-z0-9._-]|$)'; then
    return 0
  fi
  case "$file" in
    tests/sprint7-environment.test.ts|tests/unit/cli/send-telegram-normalize.test.ts) return 0 ;;
    src/daemon/agent-process.ts)
      printf '%s' "$line" | grep -q '/Users/foo' && return 0
      return 1 ;;
    *) return 1 ;;
  esac
}

is_artifact_path_allowlisted() {
  case "$1" in
    docs/phase-reports/PHASE5-FAILURE-MODES-REPORT.md) return 0 ;;
    *) return 1 ;;
  esac
}

read_content_to_file() {
  local file="$1"
  local out="$2"
  if [ -n "${SHAPE_GUARD_TREE_REF:-}" ]; then
    git cat-file -e "${SHAPE_GUARD_TREE_REF}:$file" 2>/dev/null || return 1
    git show "${SHAPE_GUARD_TREE_REF}:$file" > "$out" 2>/dev/null || return 1
  else
    [ -f "$file" ] || return 1
    cp "$file" "$out"
  fi
}

scan_operator_paths() {
  local file="$1"
  local content_file="$2"
  is_code_config_path "$file" || return 0

  while IFS= read -r hit; do
    line_no="${hit%%:*}"
    line="${hit#*:}"
    if ! is_operator_path_allowlisted_line "$file" "$line"; then
      report "$file" "operator home path: ${line_no}:$(printf '%s' "$line" | cut -c1-120)"
    fi
  done < <(grep -nE '/Users/[A-Za-z0-9._-]+' "$content_file" 2>/dev/null)
}

# THRESHOLD RATIONALE (security-agent, 2026-08-28; reconciled vs upstream #704).
# This windowed heuristic fires only when >=2 roster agents AND >=2 cron tokens co-occur
# within a 5-line window. Upstream #704's parallel guard is MORE sensitive (window=3, fires
# on a SINGLE agent + SINGLE cron). We deliberately KEEP the >=2+>=2 / window=5 threshold:
#  - WHY (FP-reduction): this scanner runs on EVERY push (CI leak-guard.yml + pre-push hook),
#    so a false-block is an availability hit. A lone agent-name plus a lone cron expression
#    commonly co-occur in ordinary prose/docs and are usually NOT a roster-table leak; the
#    2+2 signal requires an actual TABLE shape (multiple agents each with a schedule).
#  - KNOWN MISS CLASS (accepted): a minimal leak of ONE agent + ONE cron split across adjacent
#    lines evades this (upstream #704 would catch it). Judged acceptable: a single roster row
#    is low-value ops detail vs the false-block cost of the more sensitive setting.
#  - UPGRADE TRIGGER: if a single-agent+single-cron split-line leak is ever observed for real
#    (not hypothetical), revisit - either lower to >=1+>=1 or add a separate LOWER-SEVERITY
#    single-pair advisory tier (advise, do not block) so sensitivity rises without the
#    every-push false-block cost. Until then, 2+2/window=5 stands as a deliberate tradeoff.
scan_roster_cron_table() {
  local file="$1"
  local content_file="$2"
  is_roster_cron_path "$file" || return 0

  awk -v file="$file" -v window=5 '
    function count_keys(arr,   n, key) {
      n = 0
      for (key in arr) n++
      return n
    }
    function trim_token(token) {
      gsub(/^[^a-z0-9]+/, "", token)
      gsub(/[^a-z0-9-]+$/, "", token)
      return token
    }
    {
      lines[NR] = $0

      line = $0
      while (match(line, /(^|[^a-z0-9-])([a-z][a-z0-9-]*-agent|the-[a-z-]+)([^a-z0-9-]|$)/)) {
        token = trim_token(substr(line, RSTART, RLENGTH))
        agents_by_line[NR, token] = 1
        line = substr(line, RSTART + RLENGTH)
      }

      line = $0
      while (match(line, /([0-9*,\/-]+[[:space:]]+){4}[0-9*,\/-]+|(^|[^a-z0-9])[0-9]+[hdwm]([^a-z0-9]|$)|@(daily|hourly|weekly|reboot)/)) {
        token = trim_token(substr(line, RSTART, RLENGTH))
        crons_by_line[NR, token] = 1
        line = substr(line, RSTART + RLENGTH)
      }
    }
    END {
      for (start = 1; start <= NR; start++) {
        delete window_agents
        delete window_crons
        end = start + window - 1
        if (end > NR) end = NR
        for (line_no = start; line_no <= end; line_no++) {
          for (key in agents_by_line) {
            split(key, parts, SUBSEP)
            if (parts[1] == line_no) window_agents[parts[2]] = 1
          }
          for (key in crons_by_line) {
            split(key, parts, SUBSEP)
            if (parts[1] == line_no) window_crons[parts[2]] = 1
          }
        }
        if (count_keys(window_agents) >= 2 && count_keys(window_crons) >= 2) {
          printf "::error file=%s::SHAPE-GUARD: fleet roster + cron table within %d lines\n", file, window > "/dev/stderr"
          printf "  %s: fleet roster + cron table within %d lines near line %d\n", file, window, start > "/dev/stderr"
          exit 42
        }
      }
    }
  ' "$content_file"
  case "$?" in
    0) ;;
    42) fail=1 ;;
    *) return 0 ;;
  esac
}

scan_artifact_path() {
  local file="$1"
  if is_artifact_path_allowlisted "$file"; then
    return 0
  fi
  case "$file" in
    *INSTALL_REPORT.md|*PHASE*-REPORT.md|docs/phase-reports/*)
      report "$file" "dev-report artifact path must not be tracked" ;;
  esac
}

scan_file() {
  local file="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  if ! read_content_to_file "$file" "$tmp_file"; then
    rm -f "$tmp_file"
    return
  fi

  grep -Iq . "$tmp_file" 2>/dev/null || {
    rm -f "$tmp_file"
    scan_artifact_path "$file"
    return
  }

  scan_artifact_path "$file"
  scan_operator_paths "$file" "$tmp_file"
  scan_roster_cron_table "$file" "$tmp_file"
  rm -f "$tmp_file"
}

scanned_count=0

if [ "${1:-}" = "--tree" ]; then
  ref="${2:-HEAD}"
  SHAPE_GUARD_TREE_REF="$ref"
  # ENUMERATION MUST FAIL LOUDLY, added 2026-07-28 (found by claude-dev-agent).
  # This used to be `done < <(git ls-tree ... "$ref")`. When git ls-tree FAILED - cwd
  # outside a repo, or a ref that does not resolve - the process substitution yielded an
  # EMPTY STREAM, the loop body never ran, `fail` stayed 0, and this printed
  # "shape-guard: clean" and exited 0. IT SCANNED ZERO FILES AND REPORTED CLEAN.
  # Reproduced: nonexistent ref -> rc=0 clean; outside a repo -> rc=0 clean; identical to
  # the healthy case by exit code. That is the empty-candidate-set-versus-clean-set defect
  # one level broader than the *.js selection bug: not "this file was not selected" but
  # "NO file was selected". The hook feeds push refs straight to --tree, so an
  # unresolvable ref (shallow clone, object not present locally) scanned nothing and allowed.
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "shape-guard: BLOCKED - not inside a git repository, cannot enumerate a tree." >&2
    exit 1
  fi
  if ! tree_files="$(git ls-tree -r --name-only "$ref" 2>&1)"; then
    echo "shape-guard: BLOCKED - could not enumerate tree for ref '$ref': $tree_files" >&2
    exit 1
  fi
  if [ -z "$tree_files" ]; then
    # An empty tree is legitimately clean AND legitimately unscannable, and the old code
    # could not tell them apart. Decided explicitly: refuse. "I scanned nothing" must never
    # render as "clean".
    echo "shape-guard: BLOCKED - ref '$ref' enumerated ZERO files; refusing to report clean on an empty scan." >&2
    exit 1
  fi
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    scanned_count=$((scanned_count + 1))
    scan_file "$file"
  done <<< "$tree_files"
else
  for file in "$@"; do
    scanned_count=$((scanned_count + 1))
    scan_file "$file"
  done
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "shape-guard FAILED: operational leak shape(s) detected above." >&2
  exit 1
fi

# AFFIRMATIVE TOKEN: printed only after actually enumerating a non-empty set. A consumer
# must require this token rather than infer health from a non-failing exit - "clean" used to
# mean "nothing failed", which is not the same as "I looked".
echo "shape-guard: clean (SHAPE-GUARD-SCANNED-OK files=$scanned_count)"
exit 0
