#!/usr/bin/env bash
# codex-peer.sh — invoke Codex (gpt-5-codex) as a peer coding/debugging tool.
#
# Runs `codex exec` non-interactively (read-only sandbox: Codex advises, it does
# NOT modify the working tree), prints Codex's answer, and logs token usage to
# <CTX_ROOT>/logs/<agent>/codex-tokens.jsonl in the SAME schema the
# codex-app-server runtime uses — so dashboard per-agent cost tracking
# (scanCodexLogsCosts -> cost_entries -> Per-Agent Token Usage card) picks it up.
#
# Modes (frictionless by default — fast peer-choice, not a heavyweight fallback):
#   codex-peer.sh "<prompt>"           FAST (default): no repo scan, answers from
#                                      your prompt. Paste the relevant code/error.
#                                      Seconds, not minutes.
#   codex-peer.sh "<prompt>" --deep    Repo-aware: Codex can read the codebase
#                                      (slower — only when the prompt needs it).
#   codex-peer.sh "<prompt>" --review  `codex review` of the current repo.
#
# Auth: ChatGPT login stored in ~/.codex (run `codex login` once).
set -euo pipefail

PROMPT="${1:-}"
MODE="${2:-}"
if [[ -z "$PROMPT" ]]; then
  echo "usage: codex-peer.sh \"<prompt>\" [--deep|--review]" >&2
  exit 2
fi

REPO="${CTX_FRAMEWORK_ROOT:-$(pwd)}"
CTX_ROOT="${CTX_ROOT:?CTX_ROOT not set}"
AGENT="${CTX_AGENT_NAME:?CTX_AGENT_NAME not set}"

# Hard fail-fast timeout (seconds). codex occasionally stalls (network/auth/login)
# and would otherwise hang the caller — and a stalled background call holds a slot
# indefinitely. Override with CODEX_TIMEOUT=<secs>; --deep gets a longer ceiling
# (CODEX_DEEP_TIMEOUT) since repo scans legitimately take longer.
CODEX_TIMEOUT="${CODEX_TIMEOUT:-90}"
CODEX_DEEP_TIMEOUT="${CODEX_DEEP_TIMEOUT:-240}"

EVENTS="$(mktemp -t codex-events.XXXXXX)"
LAST="$(mktemp -t codex-last.XXXXXX)"
FAST_CWD=""
TO_FLAG=""   # watchdog timeout-marker temp (set in run_with_timeout); trapped as a backstop
cleanup() { rm -f "$EVENTS" "$LAST" ${TO_FLAG:+"$TO_FLAG"}; [[ -n "$FAST_CWD" ]] && rm -rf "$FAST_CWD"; }
trap cleanup EXIT

# Run a command with a hard timeout. macOS ships no `timeout`/`gtimeout`, so this
# is a bash-native watchdog: run the command in the background and, if it overruns,
# kill it (TERM, then KILL after a 2s grace). Returns 124 on timeout, else the
# command's own exit code. The command's stdout/stderr are inherited from the
# caller (so the usual `> "$EVENTS"` redirect on the call still works).
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
# the final answer cleanly. Read-only sandbox = advisory, never writes files.
# Build the argv + per-mode timeout, then run under the watchdog so a stall can't
# hang the caller.
case "$MODE" in
  --deep)
    # Repo-aware: let Codex read the codebase (slower → longer ceiling).
    TIMEOUT_SECS="$CODEX_DEEP_TIMEOUT"
    CODEX_ARGV=(exec --json --skip-git-repo-check -s read-only -C "$REPO" \
      --output-last-message "$LAST" "$PROMPT")
    ;;
  --review)
    # Review MY working changes (staged/unstaged/untracked) with custom instructions.
    TIMEOUT_SECS="$CODEX_TIMEOUT"
    CODEX_ARGV=(exec review --uncommitted --json --skip-git-repo-check -C "$REPO" \
      --output-last-message "$LAST" "$PROMPT")
    ;;
  *)
    # FAST default: empty scratch cwd so there is no repo to scan. The prompt
    # carries the context (paste code/errors). Seconds, not minutes.
    TIMEOUT_SECS="$CODEX_TIMEOUT"
    FAST_CWD="$(mktemp -d -t codex-cwd.XXXXXX)"
    CODEX_ARGV=(exec --json --skip-git-repo-check -s read-only -C "$FAST_CWD" \
      --output-last-message "$LAST" "$PROMPT")
    ;;
esac

CODEX_RC=0
run_with_timeout "$TIMEOUT_SECS" codex "${CODEX_ARGV[@]}" > "$EVENTS" 2>/dev/null || CODEX_RC=$?

# Print Codex's answer (the whole point of the call).
if [[ "$CODEX_RC" == "124" ]]; then
  echo "(codex timed out after ${TIMEOUT_SECS}s and was terminated — a stall no longer hangs the caller. Retry, or reserve --deep for when a repo scan is genuinely needed. Raise CODEX_TIMEOUT/CODEX_DEEP_TIMEOUT if your call legitimately needs longer.)" >&2
fi
if [[ -s "$LAST" ]]; then
  cat "$LAST"
elif [[ "$CODEX_RC" != "124" ]]; then
  echo "(codex returned no final message — check 'codex doctor' / login)" >&2
fi

# Token usage is logged below REGARDLESS of timeout — if the call produced any
# usage events before being killed, they're still captured (usage isn't lost).

# Log token usage to codex-tokens.jsonl (exact codex-app-server schema).
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
        "session_id": session_id or "codex-peer",
        "turn_id": datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S"),
    }
    with open(out_path, "a") as f:
        f.write(json.dumps(rec) + "\n")
PY
