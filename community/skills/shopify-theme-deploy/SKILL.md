---
name: shopify-theme-deploy
description: "Runbook for safely editing + deploying Shopify theme/section changes (e.g. a landing page) via the Shopify CLI: preview-render correctly, push to the live theme, purge the per-device page cache, and VERIFY across UAs. Captures the non-obvious failure modes that make 'verified live' lie if you skip them."
triggers: ["shopify theme", "deploy theme", "push theme live", "theme cache", "publish shopify page"]
---

# Shopify Theme Deploy Runbook

Hard-won from a real landing-page deploy. The CLI parts are easy; the traps are
(1) previewing the wrong render, (2) the live-push confirmation, (3) the
per-device page cache, and (4) verifying Liquid you can't see in the HTML. Each
one can make you report "live + verified" when it isn't.

## Workflow

1. **Pull the section/theme** to a local dir:
   `shopify theme pull --theme <id> --only sections/<file>.liquid --path <dir> --nodelete`
2. **Edit locally.** Keep changes scoped to the one section if you can (smaller
   blast radius on push).
3. **Preview-render the edits** — see Trap 1 (use `shopify theme dev`, NOT
   `?preview_theme_id=`).
4. **Push to an UNPUBLISHED preview theme**, get human approval on that preview:
   `shopify theme push --theme <preview-id> --only sections/<file>.liquid --path <dir> --json`
5. **Publish to live** (approval-gated, external/prod action) — see Trap 2:
   `shopify theme push --theme <LIVE-id> --allow-live --only sections/<file>.liquid --path <dir> --json`
6. **Purge the page cache** — see Trap 3.
7. **Verify across ALL UAs** before claiming done — see Trap 3 + Trap 4.

---

## Trap 1 — `?preview_theme_id=` renders the LIVE theme to a logged-out browser

A storefront URL like `https://store.com/page?preview_theme_id=<id>` only renders
the unpublished theme **if the request carries an admin/preview session**. A
headless browser or `curl` (no session) is served the **live published theme** —
so your "preview check" silently validates the wrong thing.

- **The owner**, logged into Shopify admin, CAN see it via `?preview_theme_id=`.
- **For automated/headless verification**, use `shopify theme dev` instead — it
  runs a local server (`http://127.0.0.1:9292`) that renders your **exact local
  files**. Point your screenshot/detection scripts at that.
- Tell: if a "preview" render is byte-identical to the live page, you're looking
  at live, not your edits.

## Trap 2 — pushing to the live theme needs `--allow-live`

`shopify theme push --theme <live-id> ...` to the **published** theme hits an
interactive confirmation prompt and **aborts in a non-interactive shell**
(nothing is pushed). Add **`--allow-live`** (`-a`) to confirm non-interactively.
This is the gated, external/prod action — get explicit human approval first.

## Trap 3 — Shopify caches the page PER DEVICE/UA; one-UA verify lies

Shopify serves a cached full-page render **keyed by device-class / User-Agent**.
After a deploy, variants refresh independently and a cache-buster **query string
does NOT bust it** (Shopify ignores `?v=...` for its full-page cache key). So:

- **Verify across at least 3 UAs** — iPhone (mobile), desktop-Chrome, and bare
  `curl` (bot-class). They can disagree: e.g. mobile fresh (your edits), desktop +
  curl stale (old render). Never claim "live" off one UA.
- **The theme FILE having your edits ≠ the page serving them.** Confirm both:
  pull the live theme + grep (file is correct), AND fetch the public URL per-UA
  (it's actually serving).

### Purging the per-device cache (after the live push)

- **Re-publishing the ALREADY-live theme is a NO-OP for the cache.**
  `shopify theme publish --theme <live-id>` on the same live theme = no theme
  change = Shopify does not invalidate the full-page cache. Don't rely on it.
- **Reliable lever: re-save the PAGE resource** in admin (Online Store > Pages >
  `<page>` > Save). It bumps the page's `updated_at` and invalidates that page's
  cache across all device variants. (Needs admin access / `write_content` — a
  theme-scoped CLI session can't do it.)
- **Or wait for TTL** — the per-device variants do cycle on their own (observed
  ~hours), just not promptly or in lockstep.

## Trap 4 — verify Liquid-driven markup via RENDERED values, not source tags

Liquid control tags (`{%- assign -%}`, `{%- if -%}`, `{%- for -%}`) are evaluated
server-side and **produce no output** — they never appear in the served HTML. So
grepping the public page for `times: 28 | minus: 70` (your Liquid) always fails,
even when the change is live.

- Verify the **rendered effect**: the computed `style="..."` values, the rendered
  text, the emitted class names — i.e. what the Liquid *produced*, not its source.
- Same discipline as Trap 3: check the **actual served artifact**, not a proxy.

---

## Definition of done

Report per-UA, never one: **theme file has the change** (pull + grep) AND **the
public URL serves it on iPhone + desktop + curl** (rendered values, not Liquid
source) AND **no horizontal-overflow / layout regression**. Until all of that is
true across every UA, it is not "live everywhere" — say so honestly and name what
's still stale.
