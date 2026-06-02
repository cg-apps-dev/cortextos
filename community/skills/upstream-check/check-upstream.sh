#!/usr/bin/env bash
# check-upstream.sh — daily READ-ONLY detection of upstream cortextOS updates,
# with a self-maintaining mine-vs-theirs classification.
#
# Does NOT merge, NOT push, NOT modify the working tree. It only fetches upstream
# and reports. A new upstream commit is classified MINE-VS-THEIRS iff it touches a
# file that LOCAL has also modified since the divergence point — so the
# "protect-list" is regenerated from git every run and can never go stale.
#
# Output is structured for an agent to read + narrate:
#   NEW_UPSTREAM_COMMITS=<n>
#   STATUS=up_to_date | updates_available | fetch_failed
#   MERGE_BASE=<sha>
#   COMMIT|<short-sha>|<MINE-VS-THEIRS|safe-pull>|<subject>|<overlapping local files,csv>
#
# Override the compared upstream ref for testing: UPSTREAM_REF=upstream/<branch>
set -uo pipefail

REPO="${CTX_FRAMEWORK_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$REPO" || { echo "STATUS=fetch_failed"; echo "ERROR=bad_repo"; exit 0; }

# Read-only fetch (never push). Non-fatal on failure (e.g. offline).
if ! git fetch upstream --quiet 2>/dev/null; then
  echo "NEW_UPSTREAM_COMMITS=0"
  echo "STATUS=fetch_failed"
  exit 0
fi

UREF="${UPSTREAM_REF:-upstream/main}"
git rev-parse --verify "$UREF" >/dev/null 2>&1 || UREF="upstream/master"

N=$(git rev-list --count "main..$UREF" 2>/dev/null || echo 0)
echo "NEW_UPSTREAM_COMMITS=$N"

if [[ "$N" -eq 0 ]]; then
  echo "STATUS=up_to_date"
  exit 0
fi

echo "STATUS=updates_available"
echo "UPSTREAM_REF=$UREF"
# Protect surface is ALWAYS anchored to the divergence from upstream/main (the
# canonical upstream tip) — i.e. "what's mine" = local's customizations vs
# upstream/main — independent of which ref we're classifying. (Anchoring to the
# compared ref's own merge-base would inflate the surface when testing against an
# old-based feature branch.)
MB=$(git merge-base upstream/main main 2>/dev/null || git merge-base "$UREF" main)
echo "MERGE_BASE=$MB"

# The live protect surface, derived from git every run (never a stale hardcoded list):
#  - LOCAL_MOD  = exact files local modified since the divergence point (hard-conflict surface)
#  - LOCAL_DIRS = the directories of those files (functional-parallelism surface — an
#    upstream change in the same customized area, even a different file, warrants review)
LOCAL_MOD="$(git diff --name-only "$MB"..main | sort -u)"
LOCAL_DIRS="$(printf '%s\n' "$LOCAL_MOD" | sed 's#/[^/]*$##' | sort -u)"

# Classify one commit's files. Echoes: <FLAG>|<overlapping-detail>
#   MINE-VS-THEIRS = touches a file local also modified (direct git conflict)
#   AREA-OVERLAP   = touches a customized area (same dir, different file) — functional review
#   safe-pull      = neither
classify() {
  local files="$1" exact dirs
  exact="$(comm -12 <(printf '%s\n' "$LOCAL_MOD") <(printf '%s\n' "$files") 2>/dev/null)"
  if [[ -n "$exact" ]]; then
    echo "MINE-VS-THEIRS|$(printf '%s' "$exact" | tr '\n' ',' | sed 's/,$//')"
    return
  fi
  dirs="$(printf '%s\n' "$files" | sed 's#/[^/]*$##' | sort -u)"
  local areahit
  areahit="$(comm -12 <(printf '%s\n' "$LOCAL_DIRS") <(printf '%s\n' "$dirs") 2>/dev/null)"
  if [[ -n "$areahit" ]]; then
    echo "AREA-OVERLAP|$(printf '%s' "$areahit" | tr '\n' ',' | sed 's/,$//')"
  else
    echo "safe-pull|"
  fi
}

# Per-commit classification (oldest -> newest). Tally as we go via a temp file
# (the while-loop runs in a pipe subshell, so counters wouldn't survive otherwise).
TALLY="$(mktemp)"; : > "$TALLY"
git rev-list --reverse "main..$UREF" | while read -r sha; do
  short=$(git log -1 --format='%h' "$sha")
  subj=$(git log -1 --format='%s' "$sha"); subj="${subj//|/ }"
  files="$(git show --name-only --format= "$sha" | sed '/^[[:space:]]*$/d' | sort -u)"
  res="$(classify "$files")"
  flag="${res%%|*}"; ov="${res#*|}"
  echo "COMMIT|$short|$flag|$subj|$ov"
  echo "$flag" >> "$TALLY"
done
echo "OVERLAP_COMMITS=$(grep -c 'MINE-VS-THEIRS' "$TALLY" 2>/dev/null || true)"
echo "AREA_COMMITS=$(grep -c 'AREA-OVERLAP' "$TALLY" 2>/dev/null || true)"
echo "SAFE_COMMITS=$(grep -c 'safe-pull' "$TALLY" 2>/dev/null || true)"
rm -f "$TALLY"
