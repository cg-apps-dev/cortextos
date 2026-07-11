#!/bin/bash
# deploy-agent-token.sh - safely deploy a Claude setup-token to agent .env files
#
# Bulletproofing born from the 2026-07-11 fleet outage:
#   - RTF token files wrap to MULTIPLE lines; naive extraction ships a 79-char
#     half-token -> 401. This script joins ALL lines before validating.
#   - Validates format (sk-ant-oat01-...) and exact 108-char length BEFORE writing.
#   - Backs up the .env, enforces 0600, prints only a fingerprint (never the token).
#
# Usage:
#   scripts/deploy-agent-token.sh <agent-name> <token-file(.rtf|.txt)>
#   scripts/deploy-agent-token.sh --batch <token-file(.rtf|.txt)> <agent1> <agent2> ...
#   scripts/deploy-agent-token.sh --verify-all      # audit every agent .env token
set -euo pipefail

BASE="${BASE:-/Users/adamfolker/cortextos/orgs/clean-green-marketing/agents}"
CTX_ROOT="${CTX_ROOT:-/Users/adamfolker/.cortextos/default}"
MIN_LEN=100
EXPECTED_LEN=108

fingerprint() { printf '...%s (len %s)' "${1: -6}" "${#1}"; }

usage() {
  echo "usage:"
  echo "  scripts/deploy-agent-token.sh <agent> <token-file>"
  echo "  scripts/deploy-agent-token.sh --batch <token-file> <agent1> <agent2> ..."
  echo "  scripts/deploy-agent-token.sh --verify-all"
}

agent_env_path() {
  local agent="$1"
  printf '%s/%s/.env' "$BASE" "$agent"
}

agent_claude_home() {
  local agent="$1"
  local env_file
  env_file=$(agent_env_path "$agent")
  if [[ -f "$env_file" ]]; then
    local configured
    configured=$(grep -E '^CLAUDE_CONFIG_DIR=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- || true)
    if [[ -n "$configured" ]]; then
      printf '%s' "$configured"
      return
    fi
  fi
  printf '%s/state/%s/claude-home' "$CTX_ROOT" "$agent"
}

extract_token() {
  local src="$1"
  [[ -f "$src" ]] || { echo "ABORT: token file not found: $src"; exit 1; }
  local raw
  if [[ "$src" == *.rtf ]]; then
    raw=$(textutil -convert txt -stdout "$src")
  else
    raw=$(cat "$src")
  fi
  printf '%s' "$raw" | tr -d ' \n\r\t}'
}

validate_token() {
  local token="$1"
  if [[ ! "$token" =~ ^sk-ant-oat01-[A-Za-z0-9_-]+$ ]]; then
    echo "ABORT: extracted value is not a valid sk-ant-oat01 setup-token (prefix mismatch)."
    exit 1
  fi
  if [[ ${#token} -lt $MIN_LEN ]]; then
    echo "ABORT: token too short (${#token} chars, expected $EXPECTED_LEN) - likely truncated."
    exit 1
  fi
  if [[ ${#token} -ne $EXPECTED_LEN ]]; then
    echo "ABORT: token length is ${#token}, expected exactly $EXPECTED_LEN."
    exit 1
  fi
}

read_env_token() {
  local env_file="$1"
  grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

preflight_agent() {
  local agent="$1"
  local env_file
  env_file=$(agent_env_path "$agent")
  [[ -f "$env_file" ]] || { echo "ABORT: no .env for agent '$agent' at $env_file"; exit 1; }
  grep -qE '^CLAUDE_CODE_OAUTH_TOKEN=' "$env_file" || {
    echo "ABORT: $env_file has no CLAUDE_CODE_OAUTH_TOKEN line to replace."
    exit 1
  }
}

deploy_one() {
  local agent="$1"
  local token="$2"
  local env_file old ts tmp reread
  env_file=$(agent_env_path "$agent")
  old=$(read_env_token "$env_file")
  ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  cp "$env_file" "$env_file.bak-$ts"
  chmod 600 "$env_file.bak-$ts"

  tmp=$(mktemp)
  awk -v tok="$token" 'BEGIN{done=0} /^CLAUDE_CODE_OAUTH_TOKEN=/{if(!done){print "CLAUDE_CODE_OAUTH_TOKEN=" tok; done=1; next}} {print}' "$env_file" > "$tmp"
  mv "$tmp" "$env_file"
  chmod 600 "$env_file"

  reread=$(read_env_token "$env_file")
  if [[ "$reread" != "$token" ]]; then
    echo "ABORT: post-write token verification failed for $agent."
    exit 1
  fi

  echo "deployed to $agent:"
  echo "  old: $(fingerprint "$old")"
  echo "  new: $(fingerprint "$token")"
  echo "  backup: $env_file.bak-$ts"
}

if [[ "${1:-}" == "--verify-all" ]]; then
  echo "Token audit (flag = truncated/malformed):"
  fail=0
  for env in "$BASE"/*/.env; do
    ag=$(basename "$(dirname "$env")")
    tok=$(read_env_token "$env")
    home=$(agent_claude_home "$ag")
    cred_flag=""
    if [[ -f "$home/.credentials.json" ]]; then
      cred_flag=" STRAY_CREDENTIALS($home/.credentials.json)"
      fail=1
    fi
    if [[ -z "$tok" ]]; then echo "  $ag: <no bearer token - login mode>$cred_flag"; continue; fi
    if [[ ${#tok} -lt $MIN_LEN || ! "$tok" =~ ^sk-ant-oat01- || ${#tok} -ne $EXPECTED_LEN ]]; then
      echo "  $ag: INVALID token $(fingerprint "$tok") - truncated or malformed$cred_flag"
      fail=1
    else
      echo "  $ag: OK $(fingerprint "$tok")$cred_flag"
    fi
  done
  exit $fail
fi

if [[ "${1:-}" == "--batch" ]]; then
  SRC="${2:-}"
  shift 2 || { usage; exit 1; }
  [[ $# -gt 0 ]] || { echo "ABORT: --batch requires at least one agent."; usage; exit 1; }
  TOKEN=$(extract_token "$SRC")
  validate_token "$TOKEN"
  for agent in "$@"; do preflight_agent "$agent"; done
  echo "batch deploying $(fingerprint "$TOKEN") to $# agents"
  for agent in "$@"; do deploy_one "$agent" "$TOKEN"; done
  echo "batch complete: $# agents updated and post-write verified"
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

AGENT="$1"
SRC="$2"
TOKEN=$(extract_token "$SRC")
validate_token "$TOKEN"
preflight_agent "$AGENT"
deploy_one "$AGENT" "$TOKEN"
echo "next: cortextos stop $AGENT && sleep 60 && cortextos start $AGENT, then verify no 401/429 in its stdout.log"
