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
# grep -c prints "0" AND exits non-zero on no-match; capture cleanly as a single integer.
cnt(){ local n; n="$(grep -cE "$1" "$2" 2>/dev/null)"; echo "${n:-0}"; }

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
run_monitor(){                       # $1=sandbox root  $2=fixture root  $3+=extra args (e.g. --only ...)
  local sb="$1" root="$2"; shift 2
  STUB_TG_LOG="$sb/tg.log" \
  CTX_ROOT="$root" CTX_LOG_DIR="$root/logs/_mon" CTX_ORG="nosecrets" \
  CTX_FRAMEWORK_ROOT="$sb" CTX_TELEGRAM_CHAT_ID="TESTCHAT" CTX_AGENT_DIR="$sb/noagent" \
  CODEX_AUTH_ORGS_ROOT="$root/orgs" CODEX_AUTH_LOGS_BASE="$root/logs" CODEX_AUTH_STATE_BASE="$root/state" \
    bash "$sb/bus/check-dependency-health.sh" --quiet --cooldown 43200 "$@" >/dev/null 2>&1 || true
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
n_codered=$(cnt 'CODE RED' "$SB3/tg.log")
[[ "$n_codered" -eq 1 ]] && ok "case3 dedup: exactly 1 CODE RED across 2 runs (no spam)" || no "case3 expected 1 CODE RED, got $n_codered"

# ── Case 4: signature clears + fresh heartbeat -> RECOVERED, state reset ─────
# continue from case-3 state (FAIL recorded); now make the agent healthy
printf '%s\n' "$CLEAN_LOG" > "$R3/logs/codex-x/stdout.log"
printf '{"last_heartbeat":"%s"}\n' "$FRESH_HB" > "$R3/state/codex-x/heartbeat.json"
run_monitor "$SB3" "$R3"
n_recovered=$(cnt 'RECOVERED' "$SB3/tg.log")
final_status=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('codex_runtime_auth',{}).get('status','?'))" "$R3/state/dependency-health/alert-state.json" 2>/dev/null || echo '?')
[[ "$n_recovered" -ge 1 && "$final_status" == "OK" ]] && ok "case4 recovery: RECOVERED alert + state reset to OK" || no "case4 recovered=$n_recovered status=$final_status"

# ── Case 5: --only codex_runtime_auth runs ONLY that probe (no gemini/clickup => zero spend) ─
# The monitor logs "[TS] <name>: ..." per probe RUN. If only codex_runtime_auth is logged and
# gemini/clickup/etc are ABSENT, their functions were never invoked => no API/embed spend.
SB5="$FIX/sb5"; R5="$FIX/c5"; setup_sandbox "$SB5"
mk_agent "$R5" codex-x codex-app-server "$REVOKED_LOG" "$STALE_HB"
run_monitor "$SB5" "$R5" --only codex_runtime_auth
# _ctx-env.sh recomputes CTX_LOG_DIR to CTX_ROOT/logs/<agent>, so locate the log dynamically.
MONLOG="$(find "$R5/logs" -name dependency-health.log 2>/dev/null | head -1)"
has_codex=$(cnt 'codex_runtime_auth:' "$MONLOG")
n_others=$(cnt ' (gemini|clickup|triplewhale|admanage|composio):' "$MONLOG")
[[ "$has_codex" -ge 1 && "$n_others" -eq 0 ]] && ok "case5 --only: ran codex_runtime_auth ONLY (0 other probes => zero embed/API spend)" || no "case5 codex=$has_codex others=$n_others (expected >=1 / 0)"

# ── Case 6: --only with an unknown probe name exits 1 (fail loud, no silent no-op) ──
setup_sandbox "$FIX/sb6"; mk_agent "$FIX/c6" codex-x codex-app-server "$CLEAN_LOG" "$FRESH_HB"
STUB_TG_LOG="$FIX/sb6/tg.log" CTX_ROOT="$FIX/c6" CTX_LOG_DIR="$FIX/c6/logs/_mon" CTX_ORG=nosecrets \
  CTX_FRAMEWORK_ROOT="$FIX/sb6" CTX_AGENT_DIR="$FIX/sb6/noagent" \
  bash "$FIX/sb6/bus/check-dependency-health.sh" --quiet --only bogus_probe >/dev/null 2>&1
[[ "$?" -ne 0 ]] && ok "case6 --only unknown name => exit 1 (fail loud)" || no "case6 unknown --only did not exit non-zero"

echo "== $pass passed, $fail failed =="
[[ "$fail" -eq 0 ]] || exit 1
