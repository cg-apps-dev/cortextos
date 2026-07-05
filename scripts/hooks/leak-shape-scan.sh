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
    *.json|*.ts|*.sh|*.yml|*.yaml|*.toml) return 0 ;;
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

if [ "${1:-}" = "--tree" ]; then
  ref="${2:-HEAD}"
  SHAPE_GUARD_TREE_REF="$ref"
  while IFS= read -r file; do
    scan_file "$file"
  done < <(git ls-tree -r --name-only "$ref")
else
  for file in "$@"; do
    scan_file "$file"
  done
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "shape-guard FAILED: operational leak shape(s) detected above." >&2
  exit 1
fi

echo "shape-guard: clean"
exit 0
