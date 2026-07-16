#!/usr/bin/env bash
# Zero-model launchd wrapper for multi-account usage monitoring.
#
# Runs `cortextos bus check-all-usage --alerts-only` and reports on ANY nonzero
# outcome - threshold alerts AND token/credential errors alike. Built because
# threshold-only alerting has no agent to catch token errors: a cred failure
# stayed silent for 4h on 2026-06-11. This wrapper is the AGENT-INDEPENDENT
# safety net - it fires from launchd even when the whole fleet is down.
#
# Alert routing (2026-07-15, standing comms rule - operational noise never
# raw-Telegrams Adam):
#   - ALWAYS log-event (the events feed is the durable record, every run).
#   - All-RECOVERED runs (pure good-news noise) -> log-only, never pushed.
#   - Operational alerts (5h/7d threshold, EXTRA-USAGE, MODEL-LIMIT) -> routed
#     to the ORCHESTRATOR, which curates the actionable ones into Adam's digest.
#   - Monitoring-BLIND signals (USAGE-FETCH-FAIL / a bare CLI-credential crash)
#     ALSO direct-ping the human: that is the exact 2026-06-11 scenario this job
#     exists for, and the orchestrator's inbox is unreadable precisely when the
#     fleet is the thing that has died. Fail-safe default: unknown/blind -> human.
#   - All pushes are DEDUPED on the exact alert string via a state file, cleared
#     on a healthy run, so a persistent condition across the every-few-min
#     sampler pings once per incident, not once per run.
#
# launchd usage (zero model wakes):
#   ProgramArguments: ["/bin/bash", "<repo>/bus/check-all-usage-job.sh"]
#   EnvironmentVariables: CHAT_ID=<telegram chat id>
# Exit codes: 0 = all accounts healthy, 1 = alerts/errors (already reported).
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
CHAT_ID="${CHAT_ID:-${CTX_TELEGRAM_CHAT_ID:-}}"
STATE_FILE="${HOME}/.cortextos/${CTX_INSTANCE_ID:-default}/state/usage-monitor-last-push"

# Durable record - always, every nonzero run. No human ping here (feed only).
log_event() {
  cortextos bus log-event error usage_monitor_alert error \
    --meta "{\"source\":\"check-all-usage-job\",\"detail\":$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()[:500]))')}" \
    >/dev/null 2>&1 || true
}

# Push a curated alert, DEDUPED on the exact string (a persistent condition must
# not churn - the volatile-dedup-key lesson). Operational -> orchestrator only;
# monitoring-blind ($2 == "1") -> orchestrator AND a direct human ping (fail-safe).
push_deduped() {
  msg="$1"; blind="$2"
  last=""
  [[ -f "$STATE_FILE" ]] && last="$(cat "$STATE_FILE" 2>/dev/null)"
  [[ "$msg" == "$last" ]] && return 0
  mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true
  printf '%s' "$msg" > "$STATE_FILE" 2>/dev/null || true
  cortextos bus send-message the-orchestrator normal "$msg" >/dev/null 2>&1 || true
  if [[ "$blind" == "1" && -n "$CHAT_ID" && -f "$SCRIPT_DIR/send-telegram.sh" ]]; then
    bash "$SCRIPT_DIR/send-telegram.sh" "$CHAT_ID" "$msg" >/dev/null 2>&1 || true
  fi
}

# Capture BOTH stdout (alert lines) and stderr (credential/CLI errors).
output="$(cortextos bus check-all-usage --alerts-only 2>&1)"
status=$?

if [[ "$status" -eq 0 ]]; then
  # Healthy: clear the dedup marker so a fresh incident re-pings after recovery.
  rm -f "$STATE_FILE" 2>/dev/null || true
  exit 0
fi

if [[ -z "$output" ]]; then
  output="check-all-usage exited $status with no output (CLI or credential failure)"
fi

msg="Usage monitor: $output"
log_event "$msg"

# Suppress the benign class from the push path: a run whose every alert line is
# RECOVERED is pure good-news noise -> logged above, but never pushed.
non_recovered="$(printf '%s\n' "$output" | grep -v '^RECOVERED ' | grep -v '^[[:space:]]*$' || true)"
if [[ -z "$non_recovered" ]]; then
  exit 1
fi

# Monitoring-blind (fetch-fail / bare CLI-credential crash) keeps the
# agent-independent direct-human ping; everything else is operational -> orch.
if printf '%s' "$non_recovered" | grep -q 'USAGE-FETCH-FAIL\|no output (CLI or credential failure)'; then
  push_deduped "$msg" 1
else
  push_deduped "$msg" 0
fi
exit 1
