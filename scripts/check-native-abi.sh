#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/check-native-abi.sh [--fix]" >&2
}

die_internal() {
  echo "ERROR: $*" >&2
  exit 2
}

fix=0
case "${1:-}" in
  "")
    ;;
  --fix)
    fix=1
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 2
    ;;
esac

if [ "$#" -gt 1 ]; then
  usage
  exit 2
fi

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
dashboard_dir="$repo_root/dashboard"
module_dir="$dashboard_dir/node_modules/better-sqlite3"

command -v node >/dev/null 2>&1 || die_internal "node is not on PATH"
command -v npm >/dev/null 2>&1 || die_internal "npm is not on PATH"

current_abi="$(node -p 'process.versions.modules' 2>/dev/null)" || die_internal "failed to read current Node ABI"
node_version="$(node -p 'process.version' 2>/dev/null)" || die_internal "failed to read current Node version"
node_path="$(command -v node)"

find_artifacts() {
  if [ ! -d "$module_dir" ]; then
    return 0
  fi
  find "$module_dir" -path '*/build/Release/*.node' -type f -print 2>/dev/null | sort
}

read_artifact_abi() {
  artifact="$1"
  output="$(
    ARTIFACT="$artifact" node --no-warnings -e '
      const artifact = process.env.ARTIFACT;
      try {
        require(artifact);
        console.log("MATCH:" + process.versions.modules);
      } catch (error) {
        const text = String((error && error.stack) || error);
        const match = text.match(/NODE_MODULE_VERSION\s+([0-9]+)/);
        if (match) {
          console.log("MISMATCH:" + match[1]);
        } else {
          console.log("UNKNOWN:" + text.split(/\n/)[0]);
        }
      }
    ' 2>&1
  )" || return 1
  printf '%s\n' "$output"
}

check_once() {
  artifacts="$(find_artifacts)"
  if [ -z "$artifacts" ]; then
    echo "ERROR: no better-sqlite3 native artifacts found under $module_dir" >&2
    return 2
  fi

  mismatch=0
  unknown=0
  matched=0
  report=""

  while IFS= read -r artifact; do
    [ -n "$artifact" ] || continue
    result="$(read_artifact_abi "$artifact")" || {
      echo "ERROR: failed to inspect $artifact" >&2
      return 2
    }

    case "$result" in
      MATCH:*)
        artifact_abi="${result#MATCH:}"
        matched=1
        ;;
      MISMATCH:*)
        artifact_abi="${result#MISMATCH:}"
        mismatch=1
        ;;
      UNKNOWN:*)
        artifact_abi="unknown"
        unknown=1
        ;;
      *)
        artifact_abi="unknown"
        unknown=1
        ;;
    esac

    rel_artifact="${artifact#"$repo_root"/}"
    report="${report}${rel_artifact}: compiled ABI ${artifact_abi}, current ABI ${current_abi}"'
'
  done <<EOF
$artifacts
EOF

  # Priority: a definitive MISMATCH on any artifact wins (the loadable addon
  # is what crashes at runtime); UNKNOWN is only fatal when NO artifact gave
  # a definitive answer (secondary artifacts like test_extension.node fail
  # the require-probe with non-ABI errors even when the main addon is fine).
  if [ "$mismatch" -ne 0 ]; then
    echo "MISMATCH: better-sqlite3 native ABI does not match current Node"
    printf '%s' "$report"
    echo "Node: $node_version ABI $current_abi at $node_path"
    return 1
  fi

  if [ "$unknown" -ne 0 ] && [ "$matched" -eq 0 ]; then
    echo "ERROR: could not determine better-sqlite3 native artifact ABI"
    printf '%s' "$report"
    echo "Node: $node_version ABI $current_abi at $node_path"
    return 2
  fi

  echo "PASS: better-sqlite3 native ABI matches current Node ABI $current_abi"
  printf '%s' "$report"
  echo "Node: $node_version ABI $current_abi at $node_path"
  return 0
}

set +e
check_once
status="$?"
set -e

if [ "$status" -eq 0 ]; then
  exit 0
fi

if [ "$fix" -eq 0 ]; then
  exit "$status"
fi

echo "Rebuilding better-sqlite3 in dashboard with current Node: $node_version ABI $current_abi at $node_path"
(cd "$dashboard_dir" && npm rebuild better-sqlite3)

set +e
check_once
status="$?"
set -e
exit "$status"
