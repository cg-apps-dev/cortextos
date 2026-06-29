#!/usr/bin/env node
// web-browse.js - the fleet's general-web browsing tool (Playwright/Chromium headless).
//
// Agents call this to fetch a public web page's TEXT (to read) and optionally a
// SCREENSHOT (to view). For general web only - competitor research, public pages,
// docs, non-CG sites. NOT the live cleangreen.com store (bot-mitigated against
// Playwright; use curl / Microsoft Clarity / the Shopify Admin API for the store).
//
// Usage:
//   node scripts/web-browse.js <url> [--screenshot <path>] [--selector <css>]
//                                    [--html] [--timeout <ms>] [--wait <state>]
//
//   <url>            the page to open (http/https)
//   --screenshot P   also save a full-page PNG to P (default: none)
//   --selector CSS   extract text from this selector instead of <body>
//   --html           print outerHTML of the target instead of innerText
//   --timeout MS     navigation timeout (default 30000)
//   --wait STATE     waitUntil: load | domcontentloaded (default) | networkidle
//
// Output: the page text to stdout (truncated to ~12k chars; full text with --html).
// Exit 0 on success, 1 on error (with a one-line reason to stderr).
//
// Resolves playwright from the repo node_modules regardless of caller cwd.

const path = require('path');
let chromium;
try {
  // node resolves modules from this file's dir up the tree -> repo node_modules
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('web-browse: playwright not found. Run: playwright install chromium (browsers) / npm i (deps).');
  process.exit(1);
}

function parseArgs(argv) {
  const a = { timeout: 30000, wait: 'domcontentloaded' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--screenshot') a.screenshot = argv[++i];
    else if (t === '--selector') a.selector = argv[++i];
    else if (t === '--html') a.html = true;
    else if (t === '--timeout') a.timeout = parseInt(argv[++i], 10) || 30000;
    else if (t === '--wait') a.wait = argv[++i];
    else if (t === '--help' || t === '-h') a.help = true;
    else rest.push(t);
  }
  a.url = rest[0];
  return a;
}

const HELP = `web-browse <url> [--screenshot <path>] [--selector <css>] [--html] [--timeout <ms>] [--wait load|domcontentloaded|networkidle]
General-web only (NOT the live cleangreen.com store - bot-mitigated; use curl/Clarity/Shopify Admin API there).`;

(async () => {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.url) {
    console.log(HELP);
    process.exit(a.url ? 0 : 1);
  }
  if (!/^https?:\/\//i.test(a.url)) {
    console.error('web-browse: url must start with http:// or https://');
    process.exit(1);
  }
  if (!['load', 'domcontentloaded', 'networkidle'].includes(a.wait)) {
    console.error('web-browse: --wait must be load | domcontentloaded | networkidle');
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      // a realistic UA helps with plain public pages; not a bot-mitigation bypass.
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    });
    const resp = await page.goto(a.url, { waitUntil: a.wait, timeout: a.timeout });
    const status = resp ? resp.status() : 'no-response';

    const target = a.selector ? page.locator(a.selector).first() : page.locator('body');
    let out;
    if (a.html) {
      out = await target.evaluate((el) => el.outerHTML).catch(() => '');
    } else {
      out = await target.innerText({ timeout: a.timeout }).catch(() => '');
    }

    if (a.screenshot) {
      await page.screenshot({ path: a.screenshot, fullPage: true });
    }

    const title = await page.title().catch(() => '');
    process.stderr.write(`web-browse: ${status} - ${title}${a.screenshot ? ` - screenshot: ${a.screenshot}` : ''}\n`);
    const MAX = a.html ? 200000 : 12000;
    process.stdout.write(out.length > MAX ? out.slice(0, MAX) + `\n...[truncated ${out.length - MAX} chars]` : out);
    process.stdout.write('\n');
    await browser.close();
    process.exit(0);
  } catch (err) {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    console.error(`web-browse: ${(err && err.message) ? err.message.split('\n')[0] : err}`);
    process.exit(1);
  }
})();
