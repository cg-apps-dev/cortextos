---
name: web-browse
description: "Browse the general web from an agent - fetch a public page's text and/or a screenshot, extract a selector, or run a multi-step Playwright script. Use for competitor research, reading public pages/docs, checking a non-CG site, or any task needing live web content. Powered by Playwright/Chromium headless (already installed). NOT for the live cleangreen.com store (bot-mitigated - use curl/Clarity/Shopify Admin API there)."
---

# Web Browse (Playwright)

The fleet browses the general web via **Playwright/Chromium headless** (installed: CLI + browser binaries). The agent-facing entry point is a small wrapper that returns a page's TEXT (to read) and optionally a SCREENSHOT (to view). For deeper interaction, drive the Playwright Node API directly.

## SCOPE (read first)
- **USE for: GENERAL web** - competitor research, public marketing/landing pages, docs, news, any non-CG site, public Shopify storefronts other than ours.
- **DO NOT use for the live cleangreen.com store.** It is bot-mitigated against Playwright (headed AND headless): `sf_private_access_tokens` aborts, 0 product tiles render - you get a phantom-empty page, not the real store ([[reference_shopify-store-bot-mitigation-defeats-playwright]]). For OUR store, use: `curl` (assets/configs), Microsoft Clarity (real-user behavior), or the Shopify Admin API (`mint-shopify-token.sh` -> Admin GraphQL) for data. If a task needs live-store browsing, flag it - Playwright is the wrong tool there.

## 1. The common case - fetch a page (text + optional screenshot)
```bash
node "$CTX_FRAMEWORK_ROOT/scripts/web-browse.js" <url> [flags]
```
- prints the page TEXT to stdout (truncated ~12k chars), a status+title line to stderr.
- `--screenshot <path>`  also save a full-page PNG (then Read the PNG to view it).
- `--selector "<css>"`   extract text from a specific element instead of the whole `<body>` (e.g. `--selector "h1"`, `--selector ".price"`).
- `--html`               print outerHTML instead of innerText (for parsing structure; up to 200k chars).
- `--timeout <ms>`       navigation timeout (default 30000).
- `--wait load|domcontentloaded|networkidle`  default `domcontentloaded`; use `networkidle` for JS-heavy pages that load content async.

Examples:
```bash
# read a competitor's landing page
node "$CTX_FRAMEWORK_ROOT/scripts/web-browse.js" https://example-competitor.com

# grab a headline + a screenshot to eyeball
node "$CTX_FRAMEWORK_ROOT/scripts/web-browse.js" https://news.site/article --selector "article" --screenshot /tmp/article.png

# JS-heavy page, wait for content
node "$CTX_FRAMEWORK_ROOT/scripts/web-browse.js" https://app.example.com --wait networkidle
```

## 2. Quick visual capture (no text) - Playwright CLI built-ins
```bash
playwright screenshot --browser chromium <url> out.png    # full-page PNG
playwright pdf <url> out.pdf                               # render to PDF
```

## 3. Multi-step interaction (click, fill, navigate, scrape a flow)
When you need to interact (login form, click-through, paginate, extract a table after an action), write a short Node script using the Playwright API - `require('playwright')` resolves from the repo node_modules. Pattern:
```js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await p.fill('#search', 'query');
  await p.click('button[type=submit]');
  await p.waitForLoadState('networkidle');
  console.log(await p.locator('.results').innerText());
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
```
Keep `headless: true` for agent runs. Use `--wait networkidle` / `waitForLoadState` for async content. Always `await browser.close()` (and in a catch) so no Chromium processes leak.

## Notes
- Headless by default; a realistic User-Agent is set (a courtesy for plain public pages, NOT a bot-mitigation bypass - do not use this to evade a site's protections).
- A non-200 status still returns whatever rendered; check the stderr status line.
- This is general-web browsing, not a scraper-at-scale - be reasonable (no hammering a site).
- Tool: `scripts/web-browse.js` (committed). Engine: Playwright `playwright --version`. Browsers: `~/Library/Caches/ms-playwright/`.
