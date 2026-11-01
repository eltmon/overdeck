/**
 * PAN-4650 WI-21: the five title-bar machine states in Ledger and Broadsheet,
 * light and dark. Renders tests/e2e/fixtures/linked-conversations.ts (the real
 * components, CSS module and theme tokens) in an isolated Chromium context,
 * checks each header's background (--card for local, D-4650-19 otherwise),
 * the state's chip, banner text and buttons, and writes 20 screenshots to
 * test-results/linked-title-bar/<theme>-<mode>-<n>-<state>.png for review
 * against .tmp/pan-4646-mockup/shots/.
 *
 * Run: npm run build && npm run test:e2e -- linked-conversation-title-bar
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

type ViteDevServer = {
  listen: () => Promise<void> | void;
  close: () => Promise<void> | void;
  transformIndexHtml: (url: string, html: string) => Promise<string>;
  middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (body: string) => void }, next: () => void) => void) => void };
  httpServer?: { address: () => AddressInfo | string | null };
};

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const frontendRoot = join(projectRoot, 'src/dashboard/frontend');
const fixtureEntry = join(projectRoot, 'tests/e2e/fixtures/linked-conversations.ts');
const shotsDir = join(projectRoot, 'test-results/linked-title-bar');

const STATES = ['local', 'remote', 'offline-saved', 'offline-none', 'released'] as const;
type State = (typeof STATES)[number];
const SCOPES = [
  { theme: 'ledger', mode: 'light', remote: [244, 244, 245] },
  { theme: 'ledger', mode: 'dark', remote: [23, 27, 35] },
  { theme: 'broadsheet', mode: 'light', remote: [232, 231, 229] },
  { theme: 'broadsheet', mode: 'dark', remote: [53, 53, 53] },
] as const;

/** What each state shows (mockup states 1-5). */
const EXPECTED: Record<State, { chip: string | null; banner: string | null; buttons: string[]; readOnly: boolean }> = {
  local: { chip: null, banner: null, buttons: [], readOnly: false },
  remote: { chip: 'on desk', banner: null, buttons: ['Preview', 'Pull here'], readOnly: false },
  'offline-saved': { chip: 'on desk', banner: 'desk is offline (last seen', buttons: ['Read saved copy', 'Continue here'], readOnly: true },
  'offline-none': { chip: 'on desk', banner: 'desk is offline (last seen', buttons: ['Reconnect'], readOnly: true },
  released: { chip: null, banner: 'Continued on laptop · this copy is read-only', buttons: ['Open there'], readOnly: true },
};

let vite: ViteDevServer;
let browser: Browser;
let baseUrl: string;

/** `rgb(…)`, `rgba(…)` or `color(srgb …)` → 0-255 channels. */
function channels(css: string): number[] {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css);
  if (srgb) return srgb.slice(1, 4).map((value) => Math.round(Number(value) * 255));
  return (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
}

function expectClose(actual: number[], expected: readonly number[], label: string): void {
  expect(actual, label).toHaveLength(3);
  actual.forEach((value, index) => expect(Math.abs(value - expected[index]!), `${label} channel ${index}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1));
}

async function openState(state: State, theme: string, mode: string): Promise<Page> {
  // Isolated context: own profile, no shared session with any other agent's browser.
  const context = await browser.newContext({ viewport: { width: 960, height: 420 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`[harness] ${error.message}`));
  await page.goto(`${baseUrl}/linked-harness?state=${state}&theme=${theme}&mode=${mode}`);
  await page.getByTestId('header').waitFor({ timeout: 15_000 });
  return page;
}

beforeAll(async () => {
  const paths = [frontendRoot, projectRoot];
  const { createServer } = await import(require.resolve('vite', { paths })) as { createServer: (options: Record<string, unknown>) => Promise<ViteDevServer> };
  const { default: react } = await import(require.resolve('@vitejs/plugin-react', { paths })) as { default: () => unknown };
  // Tailwind resolves its config from the process cwd; point it at the frontend's.
  const { default: tailwindcss } = await import(require.resolve('tailwindcss', { paths })) as { default: (options: { config: string }) => unknown };
  const { default: autoprefixer } = await import(require.resolve('autoprefixer', { paths })) as { default: () => unknown };
  vite = await createServer({
    root: frontendRoot,
    configFile: false,
    plugins: [react(), {
      name: 'linked-title-bar-harness',
      // Runs before Vite's own middlewares, so the SPA fallback never serves the app instead.
      configureServer(server: ViteDevServer) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/linked-harness')) return next();
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@fs${fixtureEntry}"></script></body></html>`;
          void server.transformIndexHtml(req.url, html).then((page) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(page);
          });
        });
      },
    }],
    css: { postcss: { plugins: [tailwindcss({ config: join(frontendRoot, 'tailwind.config.js') }), autoprefixer()] } },
    // The fixture lives outside the frontend; keep one copy of each shared package.
    resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query', 'lucide-react', 'zustand', 'sonner'] },
    server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [projectRoot] } },
    logLevel: 'error',
  });
  await vite.listen();
  baseUrl = `http://127.0.0.1:${(vite.httpServer?.address() as AddressInfo).port}`;
  browser = await chromium.launch();
  await mkdir(shotsDir, { recursive: true });
  // Warm up: the first load waits for Vite's dependency optimization.
  const warm = await browser.newContext();
  const page = await warm.newPage();
  await page.goto(`${baseUrl}/linked-harness?state=local`, { timeout: 180_000 });
  await page.getByTestId('header').waitFor({ timeout: 180_000 });
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
}, 30_000);

describe('linked conversation title bar (PAN-4650 WI-21)', () => {
  for (const scope of SCOPES) {
    it(`${scope.theme} ${scope.mode}: five states match the mockup and D-4650-19`, async () => {
      for (const [index, state] of STATES.entries()) {
        const page = await openState(state, scope.theme, scope.mode);
        const label = `${scope.theme}-${scope.mode}-${state}`;
        const header = page.getByTestId('header');
        const background = channels(await header.evaluate((el) => getComputedStyle(el).backgroundColor));
        const card = channels(await page.getByTestId('card-probe').evaluate((el) => getComputedStyle(el).backgroundColor));
        expectClose(background, state === 'local' ? card : scope.remote, `${label} header background`);

        const expected = EXPECTED[state];
        const chip = await page.getByTestId('machine-chip').allTextContents();
        expect(chip, label).toEqual(expected.chip ? [expected.chip] : []);
        const banner = await page.getByTestId('machine-banner').allTextContents();
        if (expected.banner) expect(banner[0] ?? '', label).toContain(expected.banner);
        else expect(banner, label).toEqual([]);
        const buttons = (await page.getByRole('button').allTextContents()).map((text) => text.trim()).filter(Boolean);
        expect(buttons, label).toEqual(expected.buttons);
        expect(await page.getByTestId('machine-read-only-notice').count(), label).toBe(expected.readOnly ? 1 : 0);

        await page.screenshot({ path: join(shotsDir, `${scope.theme}-${scope.mode}-${index + 1}-${state}.png`) });
        await page.context().close();
      }
    }, 120_000);
  }
});
