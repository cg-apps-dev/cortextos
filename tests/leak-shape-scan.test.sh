#!/usr/bin/env bash
#
# Falsifiability tests for the operational shape scanner and hook scoping.

set -uo pipefail
cd "$(dirname "$0")/.."

scanner="scripts/hooks/leak-shape-scan.sh"
tmp_dir="$(mktemp -d)"
fails=0
operator_user=adamfolker
trap 'rm -rf "$tmp_dir" src/shape-guard-planted.ts src/shape-guard-operator.ts src/PHASE9-BACKTEST-REPORT.md PHASE9-REPORT.md' EXIT

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

cat > src/shape-guard-planted.ts <<'EOF'
export const leakedOps = `
| alpha-agent | 0 9 * * * |
| beta-agent  | 15 10 * * * |
`;
EOF
expect_fail "roster_table" bash "$scanner" src/shape-guard-planted.ts
grep -q "fleet roster" "$tmp_dir/roster_table.out" || {
  echo "FAIL: roster table failure did not name roster predicate"
  fails=1
}

cat > src/shape-guard-operator.ts <<EOF
export const badPath = "/Users/$operator_user/cortextos/orgs/example";
EOF
expect_fail "operator_path" bash "$scanner" src/shape-guard-operator.ts
grep -q "operator home path" "$tmp_dir/operator_path.out" || {
  echo "FAIL: operator path failure did not name operator predicate"
  fails=1
}

cat > PHASE9-REPORT.md <<'EOF'
# Planted report artifact
EOF
expect_fail "artifact_path" bash "$scanner" PHASE9-REPORT.md
grep -q "dev-report artifact path" "$tmp_dir/artifact_path.out" || {
  echo "FAIL: artifact path failure did not name artifact predicate"
  fails=1
}

cat > src/PHASE9-BACKTEST-REPORT.md <<'EOF'
# Planted subdir report artifact
EOF
expect_fail "subdir_artifact_path" bash "$scanner" src/PHASE9-BACKTEST-REPORT.md
grep -q "dev-report artifact path" "$tmp_dir/subdir_artifact_path.out" || {
  echo "FAIL: subdir artifact path failure did not name artifact predicate"
  fails=1
}
rm -f src/shape-guard-planted.ts src/shape-guard-operator.ts src/PHASE9-BACKTEST-REPORT.md PHASE9-REPORT.md

current_files="$tmp_dir/current-files.txt"
git ls-files --cached --others --exclude-standard | while IFS= read -r file; do
  [ -f "$file" ] && printf '%s\n' "$file"
done > "$current_files"
if ! xargs bash "$scanner" < "$current_files" >"$tmp_dir/current_worktree.out" 2>&1; then
  echo "FAIL: current worktree scan failed but should have passed"
  cat "$tmp_dir/current_worktree.out"
  fails=1
fi

# The agent-state branch stays gitleaks-only. Feed a synthetic leaked code
# commit to the hook with a fake passing gitleaks binary; it must pass because
# shape scan is not invoked for refs/heads/agent-state.
fake_bin="$tmp_dir/bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/gitleaks" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fake_bin/gitleaks"

tmp_index="$tmp_dir/index"
GIT_INDEX_FILE="$tmp_index" git read-tree HEAD
cat > src/shape-guard-operator.ts <<EOF
export const badPath = "/Users/$operator_user/cortextos/orgs/example";
EOF
blob="$(git hash-object -w src/shape-guard-operator.ts)"
GIT_INDEX_FILE="$tmp_index" git update-index --add --cacheinfo 100644,"$blob",src/shape-guard-operator.ts
tree="$(GIT_INDEX_FILE="$tmp_index" git write-tree)"
commit="$(printf 'synthetic agent-state leak test\n' | git commit-tree "$tree" -p HEAD)"

if ! printf 'refs/heads/main %s refs/heads/agent-state 0000000000000000000000000000000000000000\n' "$commit" \
    | PATH="$fake_bin:$PATH" scripts/hooks/pre-push backup git@example.com:cg-cortextos-backup.git \
    >"$tmp_dir/agent_state_hook.out" 2>&1; then
  echo "FAIL: agent-state simulated push was blocked by shape scan"
  cat "$tmp_dir/agent_state_hook.out"
  fails=1
fi
if grep -q "operational leak shapes" "$tmp_dir/agent_state_hook.out"; then
  echo "FAIL: agent-state simulated push invoked shape scan"
  fails=1
fi

if printf 'refs/heads/main %s refs/heads/main 0000000000000000000000000000000000000000\n' "$commit" \
    | PATH="$fake_bin:$PATH" scripts/hooks/pre-push backup git@example.com:cg-cortextos-backup.git \
    >"$tmp_dir/code_hook.out" 2>&1; then
  echo "FAIL: code simulated push did not invoke/block on shape scan"
  cat "$tmp_dir/code_hook.out"
  fails=1
fi
if ! grep -q "operational leak shape" "$tmp_dir/code_hook.out"; then
  echo "FAIL: code simulated push failure did not name shape scan"
  cat "$tmp_dir/code_hook.out"
  fails=1
fi

if [ "$fails" -eq 0 ]; then
  echo "leak-shape-scan.test: PASS"
else
  echo "leak-shape-scan.test: FAIL"
  exit 1
fi
