#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! GUARD_OUTPUT="$(node "$SCRIPT_DIR/bounce-guard.mjs")"; then
  printf '%s\n' "$GUARD_OUTPUT"
  exit 1
fi

printf '%s\n' "$GUARD_OUTPUT"
if ! printf '%s\n' "$GUARD_OUTPUT" | grep -qx 'BOUNCE-GUARD-VERDICT: PASS'; then
  printf '%s\n' 'REFUSED: bounce guard did not emit a positive PASS token.'
  exit 1
fi

pm2 restart cortextos-daemon
