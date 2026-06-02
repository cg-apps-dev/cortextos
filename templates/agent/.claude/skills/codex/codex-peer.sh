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

EVENTS="$(mktemp -t codex-events.XXXXXX)"
LAST="$(mktemp -t codex-last.XXXXXX)"
FAST_CWD=""
cleanup() { rm -f "$EVENTS" "$LAST"; [[ -n "$FAST_CWD" ]] && rm -rf "$FAST_CWD"; }
trap cleanup EXIT

# --json emits JSONL events (incl. token usage); --output-last-message captures
# the final answer cleanly. Read-only sandbox = advisory, never writes files.
case "$MODE" in
  --deep)
    # Repo-aware: let Codex read the codebase (slower).
    codex exec --json --skip-git-repo-check -s read-only -C "$REPO" \
      --output-last-message "$LAST" "$PROMPT" > "$EVENTS" 2>/dev/null || true
    ;;
  --review)
    # Review MY working changes (staged/unstaged/untracked) with custom instructions.
    codex exec review --uncommitted --json --skip-git-repo-check -C "$REPO" \
      --output-last-message "$LAST" "$PROMPT" > "$EVENTS" 2>/dev/null || true
    ;;
  *)
    # FAST default: empty scratch cwd so there is no repo to scan. The prompt
    # carries the context (paste code/errors). Seconds, not minutes.
    FAST_CWD="$(mktemp -d -t codex-cwd.XXXXXX)"
    codex exec --json --skip-git-repo-check -s read-only -C "$FAST_CWD" \
      --output-last-message "$LAST" "$PROMPT" > "$EVENTS" 2>/dev/null || true
    ;;
esac

# Print Codex's answer (the whole point of the call).
if [[ -s "$LAST" ]]; then
  cat "$LAST"
else
  echo "(codex returned no final message — check 'codex doctor' / login)" >&2
fi

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
