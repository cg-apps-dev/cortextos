#!/usr/bin/env bash
# Test harness for probe_codex_runtime_auth (bus/check-dependency-health.sh).
# Covers the 4 spec cases from SPEC-codex-revoked-token-monitor-2026-07-07.md.
#
# SAFE BY CONSTRUCTION: cases that exercise the full monitor run a COPY of the script
# from a fixture bus/ dir whose send-telegram.sh is a NO-OP STUB (logs to a file), so
# NO real Telegram can fire regardless of which CHAT_ID resolves. All state/logs are
# isolated under a temp dir. No network, no real alerts.
#
# Run:  bash tests/monitors/codex-runtime-auth.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_BUS="$(cd "$SCRIPT_DIR/../../bus" && pwd)"
MON="$REPO_BUS/check-dependency-health.sh"
FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT

pass=0; fail=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }

REVOKED_LOG='2026-07-07T16:42:59Z ERROR 401 Unauthorized
[codex-app-server] error: {"error":{"message":"Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.","codexErrorInfo":"unauthorized"}}'
CLEAN_LOG='2026-07-07T16:42:59Z INFO turn completed ok'
STALE_HB="2026-07-06T00:00:00Z"                                                   # ~1.5d old
FRESH_HB="$(python3 -c 'import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"

# mk_agent <root> <name> <runtime> <logcontent> <heartbeat-iso|"">
mk_agent(){
  local root="$1" name="$2" rt="$3" logc="$4" hb="$5"
  mkdir -p "$root/orgs/testorg/agents/$name" "$root/logs/$name" "$root/state/$name"
  printf '{"runtime":"%s"}\n' "$rt" > "$root/orgs/testorg/agents/$name/config.json"
  printf '%s\n' "$logc" > "$root/logs/$name/stdout.log"
  [[ -n "$hb" ]] && printf '{"last_heartbeat":"%s"}\n' "$hb" > "$root/state/$name/heartbeat.json"
  return 0
}

# --- probe-direct runner (cases 1,2): source fns, call probe with fixture overrides ---
run_probe(){
  local root="$1"
  ( set +e
    # Minimal CTX env so the script's env-setup (mkdir/ctx_source_env) does not abort
    # under `set -u`; the probe reads only the CODEX_AUTH_* fixture overrides below.
    export CTX_ROOT="$root" CTX_LOG_DIR="$root/logs/_probe" CTX_ORG="nosecrets" \
           CTX_FRAMEWORK_ROOT="$root" CTX_AGENT_DIR="$root/noagent"
    set --   # clear positional args: the sourced script's arg-parser would exit 1 on "$root" ($1)
    source "$MON" >/dev/null 2>&1
    CODEX_AUTH_ORGS_ROOT="$root/orgs" CODEX_AUTH_LOGS_BASE="$root/logs" \
      CODEX_AUTH_STATE_BASE="$root/state" probe_codex_runtime_auth )
}

# --- sandboxed full-monitor runner (cases 3,4): stub telegram, isolated state ---
setup_sandbox(){
  local sb="$1"
  mkdir -p "$sb/bus"
  cp "$MON" "$sb/bus/check-dependency-health.sh"
  cp "$REPO_BUS/_ctx-env.sh" "$sb/bus/_ctx-env.sh" 2>/dev/null || true
  cat > "$sb/bus/send-telegram.sh" <<'STUB'
#!/usr/bin/env bash
echo "TELEGRAM|$2" >> "${STUB_TG_LOG:?}"
STUB
  chmod +x "$sb/bus/send-telegram.sh"
}
run_monitor(){                       # $1=sandbox root  $2=fixture root (agents/logs/state)
  local sb="$1" root="$2"
  STUB_TG_LOG="$sb/tg.log" \
  CTX_ROOT="$root" CTX_LOG_DIR="$root/logs/_mon" CTX_ORG="nosecrets" \
  CTX_FRAMEWORK_ROOT="$sb" CTX_TELEGRAM_CHAT_ID="TESTCHAT" CTX_AGENT_DIR="$sb/noagent" \
  CODEX_AUTH_ORGS_ROOT="$root/orgs" CODEX_AUTH_LOGS_BASE="$root/logs" CODEX_AUTH_STATE_BASE="$root/state" \
    bash "$sb/bus/check-dependency-health.sh" --quiet --cooldown 43200 >/dev/null 2>&1 || true
}

echo "== probe_codex_runtime_auth :: 4 spec cases =="

# ── Case 1: signature + stale heartbeat -> FAIL / CODE RED ──────────────────
R1="$FIX/c1"; mk_agent "$R1" codex-x codex-app-server "$REVOKED_LOG" "$STALE_HB"
out1="$(run_probe "$R1")"
[[ "$out1" == FAIL* && "$out1" == *"CODE RED"* ]] && ok "case1 signature+stale => FAIL/CODE RED" || no "case1 got: $out1"

# ── Case 2: signature + FRESH heartbeat -> OK (transient, pairing gate holds) ─
R2="$FIX/c2"; mk_agent "$R2" codex-x codex-app-server "$REVOKED_LOG" "$FRESH_HB"
out2="$(run_probe "$R2")"
[[ "$out2" == OK* && "$out2" == *transient* ]] && ok "case2 signature+fresh => OK/no-fire (pairing gate)" || no "case2 got: $out2"

# ── Case 3: still auth-dead across runs -> alert ONCE, then cooldown (no spam) ─
SB3="$FIX/sb3"; R3="$FIX/c3"; setup_sandbox "$SB3"
mk_agent "$R3" codex-x codex-app-server "$REVOKED_LOG" "$STALE_HB"
run_monitor "$SB3" "$R3"; run_monitor "$SB3" "$R3"        # two runs within cooldown
n_codered=$(grep -c 'CODE RED' "$SB3/tg.log" 2>/dev/null || echo 0)
[[ "$n_codered" -eq 1 ]] && ok "case3 dedup: exactly 1 CODE RED across 2 runs (no spam)" || no "case3 expected 1 CODE RED, got $n_codered"

# ── Case 4: signature clears + fresh heartbeat -> RECOVERED, state reset ─────
# continue from case-3 state (FAIL recorded); now make the agent healthy
printf '%s\n' "$CLEAN_LOG" > "$R3/logs/codex-x/stdout.log"
printf '{"last_heartbeat":"%s"}\n' "$FRESH_HB" > "$R3/state/codex-x/heartbeat.json"
run_monitor "$SB3" "$R3"
n_recovered=$(grep -c 'RECOVERED' "$SB3/tg.log" 2>/dev/null || echo 0)
final_status=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('codex_runtime_auth',{}).get('status','?'))" "$R3/state/dependency-health/alert-state.json" 2>/dev/null || echo '?')
[[ "$n_recovered" -ge 1 && "$final_status" == "OK" ]] && ok "case4 recovery: RECOVERED alert + state reset to OK" || no "case4 recovered=$n_recovered status=$final_status"

echo "== $pass passed, $fail failed =="
[[ "$fail" -eq 0 ]] || exit 1
