#!/usr/bin/env bash
# Regression tests for pushed-range selection in scripts/hooks/pre-push.

set -uo pipefail

repo_source="$(cd "$(dirname "$0")/.." && pwd)"
hook_source="$repo_source/scripts/hooks/pre-push"
config_source="$repo_source/scripts/hooks/gitleaks-backup.toml"
shape_source="$repo_source/scripts/hooks/leak-shape-scan.sh"
base_path="$PATH"
tmp_dir="$(mktemp -d)"
repo="$tmp_dir/repo"
fake_bin="$tmp_dir/bin"
calls_file="$tmp_dir/gitleaks.calls"
args_file="$tmp_dir/gitleaks.args"
fails=0
synthetic_secret='sk-ant-test-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  echo "FAIL: $1"
  fails=1
}

install_hook_files() {
  local target_repo="$1"
  mkdir -p "$target_repo/scripts/hooks"
  cp "$hook_source" "$target_repo/scripts/hooks/pre-push"
  cp "$config_source" "$target_repo/scripts/hooks/gitleaks-backup.toml"
  cp "$shape_source" "$target_repo/scripts/hooks/leak-shape-scan.sh"
  chmod +x "$target_repo/scripts/hooks/pre-push" "$target_repo/scripts/hooks/leak-shape-scan.sh"
}

run_hook() {
  local label="$1"
  local mode="$2"
  local input="$3"
  local output="$tmp_dir/$label.out"
  : > "$calls_file"
  : > "$args_file"
  if [ "$mode" = "real" ]; then
    (
      cd "$repo" || exit 1
      printf '%s' "$input" \
        | PATH="$base_path" scripts/hooks/pre-push backup git@example.com:cg-cortextos-backup.git
    ) >"$output" 2>&1
  else
    (
      cd "$repo" || exit 1
      printf '%s' "$input" \
        | GITLEAKS_MODE="$mode" GITLEAKS_CALLS="$calls_file" GITLEAKS_ARGS="$args_file" \
          PATH="$fake_bin:$base_path" \
          scripts/hooks/pre-push backup git@example.com:cg-cortextos-backup.git
    ) >"$output" 2>&1
  fi
}

expect_pass() {
  local label="$1"
  local mode="$2"
  local input="$3"
  if ! run_hook "$label" "$mode" "$input"; then
    fail "$label was blocked"
    cat "$tmp_dir/$label.out"
  fi
}

expect_block() {
  local label="$1"
  local mode="$2"
  local input="$3"
  if run_hook "$label" "$mode" "$input"; then
    fail "$label was allowed"
    cat "$tmp_dir/$label.out"
  fi
}

expect_real_gitleaks_silent() {
  local label="$1"
  local log_opts="$2"
  local output=""
  local rc=0

  output="$({
    cd "$repo" || exit 1
    PATH="$base_path" gitleaks git . --log-opts="$log_opts" \
      -c scripts/hooks/gitleaks-backup.toml --redact --no-banner \
      --no-color --log-level error
  } 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "$label direct gitleaks control exited $rc"
  fi
  if [ -n "$output" ]; then
    fail "$label direct gitleaks control was not byte-empty"
    printf '%s\n' "$output"
  fi
}

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "FAIL: real gitleaks is required for this security regression suite"
  exit 1
fi

mkdir -p "$fake_bin"
cat > "$fake_bin/gitleaks" <<'STUB'
#!/usr/bin/env bash
set -u

log_opts=""
all_args="$*"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --log-opts=*) log_opts="${1#--log-opts=}" ;;
    --log-opts)
      shift
      log_opts="${1:-}" ;;
  esac
  shift
done

printf '%s\n' "${log_opts:-<FULL>}" >> "$GITLEAKS_CALLS"
printf '%s\n' "$all_args" >> "$GITLEAKS_ARGS"

case "${GITLEAKS_MODE:-pass}" in
  pass) exit 0 ;;
  rc0_error)
    echo "ERR [git] synthetic internal git failure" >&2
    exit 0 ;;
  inspect)
    if [ -n "$log_opts" ]; then
      scan_text="$(git log -p -U0 "$log_opts" 2>/dev/null)" || {
        echo "ERR [git] synthetic invalid range" >&2
        exit 0
      }
    else
      scan_text="$(git log -p -U0 --all 2>/dev/null)" || {
        echo "ERR [git] synthetic full-scan failure" >&2
        exit 0
      }
    fi
    if printf '%s' "$scan_text" | grep -q 'SYNTHETIC_SECRET_MARKER'; then
      echo "synthetic secret finding" >&2
      exit 1
    fi
    exit 0 ;;
  *)
    echo "ERR unknown stub mode" >&2
    exit 2 ;;
esac
STUB
chmod +x "$fake_bin/gitleaks"

git init -q -b main "$repo"
git -C "$repo" config user.name "Pre-push Range Test"
git -C "$repo" config user.email "pre-push-range@example.invalid"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
export const clean = true;
EOF
cat > "$repo/src/delete-me.ts" <<'EOF'
export const removable = true;
EOF
git -C "$repo" add src/app.ts src/delete-me.ts
git -C "$repo" commit -q -m "base"
base_sha="$(git -C "$repo" rev-parse HEAD)"

# A secret exists in another local ref. A pushed main range must not scan it,
# while a full-scan fallback must still find it.
git -C "$repo" switch -q -c agent-state
cat > "$repo/src/state-secret.ts" <<EOF
export const planted = "$synthetic_secret"; // SYNTHETIC_SECRET_MARKER
EOF
git -C "$repo" add src/state-secret.ts
git -C "$repo" commit -q -m "out-of-range synthetic secret"

git -C "$repo" switch -q main
cat > "$repo/src/app.ts" <<'EOF'
export const clean = true;
export const updated = true;
EOF
git -C "$repo" add src/app.ts
git -C "$repo" commit -q -m "clean update"
clean_sha="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" switch -q -c secret-branch
cat > "$repo/src/pushed-secret.ts" <<EOF
export const planted = "$synthetic_secret"; // SYNTHETIC_SECRET_MARKER
EOF
git -C "$repo" add src/pushed-secret.ts
git -C "$repo" commit -q -m "in-range synthetic secret"
secret_sha="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" switch -q main
git -C "$repo" switch -q -c empty-branch
git -C "$repo" commit -q --allow-empty -m "empty commit"
empty_sha="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" switch -q main
git -C "$repo" switch -q -c deletion-branch
git -C "$repo" rm -q src/delete-me.ts
git -C "$repo" commit -q -m "deletion-only commit"
deletion_sha="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" switch -q main
git -C "$repo" update-ref refs/remotes/fork/secret-branch "$secret_sha"
install_hook_files "$repo"

oid_width="${#base_sha}"
zero_oid="$(printf '%*s' "$oid_width" '' | tr ' ' 0)"
unknown_oid="$(printf '%*s' "$oid_width" '' | tr ' ' a)"

printf -v clean_update 'refs/heads/main %s refs/heads/main %s\n' "$clean_sha" "$base_sha"
expect_pass "out_of_range_ignored" "real" "$clean_update"

printf -v secret_update 'refs/heads/secret-branch %s refs/heads/secret-branch %s\n' "$secret_sha" "$clean_sha"
expect_block "in_range_secret" "real" "$secret_update"
grep -q "found a potential secret" "$tmp_dir/in_range_secret.out" \
  || fail "in-range secret block did not name a secret finding"

# New-branch scans full local ancestry even if another remote-tracking ref reaches
# the local tip. Using --not --remotes here would omit the planted commit.
printf -v new_branch 'refs/heads/secret-branch %s refs/heads/new-secret %s\n' "$secret_sha" "$zero_oid"
expect_block "cross_remote_new_branch" "real" "$new_branch"

printf -v delete_input '(delete) %s refs/heads/obsolete %s\n' "$zero_oid" "$clean_sha"
expect_pass "delete_noop" "pass" "$delete_input"
if [ -s "$calls_file" ]; then
  fail "delete-only push invoked gitleaks"
fi

# An unresolved remote endpoint must trigger the honest full-graph fallback,
# where the out-of-range planted secret is still found.
printf -v unresolved 'refs/heads/main %s refs/heads/main %s\n' "$clean_sha" "$unknown_oid"
expect_block "unresolved_fallback" "real" "$unresolved"
grep -q "using full graph fallback" "$tmp_dir/unresolved_fallback.out" \
  || fail "unresolved endpoint did not announce full fallback"

# Multi-ref scans are separate. The secret is only in the second range, so a
# combined Git revision expression would under-scan this pair.
printf -v multi_ref 'refs/heads/main %s refs/heads/main %s\nrefs/heads/secret-branch %s refs/heads/secret-branch %s\n' \
  "$clean_sha" "$base_sha" "$secret_sha" "$clean_sha"
expect_block "multi_ref_second_secret" "inspect" "$multi_ref"
if [ "$(wc -l < "$calls_file" | tr -d ' ')" -ne 2 ]; then
  fail "multi-ref push did not invoke gitleaks once per range"
fi
sed -n '1p' "$calls_file" | grep -qx "$base_sha..$clean_sha" \
  || fail "multi-ref first range was not scanned independently"
sed -n '2p' "$calls_file" | grep -qx "$clean_sha..$secret_sha" \
  || fail "multi-ref second range was not scanned independently"

# gitleaks 8.30.1 can return zero while its internal Git command fails. Error-level
# output with rc=0 must therefore block as FAILED TO RUN.
expect_block "rc0_internal_error" "rc0_error" "$clean_update"
grep -q "FAILED TO RUN" "$tmp_dir/rc0_internal_error.out" \
  || fail "rc0 internal error was not classified as scanner failure"
grep -q -- "--log-level error" "$args_file" \
  || fail "gitleaks invocation did not use the error-only output contract"
grep -q -- "--no-color" "$args_file" \
  || fail "gitleaks invocation did not disable color for stable diagnostics"

# Healthy non-empty Git ranges may still report zero commits scanned when their
# only commit has no additions. These must not be blocked by a literal count gate.
printf -v empty_input 'refs/heads/empty-branch %s refs/heads/empty-branch %s\n' "$empty_sha" "$clean_sha"
expect_real_gitleaks_silent "empty_commit" "$clean_sha..$empty_sha"
expect_pass "empty_commit" "real" "$empty_input"
printf -v deletion_input 'refs/heads/deletion-branch %s refs/heads/deletion-branch %s\n' "$deletion_sha" "$clean_sha"
expect_real_gitleaks_silent "deletion_only_commit" "$clean_sha..$deletion_sha"
expect_pass "deletion_only_commit" "real" "$deletion_input"

# Empty, malformed, and unsupported-ref input are all uncertainty, so all take
# the full fallback and find the secret elsewhere in the graph.
expect_block "empty_stdin_fallback" "real" ""
printf -v malformed_input 'refs/heads/main %s refs/heads/main %s extra\n' "$clean_sha" "$base_sha"
expect_block "malformed_fallback" "real" "$malformed_input"
printf -v tag_input 'refs/tags/v1 %s refs/tags/v1 %s\n' "$clean_sha" "$base_sha"
expect_block "tag_fallback" "real" "$tag_input"

# Object ID validation follows the repository format instead of hardcoding SHA-1.
sha256_repo="$tmp_dir/repo-sha256"
if ! git init -q --object-format=sha256 -b main "$sha256_repo" 2>/dev/null; then
  fail "host Git cannot create the required SHA-256 regression repository"
else
  git -C "$sha256_repo" config user.name "Pre-push Range Test"
  git -C "$sha256_repo" config user.email "pre-push-range@example.invalid"
  mkdir -p "$sha256_repo/src"
  cat > "$sha256_repo/src/app.ts" <<'EOF'
export const clean = true;
EOF
  git -C "$sha256_repo" add src/app.ts
  git -C "$sha256_repo" commit -q -m "sha256 base"
  sha256_base="$(git -C "$sha256_repo" rev-parse HEAD)"
  cat > "$sha256_repo/src/app.ts" <<'EOF'
export const clean = true;
export const updated = true;
EOF
  git -C "$sha256_repo" add src/app.ts
  git -C "$sha256_repo" commit -q -m "sha256 update"
  sha256_tip="$(git -C "$sha256_repo" rev-parse HEAD)"
  install_hook_files "$sha256_repo"
  repo_before_sha256="$repo"
  repo="$sha256_repo"
  printf -v sha256_input 'refs/heads/main %s refs/heads/main %s\n' "$sha256_tip" "$sha256_base"
  expect_pass "sha256_width" "pass" "$sha256_input"
  grep -qx "$sha256_base..$sha256_tip" "$calls_file" \
    || fail "SHA-256 range did not use the repositories 64-character object IDs"
  sha256_zero="$(printf '%*s' "${#sha256_base}" '' | tr ' ' 0)"
  printf -v sha256_delete '(delete) %s refs/heads/obsolete %s\n' "$sha256_zero" "$sha256_tip"
  expect_pass "sha256_delete" "pass" "$sha256_delete"
  if [ -s "$calls_file" ]; then
    fail "SHA-256 delete-only push invoked gitleaks"
  fi
  repo="$repo_before_sha256"
fi

if [ "$fails" -ne 0 ]; then
  echo "pre-push-gitleaks-range.test: FAIL"
  exit 1
fi

echo "pre-push-gitleaks-range.test: PASS"
