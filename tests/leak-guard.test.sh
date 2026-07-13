#!/usr/bin/env bash
#
# Falsifiability tests for the CI-facing operational leak scanner.
#
# A scanner nobody has watched fail on a real leak shape is unproven. These
# runtime fixtures prove the composed CI guard catches operator paths through
# leak-shape-scan and sk-ant tokens through the framework gitleaks config.

set -uo pipefail
cd "$(dirname "$0")/.."

scanner="scripts/hooks/leak-shape-scan.sh"
gitleaks_config="$(pwd)/.gitleaks.toml"
tmp_dir="$(mktemp -d)"
fails=0
operator_user="adam""folker"
trap 'rm -rf "$tmp_dir"' EXIT

expect_fail() {
  local label="$1"
  shift
  if "$@" >"$tmp_dir/${label}.out" 2>&1; then
    echo "FAIL: $label passed but should have failed"
    fails=1
  fi
}

expect_pass() {
  local label="$1"
  shift
  if ! "$@" >"$tmp_dir/${label}.out" 2>&1; then
    echo "FAIL: $label failed but should have passed"
    cat "$tmp_dir/${label}.out"
    fails=1
  fi
}

cat > "$tmp_dir/operator.ts" <<'EOF'
export const operatorPath = "__OPERATOR_PATH__";
EOF
sed -i.bak "s#__OPERATOR_PATH__#/Users/${operator_user}/cortextos/orgs/clean-green-marketing/agents/codex-dev-agent#" "$tmp_dir/operator.ts"
rm -f "$tmp_dir/operator.ts.bak"
expect_fail "operator_code_config" bash "$scanner" "$tmp_dir/operator.ts"
grep -q "operator home path" "$tmp_dir/operator_code_config.out" || {
  echo "FAIL: operator path failure did not name operator predicate"
  fails=1
}

cat > "$tmp_dir/example.ts" <<'EOF'
export const examplePath = "/Users/foo/cortextos";
EOF
expect_pass "example_operator_code_config" bash "$scanner" "$tmp_dir/example.ts"

printf 'export const token = "%s";\n' "sk-ant-""oat01-""Ab9_Zx7Qp4Lm""2Ns8Vt6Cr3By""5Hu0Kd1Jw9Ef4Gh2" > "$tmp_dir/secret.ts"
expect_fail "gitleaks_secret_shape" gitleaks dir "$tmp_dir" -c "$gitleaks_config" --redact --no-banner --verbose
grep -q "anthropic-sk-ant-token" "$tmp_dir/gitleaks_secret_shape.out" || {
  echo "FAIL: gitleaks failure did not name anthropic rule"
  fails=1
}

cat > "$tmp_dir/clean.ts" <<'EOF'
export const clean = "framework fixture with no operational path or cron table";
EOF
expect_pass "clean_code_config" bash "$scanner" "$tmp_dir/clean.ts"
expect_pass "clean_gitleaks" gitleaks dir "$tmp_dir/clean.ts" -c "$gitleaks_config" --redact --no-banner --verbose

if [ "$fails" -eq 0 ]; then
  echo "leak-guard.test: PASS"
else
  echo "leak-guard.test: FAIL"
  exit 1
fi
