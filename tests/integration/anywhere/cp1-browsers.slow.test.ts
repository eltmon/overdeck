/**
 * CP-1 (PAN-4833 WI-10, pan-4823 AC-5 second half): the web build of the secure channel, on
 * pure-JS libsodium, pairs with the server's real responder and moves 1 MiB in Playwright Chromium
 * under 4x CPU throttling and in Playwright WebKit. No sleeps: every wait is an awaited event with
 * a 60 s ceiling. Run with VITEST_INCLUDE_SLOW=1; record the numbers in
 * packages/anywhere-channel/CP-1.md.
 */
import { type Browser, chromium, webkit } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCp1, type Cp1Result, type Cp1Server, startCp1Server } from '../../../packages/anywhere-channel/cp1/serve.js';

const RESULT_TIMEOUT_MS = 60_000;

let server: Cp1Server;

beforeAll(async () => {
  await buildCp1();
  server = await startCp1Server({ host: '127.0.0.1', port: 0 });
}, 120_000);

afterAll(async () => {
  await server?.close();
});

async function runLeg(browser: Browser, throttle: boolean): Promise<Cp1Result> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (throttle) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await page.goto(server.pageUrl());
    const text = await page.locator('#result').filter({ hasText: '"engine"' }).textContent({ timeout: RESULT_TIMEOUT_MS });
    return JSON.parse(text ?? '{}') as Cp1Result;
  } finally {
    await context.close();
  }
}

describe('CP-1: sodium in a browser engine', () => {
  it('pairs and moves 1 MiB in Chromium with 4x CPU throttling', async () => {
    const browser = await chromium.launch();
    try {
      const result = await runLeg(browser, true);
      console.log(`CP-1 chromium (4x throttled): ${JSON.stringify(result)}`);
      expect(result.ok).toBe(true);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('pairs and moves 1 MiB in WebKit', async () => {
    const browser = await webkit.launch();
    try {
      const result = await runLeg(browser, false);
      console.log(`CP-1 webkit: ${JSON.stringify(result)}`);
      expect(result.ok).toBe(true);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
