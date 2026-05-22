#!/usr/bin/env node
/**
 * capture-doc-shot.mjs — capture a Panopticon dashboard view for the docs site
 * in BOTH light and dark mode.
 *
 * Every screenshot shown in the Mintlify docs has a light and a dark variant so
 * the docs site can show whichever matches the reader's theme (see the
 * <ThemedImage> snippet in snippets/themed-image.mdx). This script produces
 * both variants in one run.
 *
 * Usage:
 *   node scripts/capture-doc-shot.mjs <path> <output-basename> [options]
 *
 * Writes <output-basename>-light.png and <output-basename>-dark.png.
 *
 *   <path>             Route on the dashboard, e.g. "/" or "/issues/PAN-655"
 *   <output-basename>  Output path without the -light/-dark suffix, e.g.
 *                      "images/specialists/01-board-hero"
 *
 * Options:
 *   --base <url>       Dashboard base URL (default: https://pan.localhost)
 *   --selector <css>   Screenshot only this element instead of the viewport
 *   --full-page        Capture the full scrollable page
 *   --width <n>        Viewport width  (default: 1440)
 *   --height <n>       Viewport height (default: 900)
 *   --wait <ms>        Settle delay after load before capture (default: 1800)
 *   --wait-for <css>   Wait for this selector to appear before capturing
 *   --scale <n>        Device scale factor for crisp output (default: 2)
 *
 * The dashboard stores its theme in localStorage under 'panopticon.ui.theme'.
 * This script seeds that key before navigation so the page renders in the
 * requested theme from first paint.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const THEME_STORAGE_KEY = 'panopticon.ui.theme';
const THEMES = ['light', 'dark'];

function parseArgs(argv) {
  const positional = [];
  const opts = {
    base: 'https://pan.localhost',
    selector: null,
    fullPage: false,
    width: 1440,
    height: 900,
    wait: 1800,
    waitFor: null,
    scale: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--base': opts.base = argv[++i]; break;
      case '--selector': opts.selector = argv[++i]; break;
      case '--full-page': opts.fullPage = true; break;
      case '--width': opts.width = Number(argv[++i]); break;
      case '--height': opts.height = Number(argv[++i]); break;
      case '--wait': opts.wait = Number(argv[++i]); break;
      case '--wait-for': opts.waitFor = argv[++i]; break;
      case '--scale': opts.scale = Number(argv[++i]); break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    console.error('Usage: node scripts/capture-doc-shot.mjs <path> <output-basename> [options]');
    process.exit(1);
  }
  opts.path = positional[0];
  opts.outBase = positional[1];
  return opts;
}

async function captureTheme(browser, theme, opts) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, // pan.localhost uses a local mkcert certificate
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.scale,
    colorScheme: theme,
  });
  // Seed the theme before any page script runs so applyTheme() picks it up.
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_STORAGE_KEY, theme],
  );
  const page = await context.newPage();
  const url = new URL(opts.path, opts.base).href;
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  if (opts.waitFor) {
    await page.waitForSelector(opts.waitFor, { timeout: 15_000 });
  }
  if (opts.wait) {
    await page.waitForTimeout(opts.wait);
  }
  const outFile = resolve(`${opts.outBase}-${theme}.png`);
  await mkdir(dirname(outFile), { recursive: true });
  if (opts.selector) {
    await page.locator(opts.selector).first().screenshot({ path: outFile });
  } else {
    await page.screenshot({ path: outFile, fullPage: opts.fullPage });
  }
  await context.close();
  return outFile;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch();
  try {
    for (const theme of THEMES) {
      const file = await captureTheme(browser, theme, opts);
      console.log(`  ${theme.padEnd(5)} -> ${file}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`capture-doc-shot failed: ${err.message}`);
  if (/ERR_CONNECTION|net::|ECONNREFUSED/.test(err.message)) {
    console.error('Is the dashboard running? Start it with `pan up`.');
  }
  process.exit(1);
});
