#!/usr/bin/env bash
# Fixture test for the 2026-10-24 process-liveness-keyed frozen-log gate in
# bus/check-dependency-health.sh probe_codex_runtime_auth. Exercises the 4 states.
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/bus/check-dependency-health.sh"
ROOT="$(mktemp -d)"
THRESH=5400
now=$(date -u +%s)
iso() { python3 -c "import datetime,sys;print(datetime.datetime.utcfromtimestamp(int(sys.argv[1])).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1"; }

mk() { # name  log_age_s  beat_age_s(-1=unreadable)  with_sig(1/0)
  local name="$1" lage="$2" bage="$3" sig="$4"
  mkdir -p "$ROOT/orgs/testorg/agents/$name" "$ROOT/logs/$name" "$ROOT/state/$name"
  printf '{"runtime":"codex-app-server"}\n' > "$ROOT/orgs/testorg/agents/$name/config.json"
  if [[ "$sig" == 1 ]]; then printf 'some line\nrefresh token was revoked\nmore\n' > "$ROOT/logs/$name/stdout.log"
  else printf 'all fine\nnormal line\n' > "$ROOT/logs/$name/stdout.log"; fi
  # NB: touch -t reads LOCAL time; generate the stamp in local time (no -u) or the mtime lands in the future.
  touch -t "$(date -r $((now-lage)) +%Y%m%d%H%M.%S)" "$ROOT/logs/$name/stdout.log"
  if [[ "$bage" == "-1" ]]; then printf 'not json\n' > "$ROOT/state/$name/heartbeat.json"
  else printf '{"last_heartbeat":"%s"}\n' "$(iso $((now-bage)))" > "$ROOT/state/$name/heartbeat.json"; fi
}

# Source the script to get probe fn (returns before the run body).
set +e
source "$SCRIPT" >/dev/null 2>&1
set -e 2>/dev/null || true

run_one() { # label  expect_substr
  local out; out="$(probe_codex_runtime_auth 2>/dev/null)"
  local status="${out%%$'\t'*}"; local detail="${out#*$'\t'}"
  if [[ "$detail" == *"$2"* ]]; then echo "PASS [$1] -> $status | ${detail:0:70}"
  else echo "FAIL [$1] -> $status | $detail  (expected substr: $2)"; fi
  rm -rf "$ROOT/orgs" "$ROOT/logs" "$ROOT/state"
}

export CODEX_AUTH_ORGS_ROOT="$ROOT/orgs" CODEX_AUTH_LOGS_BASE="$ROOT/logs" CODEX_AUTH_STATE_BASE="$ROOT/state" CODEX_AUTH_STALE_THRESHOLD=$THRESH

# A) idle-ALIVE: frozen log (2h old) + sig + FRESH beat (60s) -> SILENT -> final OK "no ... revocation"
mk idleAlive 7200 60 1;   run_one "A idle-alive (frozen log, fresh beat)" "no Codex runtime revocation"
# B) not-started: frozen log + sig + STALE beat (2h) -> DEGRADED frozen-log/not-started
mk notStarted 7200 7200 1; run_one "B not-started (frozen log, stale beat)" "FROZEN LOG, STALE SIGNATURE"
# C) CODE RED: FRESH log (0s) + sig + STALE beat (2h) -> FAIL dead
mk revokedRun 0 7200 1;    run_one "C revoked-running (fresh log, stale beat)" "CODE RED"
# D) transient: FRESH log + sig + FRESH beat -> OK transient
mk transient 0 60 1;       run_one "D transient (fresh log, fresh beat)" "transient Codex 401"
# E) frozen log + UNREADABLE beat -> DEGRADED not-started (not silent, not CODE RED)
mk frozUnread 7200 -1 1;   run_one "E frozen log, unreadable beat" "FROZEN LOG, STALE SIGNATURE"
rm -rf "$ROOT"
