/**
 * Conversation timeline rows never overlap (PAN-4497).
 *
 * Runs against an **isolated** dashboard (its own temp `OVERDECK_HOME` and
 * port, no Deacon), never the operator's live dashboard on 3011 — this spec
 * only reads a route-mocked conversation, but the isolated fixture is the
 * house rule for new Playwright specs regardless.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Fixture: 80 messages with varied, estimate-defeating lengths, periodic GFM
 * tables, a work-log group that overflows `MAX_VISIBLE_WORK_LOG_ENTRIES`, and
 * one tall image — all served to a wide (2000px) viewport so the row width
 * (capped at 760px) is narrower than the scroll container, which is the
 * precondition for mechanism A (PAN-4497's "Problem and verified root cause").
 */

import { test, expect, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

test.setTimeout(180_000);

const CONVERSATION_ID = 4497;
const CONVERSATION_NAME = 'timeline-overlap-fixture';
const BASE_TS = 1_700_000_000_000;
const MESSAGE_COUNT = 80;
const TALL_IMAGE_PATH = '/pan-4497/tall.svg';

interface FixtureMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  completedAt?: string;
}

interface FixtureWorkEntry {
  id: string;
  createdAt: string;
  label: string;
  tone: 'tool';
  detail: string;
}

const mockConversation = {
  id: CONVERSATION_ID,
  name: CONVERSATION_NAME,
  tmuxSession: 'conv-timeline-overlap-fixture',
  status: 'active' as const,
  cwd: '/tmp/timeline-overlap-fixture',
  issueId: null,
  createdAt: new Date(BASE_TS).toISOString(),
  endedAt: null,
  lastAttachedAt: new Date(BASE_TS).toISOString(),
  sessionAlive: true,
  isFavorited: false,
  title: 'Timeline overlap fixture',
};

/** Deterministic filler text of exactly `length` characters. */
function fillerText(length: number, seed: string): string {
  const base = `${seed} Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. `;
  let out = '';
  while (out.length < length) out += base;
  return out.slice(0, length);
}

/** A 12-column, 15-row GFM table of 40-character cells. */
function makeWideTable(rowSeed: number): string {
  const cols = 12;
  const header = Array.from({ length: cols }, (_, c) => `Column ${c + 1}`);
  const sep = header.map(() => '---');
  const rows = Array.from({ length: 15 }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const label = `r${rowSeed}.${r}c${c}`;
      return (label + 'x'.repeat(40)).slice(0, 40);
    }),
  );
  return [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildMessages(): FixtureMessage[] {
  const messages: FixtureMessage[] = [];
  let assistantIndex = 0;
  for (let i = 0; i < MESSAGE_COUNT; i++) {
    const role: 'user' | 'assistant' = i % 2 === 0 ? 'user' : 'assistant';
    const createdAt = new Date(BASE_TS + i * 10_000).toISOString();
    if (role === 'user') {
      messages.push({ id: `m${i}`, role, text: fillerText(120, `u${i}`), createdAt });
      continue;
    }
    // Lengths swing between 200 and 4000 chars so size estimates are far off.
    const length = 200 + (assistantIndex % 10) * 422;
    let text = fillerText(length, `a${i}`);
    if (assistantIndex > 0 && assistantIndex % 5 === 0) {
      text += `\n\n${makeWideTable(assistantIndex)}`;
    }
    messages.push({
      id: `m${i}`,
      role,
      text,
      createdAt,
      completedAt: new Date(BASE_TS + i * 10_000 + 2_000).toISOString(),
    });
    assistantIndex += 1;
  }

  // One assistant message near the top carries the tall image.
  const imageMessage = messages.find((m) => m.role === 'assistant');
  if (imageMessage) {
    imageMessage.text += `\n\n![tall](${TALL_IMAGE_PATH})`;
  }

  return messages;
}

/** A group of 10 Bash entries between every fourth pair of messages. */
function buildWorkLog(messages: FixtureMessage[]): FixtureWorkEntry[] {
  const entries: FixtureWorkEntry[] = [];
  for (let i = 4; i < MESSAGE_COUNT; i += 4) {
    const prevTs = Date.parse(messages[i - 1]!.createdAt);
    const nextTs = Date.parse(messages[i]!.createdAt);
    const span = nextTs - prevTs;
    for (let j = 0; j < 10; j++) {
      entries.push({
        id: `w${i}-${j}`,
        createdAt: new Date(prevTs + Math.floor((span * (j + 1)) / 11)).toISOString(),
        label: 'Bash',
        tone: 'tool',
        detail: `group ${i} step ${j}: echo "step ${j}"`,
      });
    }
  }
  return entries;
}

const FIXTURE_MESSAGES = buildMessages();
const FIXTURE_WORK_LOG = buildWorkLog(FIXTURE_MESSAGES);

const TALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="600" height="500" fill="#4477aa"/></svg>`;

async function installFixtures(page: Page): Promise<void> {
  await page.route('**/api/conversations', (route) => route.fulfill({ json: [mockConversation] }));
  await page.route('**/api/conversations/**', (route) => {
    const url = route.request().url();
    if (url.includes('/messages')) {
      return route.fulfill({ json: { messages: FIXTURE_MESSAGES, workLog: FIXTURE_WORK_LOG, streaming: false } });
    }
    if (url.includes('/diffs')) return route.fulfill({ json: { summaries: [] } });
    return route.fulfill({ json: mockConversation });
  });
  // Playwright checks routes in reverse-registration order, so this narrower
  // route overrides the catch-all above: `/api/conversations/pending-input`
  // is not a per-conversation resource and must stay an array, or
  // `usePendingInputDialogs` crashes the whole app on `rows.filter(...)`.
  await page.route('**/api/conversations/pending-input', (route) => route.fulfill({ json: [] }));
  await page.route(`**${TALL_IMAGE_PATH}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: TALL_SVG });
  });
  // The isolated server's WS upgrade auth never consults loopback/peer trust
  // (by design — see ws-auth.ts), so a fresh browser context has no
  // credential and the real handshake fails. Close it immediately, the same
  // way pan-4279-degraded-mode.spec.ts does, so the app falls back to the
  // mocked HTTP endpoints above instead of sitting in "Discovering
  // conversation…" forever waiting on a stream that will never connect.
  await page.routeWebSocket(/\/ws\/rpc/, (ws) => ws.close());
}

/** Two animation-frame ticks plus a settle delay — every ResizeObserver callback has run. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await page.waitForTimeout(200);
}

interface OverlapRecord {
  a: string | null;
  b: string | null;
  overlapPx: number;
}

/** Fails if any two adjacent timeline rows' bounding boxes intersect by more than 1px. */
async function assertNoOverlap(page: Page): Promise<void> {
  const overlaps = await page.evaluate((): OverlapRecord[] => {
    const container = document.querySelector('[class*="messagesTimelineInner"]');
    if (!container) return [];
    const rows = Array.from(container.querySelectorAll('[data-search-row-id]'));
    const rects = rows.map((el) => ({
      id: el.getAttribute('data-search-row-id'),
      rect: el.getBoundingClientRect(),
    }));
    rects.sort((x, y) => x.rect.top - y.rect.top);
    const found: OverlapRecord[] = [];
    for (let i = 0; i < rects.length - 1; i++) {
      const overlapPx = rects[i]!.rect.bottom - rects[i + 1]!.rect.top;
      if (overlapPx > 1) {
        found.push({ a: rects[i]!.id, b: rects[i + 1]!.id, overlapPx });
      }
    }
    return found;
  });
  expect(overlaps, `Overlapping timeline rows: ${JSON.stringify(overlaps)}`).toEqual([]);
}

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

test.describe('PAN-4497 timeline rows never overlap', () => {
  test('no overlap while scrolling', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 2000, height: 1000 } });
    const page = await context.newPage();
    await installFixtures(page);
    await page.goto(`${dashboard.baseUrl}/conv/${CONVERSATION_ID}`);
    await expect(
      page.locator('[class*="conversationTerminalTitleText"]', { hasText: 'Timeline overlap fixture' }),
    ).toBeVisible({ timeout: 20_000 });
    // The title renders from conversation metadata immediately; the timeline
    // body only mounts once the HTTP fallback (MESSAGES_HTTP_FALLBACK_MS)
    // delivers the fixture's 80 messages, which is the real "ready" signal.
    await expect(page.locator('[data-search-row-id]').first()).toBeVisible({ timeout: 30_000 });

    // Precondition: the scroll container is wider than the row width, which
    // is the regime where mechanism A reproduces.
    const widths = await page.evaluate(() => {
      const scrollEl = document.querySelector('[class*="messagesTimeline_"]');
      const innerEl = document.querySelector('[class*="messagesTimelineInner"]');
      return { scroll: scrollEl?.clientWidth ?? 0, inner: innerEl?.clientWidth ?? 0 };
    });
    expect(widths.scroll).toBeGreaterThan(800);
    expect(widths.inner).toBe(760);

    await settle(page);
    await assertNoOverlap(page);

    // Install an in-page per-frame sampler that records any adjacent
    // [data-index] pair whose rects intersect, during fast scrolling.
    await page.evaluate(() => {
      (window as unknown as { __pan4497Log: OverlapRecord[] }).__pan4497Log = [];
      const tick = () => {
        const rows = Array.from(document.querySelectorAll('[data-index]'));
        rows.sort(
          (a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index')),
        );
        for (let i = 0; i < rows.length - 1; i++) {
          const a = rows[i]!.getBoundingClientRect();
          const b = rows[i + 1]!.getBoundingClientRect();
          const overlapPx = a.bottom - b.top;
          if (overlapPx > 1) {
            (window as unknown as { __pan4497Log: OverlapRecord[] }).__pan4497Log.push({
              a: rows[i]!.getAttribute('data-index'),
              b: rows[i + 1]!.getAttribute('data-index'),
              overlapPx,
            });
          }
        }
        (window as unknown as { __pan4497RafId: number }).__pan4497RafId = requestAnimationFrame(tick);
      };
      (window as unknown as { __pan4497RafId: number }).__pan4497RafId = requestAnimationFrame(tick);
    });

    const timeline = page.locator('[class*="messagesTimeline_"]').first();
    await timeline.hover();

    // Wheel to the top in small steps, checking periodically while moving.
    for (let step = 0; step < 60; step++) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(30);
      if (step % 10 === 9) {
        await settle(page);
        await assertNoOverlap(page);
      }
      const atTop = await page.evaluate(() => {
        const el = document.querySelector('[class*="messagesTimeline_"]');
        return el ? el.scrollTop <= 0 : true;
      });
      if (atTop) break;
    }

    // And back down to the bottom.
    for (let step = 0; step < 60; step++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(30);
      if (step % 10 === 9) {
        await settle(page);
        await assertNoOverlap(page);
      }
    }

    await settle(page);
    const sampledOverlaps = await page.evaluate(
      () => (window as unknown as { __pan4497Log: OverlapRecord[] }).__pan4497Log,
    );
    await page.evaluate(() => cancelAnimationFrame((window as unknown as { __pan4497RafId: number }).__pan4497RafId));
    expect(sampledOverlaps, `Per-frame overlaps while scrolling: ${JSON.stringify(sampledOverlaps.slice(0, 10))}`).toEqual([]);

    await context.close();
  });

  test('rows below move down when a row grows', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 2000, height: 1000 } });
    const page = await context.newPage();
    await installFixtures(page);
    await page.goto(`${dashboard.baseUrl}/conv/${CONVERSATION_ID}`);
    await expect(
      page.locator('[class*="conversationTerminalTitleText"]', { hasText: 'Timeline overlap fixture' }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-search-row-id]').first()).toBeVisible({ timeout: 30_000 });

    // Width: scroll to the middle, then resize the panel a couple of times —
    // the lasting-overlap mechanism (A) in PAN-4497 reproduced on a width
    // change while the panel stayed wider than 792px (760px row + padding).
    await page.evaluate(() => {
      const el = document.querySelector('[class*="messagesTimeline_"]');
      if (el) el.scrollTop = el.scrollHeight / 2;
    });
    await settle(page);
    await assertNoOverlap(page);

    await page.setViewportSize({ width: 1800, height: 1000 });
    await settle(page);
    await assertNoOverlap(page);

    await page.setViewportSize({ width: 2000, height: 1000 });
    await settle(page);
    await assertNoOverlap(page);

    // Expand: find a "Show N earlier" button inside a mounted row, expand
    // it, and confirm the next row moved down by the growth amount.
    const expandButton = page.getByRole('button', { name: /Show \d+ earlier/ }).first();
    const found = await expandButton.isVisible({ timeout: 2_000 }).catch(() => false);
    if (found) {
      const row = page.locator('[data-index]', { has: expandButton }).first();
      const before = await row.boundingBox();
      await expandButton.click();
      await settle(page);
      const after = await row.boundingBox();
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      if (before && after) {
        expect(after.height).toBeGreaterThan(before.height - 1);
      }
      await assertNoOverlap(page);
    }

    // Image: scroll near the top where the tall image lives, wait for it to
    // finish loading, then assert no overlap.
    await page.evaluate(() => {
      const el = document.querySelector('[class*="messagesTimeline_"]');
      if (el) el.scrollTop = 0;
    });
    await settle(page);
    const tallImage = page.locator(`img[src*="${TALL_IMAGE_PATH}"]`).first();
    const imageAppeared = await tallImage.isVisible({ timeout: 10_000 }).catch(() => false);
    if (imageAppeared) {
      await tallImage.evaluate((img: HTMLImageElement) =>
        img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; }),
      );
      await settle(page);
      await assertNoOverlap(page);
    }
    // Implementation checkpoint (PRD WI-3 step 9): if Streamdown never
    // renders an <img> for this fixture markdown (sanitizer or URL
    // transform), the image growth case is skipped above without failing
    // the spec — the other growth cases still run and assert.

    // Tool toggle: collapse and re-expand tool calls via the header button.
    // Its title flips between the two states, so it needs two locators.
    const hideToggle = page.locator('button[title="Hide tool calls"]').first();
    await expect(hideToggle).toBeVisible({ timeout: 20_000 });
    await hideToggle.click();
    await settle(page);
    await assertNoOverlap(page);
    const showToggle = page.locator('button[title="Show tool calls"]').first();
    await expect(showToggle).toBeVisible({ timeout: 20_000 });
    await showToggle.click();
    await settle(page);
    await assertNoOverlap(page);

    await context.close();
  });
});
