#!/usr/bin/env bash
# codex-write.sh — invoke Codex (gpt-5-codex) as WRITE-MODE code hands.
#
# Unlike codex-peer.sh (read-only advisor), this runs `codex exec` in a
# workspace-write sandbox so Codex EDITS files directly inside a feature-branch
# worktree. Claude stays the driver/reviewer/validator/committer; Codex is the
# hands. The wrapper deliberately does the minimum and hard-enforces safety:
#
#   - WORKTREE is a REQUIRED arg and is the writable working root (-C). Codex can
#     only write inside it (workspace-write sandbox).
#   - BRANCH GUARD: refuses to run if the worktree's checked-out branch is
#     main/master (writes must land on a feature branch).
#   - NEVER git-commits / git-adds. Claude owns the commit after reviewing the
#     diff and validating (build/tsc/test). The wrapper only lets Codex mutate
#     the working tree.
#   - approval_policy=never: exec mode can't answer interactive prompts, so any
#     action needing escalation is denied (not hung) rather than blocking.
#   - Bash-native watchdog + token-log are REUSED VERBATIM from codex-peer.sh so
#     a stall can't hang the caller and dashboard cost tracking still works.
#
# Usage:
#   codex-write.sh "<prompt>" <worktree-dir>
#
# Auth: ChatGPT login stored in ~/.codex (run `codex login` once).
set -euo pipefail

PROMPT="${1:-}"
WORKTREE="${2:-}"
if [[ -z "$PROMPT" || -z "$WORKTREE" ]]; then
  echo "usage: codex-write.sh \"<prompt>\" <worktree-dir>" >&2
  exit 2
fi

CTX_ROOT="${CTX_ROOT:?CTX_ROOT not set}"
AGENT="${CTX_AGENT_NAME:?CTX_AGENT_NAME not set}"

# --- Safety: worktree must exist, be a git repo, and NOT be on main/master ----
if [[ ! -d "$WORKTREE" ]]; then
  echo "codex-write: worktree '$WORKTREE' is not a directory" >&2
  exit 2
fi
if ! git -C "$WORKTREE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "codex-write: '$WORKTREE' is not inside a git work tree (write mode needs a branch to confine changes to)" >&2
  exit 2
fi
BRANCH="$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]]; then
  echo "codex-write: refusing to run in detached HEAD — check out a feature branch first" >&2
  exit 3
fi
case "$BRANCH" in
  main|master)
    echo "codex-write: REFUSING to write on protected branch '$BRANCH'. Check out a feature branch in '$WORKTREE' first." >&2
    exit 3
    ;;
esac

# Hard fail-fast timeout (seconds). Write tasks legitimately take longer than the
# read-only peer calls, so the default ceiling is higher. Override CODEX_WRITE_TIMEOUT.
CODEX_WRITE_TIMEOUT="${CODEX_WRITE_TIMEOUT:-600}"

EVENTS="$(mktemp -t codex-events.XXXXXX)"
LAST="$(mktemp -t codex-last.XXXXXX)"
TO_FLAG=""   # watchdog timeout-marker temp (set in run_with_timeout); trapped as a backstop
cleanup() { rm -f "$EVENTS" "$LAST" ${TO_FLAG:+"$TO_FLAG"}; }
trap cleanup EXIT

# Run a command with a hard timeout. macOS ships no `timeout`/`gtimeout`, so this
# is a bash-native watchdog: run the command in the background and, if it overruns,
# kill it (TERM, then KILL after a 2s grace). Returns 124 on timeout, else the
# command's own exit code. The command's stdout/stderr are inherited from the
# caller (so the usual `> "$EVENTS"` redirect on the call still works).
# [REUSED VERBATIM from codex-peer.sh]
run_with_timeout() {
  local secs="$1"; shift
  TO_FLAG="$(mktemp -t codex-timeout.XXXXXX)"   # trapped in cleanup() as a backstop
  local flag="$TO_FLAG"
  "$@" &
  local cmd_pid=$!
  (
    sleep "$secs"
    if kill -0 "$cmd_pid" 2>/dev/null; then
      printf timed_out > "$flag"
      kill -TERM "$cmd_pid" 2>/dev/null
      sleep 2
      kill -KILL "$cmd_pid" 2>/dev/null
    fi
  ) &
  local watch_pid=$!
  local rc=0
  wait "$cmd_pid" 2>/dev/null || rc=$?
  kill "$watch_pid" 2>/dev/null || true
  wait "$watch_pid" 2>/dev/null || true
  [[ -s "$flag" ]] && rc=124
  rm -f "$flag"; TO_FLAG=""
  return "$rc"
}

# --json emits JSONL events (incl. token usage); --output-last-message captures
# the final answer cleanly. workspace-write sandbox = Codex edits files inside
# the worktree; approval_policy=never so a non-interactive run can't hang on a
# prompt. stdin from /dev/null so codex doesn't wait on additional input. The
# prompt carries the task; -C confines the working root to the feature-branch
# worktree.
CODEX_ARGV=(exec --json -s workspace-write -c approval_policy=never \
  -C "$WORKTREE" --output-last-message "$LAST" "$PROMPT")

CODEX_RC=0
run_with_timeout "$CODEX_WRITE_TIMEOUT" codex "${CODEX_ARGV[@]}" > "$EVENTS" 2>/dev/null </dev/null || CODEX_RC=$?

# Print Codex's answer (what it changed).
if [[ "$CODEX_RC" == "124" ]]; then
  echo "(codex-write timed out after ${CODEX_WRITE_TIMEOUT}s and was terminated. Partial edits may exist in the worktree — review the diff. Raise CODEX_WRITE_TIMEOUT if the task legitimately needs longer.)" >&2
fi
if [[ -s "$LAST" ]]; then
  cat "$LAST"
elif [[ "$CODEX_RC" != "124" ]]; then
  echo "(codex returned no final message — check 'codex doctor' / login)" >&2
fi

# Token usage is logged below REGARDLESS of timeout — if the call produced any
# usage events before being killed, they're still captured (usage isn't lost).
# [REUSED VERBATIM from codex-peer.sh]
LOG_DIR="$CTX_ROOT/logs/$AGENT"
mkdir -p "$LOG_DIR"
python3 - "$EVENTS" "$LOG_DIR/codex-tokens.jsonl" <<'PY' || true
import sys, json, datetime
events_path, out_path = sys.argv[1], sys.argv[2]

# Confirmed `codex exec --json` event schema (codex-cli 0.136):
#   {"type":"thread.started","thread_id":"..."}
#   {"type":"turn.completed","usage":{"input_tokens","cached_input_tokens",
#                                     "output_tokens","reasoning_output_tokens"}}
inp = out = cache = 0
model = "gpt-5-codex"
session_id = ""
saw_usage = False
try:
    for line in open(events_path):
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if not isinstance(e, dict):
            continue
        if e.get("type") == "thread.started" and isinstance(e.get("thread_id"), str):
            session_id = e["thread_id"]
        if isinstance(e.get("model"), str):
            model = e["model"]
        u = e.get("usage")
        if isinstance(u, dict) and ("input_tokens" in u or "output_tokens" in u):
            inp = int(u.get("input_tokens", inp) or 0)
            out = int(u.get("output_tokens", out) or 0)
            cache = int(u.get("cached_input_tokens", cache) or 0)
            saw_usage = True
except Exception:
    saw_usage = False

if saw_usage and (inp or out):
    rec = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "model": model,
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_tokens": cache,
        "cache_write_tokens": 0,
        "session_id": session_id or "codex-write",
        "turn_id": datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S"),
    }
    with open(out_path, "a") as f:
        f.write(json.dumps(rec) + "\n")
PY

exit "$CODEX_RC"
