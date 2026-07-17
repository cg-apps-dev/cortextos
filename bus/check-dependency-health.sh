#!/usr/bin/env bash
# Dependency-health monitor for cortextOS external-service SPOFs.
#
# Class-fix for external-service auth/quota single-points-of-failure. Extends the
# usage-monitor pattern (check-usage-api.sh): one cron, N dependency probes, each a
# cheap liveness check. Alerts PROACTIVELY on failure (before the nightly job that
# depends on it fails), exits QUIET when everything is healthy. Stateful dedup so a
# persistent failure alerts on the transition + a slow re-alert cadence, never spams.
#
# Usage:
#   cortextos bus check-dependency-health [--chat-id ID] [--cooldown SECONDS] [--quiet] [--only P,Q]
#
# Options:
#   --chat-id ID     Telegram chat to alert (defaults to the running agent's CHAT_ID)
#   --cooldown SEC   Re-alert interval while a dep stays broken (default: 21600 = 6h)
#   --quiet          Suppress the stdout JSON summary (still alerts + logs)
#   --only P[,Q]     Run ONLY the named probe(s); all others are skipped entirely (their
#                    functions are never called => no API/embed spend). Lets a cheap probe
#                    run on its own FAST cron decoupled from the full 12h sweep. Unknown
#                    names exit 1. Example fast auth-death poll (~30min, zero-cost):
#                      cortextos bus check-dependency-health --only codex_runtime_auth
#
# Output: JSON summary of every probe to stdout. Exit 0 normally (the script owns its
# own alerting); exits non-zero ONLY on an internal scripting error so the cron can
# escalate. Alert messages are also echoed to stderr and the log.
#
# PROBES
#   gemini    ACTIVE   single 1-token embed via the KB venv (the EXACT prod path) ->
#                      detect 429 RESOURCE_EXHAUSTED. This is the PROVEN fleet-wide SPOF:
#                      a Gemini daily-quota 429 blocks ALL KB ingest (see HEARTBEAT Step 9).
#                      Spends one embed of the 1000/day free quota per run (~12/day) - the
#                      health check itself can't meaningfully contribute to exhaustion.
#   clickup   ACTIVE   GET /api/v2/user with CLICKUP_API_TOKEN -> detect 401 (auth drop).
#                      ClickUp backs the throughput/ads system; a silent token revoke
#                      breaks the daily snapshots.
#   triplewhale  SKIP  Triple Whale "moby" is an MCP natural-language tool, not headlessly
#                      pingable from bash, AND it is NOT a structural SPOF - the prior
#                      "TW-access bottleneck" was a wrong-shopId artifact (authoritative
#                      shopId: trycleangreen.myshopify.com). A liveness ping belongs in a
#                      session-side probe. Env-gate: set TW_HEALTH_URL + TW_API_KEY to arm.
#   admanage     SKIP  list_ad_accounts is MCP-only AND the account-diff signal is
#                      CONFOUNDED: Adam intentionally rotates the 4-connected-account cap,
#                      so an account absent from the list is normal rotation, NOT an
#                      auth-drop. A raw diff-vs-expected probe would false-positive. Drift
#                      detection needs a signal that distinguishes rotation from auth
#                      failure; until then this stays a documented no-op stub.
#   composio     SKIP  Connection health is MCP-only (COMPOSIO_MANAGE_CONNECTIONS); no REST
#                      key in secrets.env. Env-gate: set COMPOSIO_API_KEY to arm the REST
#                      connectedAccounts liveness check.
#   codex_runtime_auth ACTIVE  Detect a Codex RUNTIME token REVOCATION the token-EXPIRY
#                      check cannot see (revocation != expiry; runtime cred != usage-probe
#                      cred). Greps each codex-app-server agent's stdout.log TAIL for the
#                      revocation signature, PAIRED with heartbeat staleness => auth-dead.
#                      CODE RED (needs re-auth), distinct from expiry. Caught by hand on
#                      2026-07-07 after 13h dark; this makes it minutes. Dynamic agent
#                      discovery (SKIP if no codex-runtime agents). Tunables:
#                      CODEX_AUTH_STALE_THRESHOLD (default 5400s), CODEX_AUTH_LOG_TAIL (400).
#
# Adding a dep: write a probe_<name> fn that echoes "<STATUS>\t<detail>" where STATUS is
# one of OK | FAIL | DEGRADED | SKIP, then add "<name>" to the PROBES array. SKIP is silent
# (registered-but-not-armed). FAIL/DEGRADED alert; OK after a prior FAIL sends a recovery.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_ctx-env.sh"

# ── Defaults ────────────────────────────────────────────────────────────────
CHAT_ID="${CTX_TELEGRAM_CHAT_ID:-}"
COOLDOWN=21600   # 6h re-alert cadence while a dep stays broken
QUIET=false
ONLY=""          # --only <probe[,probe]>: run just these probes (comma-sep). Filtered-out
                 # probe FUNCTIONS are never called => no side effects/API/embed spend for them.

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chat-id)  CHAT_ID="$2";  shift 2 ;;
    --only)     ONLY="$2";     shift 2 ;;
    --cooldown) COOLDOWN="$2"; shift 2 ;;
    --quiet)    QUIET=true;    shift   ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Resolve CHAT_ID + org secrets ───────────────────────────────────────────
# Source the agent .env (CHAT_ID/BOT_TOKEN) and the org secrets.env (GEMINI/CLICKUP keys).
# Precedence for the alert chat: explicit --chat-id > CTX_TELEGRAM_CHAT_ID > agent .env CHAT_ID.
# Preserve an explicit --chat-id across the .env source (which would otherwise clobber it).
CHAT_ID_EXPLICIT="$CHAT_ID"
ctx_source_env   # may export CHAT_ID and/or CTX_TELEGRAM_CHAT_ID from the agent .env
if [[ -n "$CHAT_ID_EXPLICIT" ]]; then
  CHAT_ID="$CHAT_ID_EXPLICIT"
else
  CHAT_ID="${CTX_TELEGRAM_CHAT_ID:-${CHAT_ID:-}}"
fi

FRAMEWORK_ROOT="${CTX_FRAMEWORK_ROOT:-${CTX_PROJECT_ROOT:-}}"
if [[ -n "${CTX_ORG}" && -n "${FRAMEWORK_ROOT}" && -f "${FRAMEWORK_ROOT}/orgs/${CTX_ORG}/secrets.env" ]]; then
  set -a; source "${FRAMEWORK_ROOT}/orgs/${CTX_ORG}/secrets.env"; set +a
fi

STATE_DIR="${CTX_ROOT}/state/dependency-health"
STATE_FILE="${STATE_DIR}/alert-state.json"
LOG_FILE="${CTX_LOG_DIR}/dependency-health.log"
mkdir -p "$STATE_DIR" "$CTX_LOG_DIR"
TS="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# ── Probe: gemini (ACTIVE) ───────────────────────────────────────────────────
# Run a single 1-token embed through the EXACT venv + model the KB uses, so the probe
# fails iff prod KB ingest would fail. 429 => daily quota exhausted (fleet-wide SPOF).
probe_gemini() {
  local venv_py="${FRAMEWORK_ROOT}/knowledge-base/venv/bin/python3"
  local kb_config="${CTX_ROOT}/orgs/${CTX_ORG}/knowledge-base/config.json"
  if [[ ! -x "$venv_py" ]]; then echo -e "SKIP\tKB venv python not found ($venv_py)"; return; fi
  if [[ ! -f "$kb_config" ]]; then echo -e "SKIP\tKB config not found ($kb_config)"; return; fi
  KB_CONFIG="$kb_config" "$venv_py" - <<'PY' 2>/dev/null || echo -e "DEGRADED\tprobe process crashed"
import os, sys, json
try:
    cfg = json.load(open(os.environ["KB_CONFIG"]))
except Exception as e:
    print("DEGRADED\tcould not read KB config: %s" % e); sys.exit(0)
key = os.environ.get("GEMINI_API_KEY") or cfg.get("gemini_api_key")
if not key:
    print("DEGRADED\tno GEMINI_API_KEY (secrets.env) - KB embedding would fail"); sys.exit(0)
try:
    from google import genai
    from google.genai import types
    from google.genai import errors as gerr
except Exception as e:
    print("SKIP\tgoogle-genai not importable in venv: %s" % e); sys.exit(0)
try:
    client = genai.Client(api_key=key)
    client.models.embed_content(
        model=cfg.get("embedding_model", "gemini-embedding-2-preview"),
        contents="ping",
        config=types.EmbedContentConfig(
            output_dimensionality=cfg.get("embedding_dimensions", 768),
            task_type="RETRIEVAL_QUERY",
        ),
    )
    print("OK\tembed succeeded (model=%s)" % cfg.get("embedding_model", "gemini-embedding-2-preview"))
except gerr.APIError as e:
    code = getattr(e, "code", None)
    if code == 429:
        print("FAIL\tquota exhausted (429 RESOURCE_EXHAUSTED) - KB ingest BLOCKED fleet-wide until ~midnight Pacific reset")
    elif code in (401, 403):
        print("FAIL\tauth rejected (HTTP %s) - GEMINI_API_KEY bad/expired/revoked" % code)
    else:
        print("DEGRADED\tGemini APIError HTTP %s %s" % (code, getattr(e, "status", "") or ""))
except Exception as e:
    print("DEGRADED\t%s: %s" % (type(e).__name__, str(e)[:140]))
PY
}

# ── Probe: clickup (ACTIVE) ──────────────────────────────────────────────────
# Cheap auth liveness: GET the current user. 401 => token revoked/expired.
probe_clickup() {
  local tok="${CLICKUP_API_TOKEN:-}"
  if [[ -z "$tok" ]]; then echo -e "SKIP\tno CLICKUP_API_TOKEN in secrets.env"; return; fi
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Authorization: $tok" "https://api.clickup.com/api/v2/user" 2>/dev/null || echo "000")
  case "$code" in
    200) echo -e "OK\tauth valid" ;;
    401) echo -e "FAIL\tauth rejected (401) - CLICKUP_API_TOKEN revoked/expired; throughput snapshots will fail" ;;
    000) echo -e "DEGRADED\tno HTTP response (network/timeout) - could not reach api.clickup.com" ;;
    429) echo -e "DEGRADED\trate-limited (429) by ClickUp" ;;
    *)   echo -e "DEGRADED\tunexpected HTTP $code from /api/v2/user" ;;
  esac
}

# ── Probe: triplewhale (SKIP unless TW_HEALTH_URL+TW_API_KEY armed) ──────────
# MCP-only NL tool + NOT a structural SPOF (wrong-shopId artifact). Env-gated stub.
probe_triplewhale() {
  if [[ -z "${TW_HEALTH_URL:-}" || -z "${TW_API_KEY:-}" ]]; then
    echo -e "SKIP\tMCP-only (moby) + not a structural SPOF; arm via TW_HEALTH_URL+TW_API_KEY"
    return
  fi
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Authorization: Bearer $TW_API_KEY" "$TW_HEALTH_URL" 2>/dev/null || echo "000")
  case "$code" in
    200) echo -e "OK\tTW endpoint reachable" ;;
    401|403) echo -e "FAIL\tTW auth rejected (HTTP $code)" ;;
    *)   echo -e "DEGRADED\tTW HTTP $code" ;;
  esac
}

# ── Probe: admanage (SKIP - confounded + MCP-only) ───────────────────────────
# Account-diff is CONFOUNDED by intentional 4-account rotation; cannot distinguish
# rotation from auth-drop headlessly. Documented no-op until a disambiguating signal exists.
probe_admanage() {
  echo -e "SKIP\taccount-diff CONFOUNDED by intentional account rotation + MCP-only; needs session-side probe"
}

# ── Probe: composio (SKIP unless COMPOSIO_API_KEY armed) ─────────────────────
probe_composio() {
  if [[ -z "${COMPOSIO_API_KEY:-}" ]]; then
    echo -e "SKIP\tconnection health is MCP-only; arm REST check via COMPOSIO_API_KEY"
    return
  fi
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "x-api-key: $COMPOSIO_API_KEY" "https://backend.composio.dev/api/v1/connectedAccounts?pageSize=1" 2>/dev/null || echo "000")
  case "$code" in
    200) echo -e "OK\tComposio API reachable + key valid" ;;
    401|403) echo -e "FAIL\tComposio auth rejected (HTTP $code) - COMPOSIO_API_KEY bad/expired" ;;
    000) echo -e "DEGRADED\tno HTTP response from backend.composio.dev" ;;
    *)   echo -e "DEGRADED\tComposio HTTP $code" ;;
  esac
}

# ── Probe: codex_runtime_auth (ACTIVE) ───────────────────────────────────────
# Detect a Codex RUNTIME token REVOCATION (auth-death) that the token-EXPIRY check
# structurally CANNOT see: a revoked token is invalidated BEFORE expiry (revocation !=
# expiry), and the runtime cred (codex-app-server auth) differs from the usage-probe
# cred, so neither the expiry check nor the usage API 401s. The only visible signal is
# the revocation SIGNATURE in the codex agent's own stdout.log, PAIRED with heartbeat
# staleness (auth-dead => can't process => can't heartbeat). The pairing rules out a
# transient 401. Greps the log TAIL (not log-internal timestamps => immune to per-agent
# log-clock skew) + reads heartbeat.json (daemon clock). Triggered by the 2026-07-07
# codex-dev auth-death that went 13h dark uncaught. Scope: any runtime==codex-app-server
# agent (dynamic discovery), so a new Codex agent is covered with zero config.
CODEX_AUTH_STALE_THRESHOLD="${CODEX_AUTH_STALE_THRESHOLD:-5400}"   # 90m stale => rules out a transient 401
CODEX_AUTH_LOG_TAIL="${CODEX_AUTH_LOG_TAIL:-400}"                  # stdout.log tail lines to scan for the signature
CODEX_AUTH_SIG_RE='refresh token was revoked|access token could not be refreshed|codexErrorInfo"?[: ]+"?unauthorized|token_invalidated|willRetry"?[: ]+"?false'
probe_codex_runtime_auth() {
  # Paths default to the live tree; overridable so tests can point at fixtures.
  local orgs_root="${CODEX_AUTH_ORGS_ROOT:-${FRAMEWORK_ROOT}/orgs}"
  local logs_base="${CODEX_AUTH_LOGS_BASE:-${CTX_ROOT}/logs}"
  local state_base="${CODEX_AUTH_STATE_BASE:-${CTX_ROOT}/state}"
  [[ -d "$orgs_root" ]] || { echo -e "SKIP\tno orgs dir ($orgs_root)"; return; }
  local now cfg agent runtime logf hbf sig age checked=0
  local -a dead=() transient=() unknown=()
  now=$(date -u +%s)
  while IFS= read -r cfg; do
    agent="$(basename "$(dirname "$cfg")")"
    runtime="$(grep -oE '"runtime"[[:space:]]*:[[:space:]]*"[^"]+"' "$cfg" 2>/dev/null | head -1 | grep -oE '"[^"]+"$' | tr -d '"')"
    [[ "$runtime" == "codex-app-server" ]] || continue
    checked=$((checked+1))
    logf="${logs_base}/${agent}/stdout.log"
    hbf="${state_base}/${agent}/heartbeat.json"
    [[ -f "$logf" ]] || continue
    sig="$(tail -n "$CODEX_AUTH_LOG_TAIL" "$logf" 2>/dev/null | grep -aE "$CODEX_AUTH_SIG_RE" | tail -1)"
    [[ -n "$sig" ]] || continue   # no revocation signature => this agent is fine
    # signature present: pair with heartbeat staleness (daemon clock)
    age="$(HBF="$hbf" NOW="$now" python3 - <<'PY' 2>/dev/null || echo -1
import os, json, datetime
try:
    hb = json.load(open(os.environ["HBF"])).get("last_heartbeat", "")
    t = datetime.datetime.fromisoformat(hb.replace("Z", "+00:00"))
    print(int(int(os.environ["NOW"]) - t.timestamp()))
except Exception:
    print(-1)
PY
)"
    if [[ "$age" -lt 0 ]]; then
      unknown+=("$agent")                                  # signature but heartbeat unreadable => uncertain
    elif [[ "$age" -gt "$CODEX_AUTH_STALE_THRESHOLD" ]]; then
      dead+=("${agent} (~$((age/3600))h stale)")            # signature AND stale => auth-dead
    else
      transient+=("$agent")                                # signature but fresh heartbeat => transient 401, not dead
    fi
  done < <(find "$orgs_root" -maxdepth 4 -path '*/agents/*/config.json' 2>/dev/null)

  if [[ "$checked" -eq 0 ]]; then
    echo -e "SKIP\tno codex-app-server runtime agents found (registered, not armed)"
  elif [[ ${#dead[@]} -gt 0 ]]; then
    local names age_h first_age
    names="$(printf '%s, ' "${dead[@]}")"; names="${names%, }"
    # human-readable stale hours from the first dead agent's embedded seconds
    echo -e "FAIL\tCODE RED: Codex RUNTIME token REVOKED/invalidated on ${names} - auth-dead, cannot process any turn (401 every turn, willRetry:false). Needs a Codex RE-AUTH (log out + sign in). NOT a token-expiry - the expiry check cannot catch this. Signature paired with heartbeat staleness (> ${CODEX_AUTH_STALE_THRESHOLD}s)."
  elif [[ ${#unknown[@]} -gt 0 ]]; then
    local names; names="$(printf '%s, ' "${unknown[@]}")"; names="${names%, }"
    echo -e "DEGRADED\tCodex revocation signature seen on ${names} but heartbeat.json unreadable - cannot confirm the staleness pairing; check manually (possible auth-death)."
  elif [[ ${#transient[@]} -gt 0 ]]; then
    local names; names="$(printf '%s, ' "${transient[@]}")"; names="${names%, }"
    echo -e "OK\ttransient Codex 401 seen on ${names} but heartbeat FRESH - not auth-dead (pairing gate held; no alert)."
  else
    echo -e "OK\tno Codex runtime revocation signature (${checked} codex agent(s) checked)"
  fi
}

# ── Run all probes ───────────────────────────────────────────────────────────
# Allow `source`-ing the script (probe fns only) from a test harness without running
# the probe/alert/output body. When executed directly, BASH_SOURCE==$0 and this is a no-op.
[[ "${BASH_SOURCE[0]}" != "${0}" ]] && return 0 2>/dev/null || true

PROBES=(gemini clickup triplewhale admanage composio codex_runtime_auth)
# --only <probe[,probe]>: run just the named probe(s). Any probe NOT selected is skipped
# ENTIRELY - its function is never invoked - so a fast --only cron incurs zero cost from the
# other (API/embed-spending) probes. Unknown --only names exit 1 (fail loud, don't silently no-op).
if [[ -n "$ONLY" ]]; then
  IFS=',' read -r -a _only <<< "$ONLY"
  declare -a _filtered=()
  for want in "${_only[@]}"; do
    want="${want// /}"; [[ -z "$want" ]] && continue
    _match=false
    for p in "${PROBES[@]}"; do [[ "$p" == "$want" ]] && { _filtered+=("$want"); _match=true; break; }; done
    [[ "$_match" == true ]] || { echo "Unknown --only probe: $want (valid: ${PROBES[*]})" >&2; exit 1; }
  done
  PROBES=("${_filtered[@]}")
fi
RESULTS=""   # name<TAB>status<TAB>detail per line
for name in "${PROBES[@]}"; do
  line=$("probe_${name}" 2>/dev/null || echo -e "DEGRADED\tprobe errored")
  status="${line%%$'\t'*}"
  detail="${line#*$'\t'}"
  RESULTS+="${name}	${status}	${detail}"$'\n'
  echo "[$TS] ${name}: ${status} - ${detail}" >> "$LOG_FILE"
done

# ── State + alert decision (stateful dedup; alert on transition + slow re-alert) ──
ALERTS=$(RESULTS="$RESULTS" STATE_FILE="$STATE_FILE" COOLDOWN="$COOLDOWN" python3 <<'PY'
import os, json, time
now = int(time.time())
cooldown = int(os.environ["COOLDOWN"])
sf = os.environ["STATE_FILE"]
try:
    state = json.load(open(sf))
except Exception:
    state = {}

alerts = []
new_state = {}
for raw in os.environ["RESULTS"].splitlines():
    if not raw.strip():
        continue
    parts = raw.split("\t")
    name = parts[0]
    status = parts[1] if len(parts) > 1 else "DEGRADED"
    detail = parts[2] if len(parts) > 2 else ""
    prev = state.get(name, {})
    prev_status = prev.get("status", "OK")
    prev_alert = int(prev.get("last_alert", 0))
    since = int(prev.get("since", now)) if prev_status == status else now
    last_alert = prev_alert

    broken = status in ("FAIL", "DEGRADED")
    was_broken = prev_status in ("FAIL", "DEGRADED")

    if broken:
        transition = (status != prev_status)
        cooled = (now - prev_alert) >= cooldown
        if transition or cooled:
            icon = "🔴" if status == "FAIL" else "🟠"
            dur = ""
            if not transition and since:
                mins = max(1, (now - since) // 60)
                dur = " (broken %dm)" % mins
            alerts.append("%s Dependency health - %s %s%s\n%s" % (icon, name.upper(), status, dur, detail))
            last_alert = now
    elif status == "OK" and was_broken:
        alerts.append("🟢 Dependency health - %s RECOVERED\n%s" % (name.upper(), detail))
        last_alert = 0

    new_state[name] = {"status": status, "since": since, "last_alert": last_alert}

try:
    json.dump(new_state, open(sf, "w"))
except Exception:
    pass

# Emit alerts separated by a record-separator so multi-line messages survive.
print("\x1e".join(alerts), end="")
PY
)

# ── Send alerts ──────────────────────────────────────────────────────────────
if [[ -n "$ALERTS" ]]; then
  while IFS= read -r -d $'\x1e' MSG || [[ -n "$MSG" ]]; do
    [[ -z "$MSG" ]] && continue
    echo "[$TS] ALERT: ${MSG//$'\n'/ }" >> "$LOG_FILE"
    echo "$MSG" >&2
    # Operational dependency-health alert -> orchestrator (ops) BY CONSTRUCTION,
    # NOT a direct human ping. The send-telegram CLI now defaults messageClass=human
    # (so agent replies reach Adam), which means a send-telegram-to-CHAT_ID here would
    # BYPASS the send-layer belt and hit Adam. Route to ops directly instead; the
    # orchestrator triages and only escalates to Adam if a human decision is needed.
    cortextos bus notify-agent the-orchestrator "[DEP-HEALTH] $MSG" >/dev/null 2>&1 || true
  done <<< "$ALERTS"
fi

# ── Output summary ───────────────────────────────────────────────────────────
if [[ "$QUIET" == "false" ]]; then
  RESULTS="$RESULTS" python3 <<'PY'
import os, json
out = {"checked_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()), "deps": {}}
for raw in os.environ["RESULTS"].splitlines():
    if not raw.strip():
        continue
    p = raw.split("\t")
    out["deps"][p[0]] = {"status": p[1] if len(p) > 1 else "?", "detail": p[2] if len(p) > 2 else ""}
out["unhealthy"] = [k for k, v in out["deps"].items() if v["status"] in ("FAIL", "DEGRADED")]
print(json.dumps(out, indent=2))
PY
fi

exit 0
