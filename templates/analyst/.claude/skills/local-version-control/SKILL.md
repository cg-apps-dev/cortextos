---
name: local-version-control
description: "Daily git snapshot of agent workspace changes, committed to an ISOLATED branch (analyst-snapshots/<date>) so it never touches mainline, HEAD, or another agent's work. Stages with safety checks, reviews for PII, never pushes."
triggers: ["auto-commit", "git snapshot", "commit changes", "version control"]
---

# Local Version Control

Daily snapshot of agent workspace changes. The snapshot is committed to an
**isolated branch** (`analyst-snapshots/<date>`) using a temporary git index, so
it captures the workspace state WITHOUT touching mainline, HEAD, the shared
index, or the working tree. A non-git-owner agent can snapshot safely even while
others are mid-work on the shared checkout — no clobbering.

> Why isolated: the dev server serves the shared working tree on `:3000`, and a
> blanket commit to `main` both pollutes mainline and can sweep up other agents'
> in-progress files. Committing to `analyst-snapshots/<date>` avoids both.

## When to Run

- Daily cron (configured via `cortextos bus add-cron`)
- After major agent work sessions
- Before any destructive operations

## Workflow

### Step 1: Preview what would be snapshotted

```bash
cortextos bus auto-commit --dry-run
```

This reports the files that would be captured (`staged`) and the ones the safety
filter excluded (`blocked`). The filter already blocks:
- `.env` files and credential patterns
- files over 10MB
- binary/temp files
- `.gitignore`'d paths

### Step 2: Review for PII / secrets

Inspect the previewed files before committing:

```bash
git diff -- <tracked-file>     # for modified tracked files
cat <new-file>                 # for new files
```

Check for PII (names, emails, phone numbers in memory files), secrets (tokens,
API keys, passwords), or anything that should not be captured. The safety filter
catches the obvious cases; this is the human-judgment second layer.

### Step 3: Commit the snapshot to the isolated branch

```bash
cortextos bus auto-commit --branch "analyst-snapshots/$(date -u +%F)" -m "daily: <summary of changes>"
```

This commits a full snapshot of the safe files to `analyst-snapshots/<today>`
WITHOUT touching `main`, `HEAD`, the shared index, or the working tree. Each
day's snapshot parents the previous one (a clean snapshot history on its own
branch). The command returns `{"status":"committed","committed_sha":...,"committed_branch":...}`.

> Do NOT run a bare `git commit` — that would land the snapshot on whatever
> branch the shared tree is checked out to (mainline), which is exactly what
> this skill exists to avoid.

### Step 4: Do NOT push

Auto-commit never pushes. The user or orchestrator decides when (and whether) to
push the `analyst-snapshots/*` refs anywhere.

## Config

Requires `ecosystem.local_version_control.enabled: true` in config.json.

## Safety

- Never commits `.env` files or files matching credential patterns
- Never commits to mainline — always an isolated `analyst-snapshots/<date>` ref
- Leaves the served working tree, HEAD, and shared index untouched
- Always reviews the diff before committing
- Never pushes automatically
