#!/usr/bin/env bash
# Zero-model launchd wrapper for multi-account usage monitoring.
#
# Runs `cortextos bus check-all-usage --alerts-only` and SELF-ALERTS on ANY
# nonzero outcome - threshold alerts AND token/credential errors alike. Built
# because threshold-only alerting has no agent to catch token errors: a cred
# failure stayed silent for 4h on 2026-06-11. With this wrapper, exit-1 from
# alerts, exit-1 from a dead credential, and a crashed CLI all produce the
# same Telegram + bus-event signal.
#
# launchd usage (zero model wakes):
#   ProgramArguments: ["/bin/bash", "<repo>/bus/check-all-usage-job.sh"]
#   EnvironmentVariables: CHAT_ID=<telegram chat id>
# Exit codes: 0 = all accounts healthy, 1 = alerts/errors (already reported).
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
CHAT_ID="${CHAT_ID:-${CTX_TELEGRAM_CHAT_ID:-}}"

notify() {
  msg="$1"
  if [[ -n "$CHAT_ID" && -f "$SCRIPT_DIR/send-telegram.sh" ]]; then
    bash "$SCRIPT_DIR/send-telegram.sh" "$CHAT_ID" "$msg" >/dev/null 2>&1 || true
  fi
  cortextos bus log-event error usage_monitor_alert error \
    --meta "{\"source\":\"check-all-usage-job\",\"detail\":$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()[:500]))')}" \
    >/dev/null 2>&1 || true
}

# Capture BOTH stdout (alert lines) and stderr (credential/CLI errors).
output="$(cortextos bus check-all-usage --alerts-only 2>&1)"
status=$?

if [[ "$status" -eq 0 ]]; then
  exit 0
fi

if [[ -z "$output" ]]; then
  output="check-all-usage exited $status with no output (CLI or credential failure)"
fi

notify "Usage monitor: $output"
exit 1
