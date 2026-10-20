/**
 * PAN-4560 render profiler — records which components commit, how often, and
 * their self render time while four scenarios run against a profiling build.
 *
 *   npm --prefix src/dashboard/frontend run build:profile
 *   npm --prefix src/dashboard/frontend run preview:profile   # :3010, proxies to :3011
 *   cd src/dashboard/frontend && PROFILE_LABEL=baseline npx playwright test tests/profiling/render-profile.spec.ts
 *
 * S2 and S4 open the project home `/command-deck/<PROFILE_PROJECT>` (default
 * `overdeck`): a bare `/command-deck` auto-selects the first conversation, so
 * only a project deep link leaves no conversation open.
 *
 * Results go to .tmp/pan-4560-profile/<label>.json and <label>.md.
 *
 * Read-only by design: the spec never clicks a control that mutates server
 * state (start, stop, archive, merge, send). Synthetic domain events and
 * stream deltas are applied only inside the page, through
 * `window.useDashboardStore` and the profile-only `window.__overdeckQueryClient`.
 * Synthetic events reuse the store's current sequence, so the recovery
 * coordinator's replay position never moves.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import type { ScenarioRecord } from './render-probe';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.resolve(FRONTEND_ROOT, '..', '..', '..', '.tmp', 'pan-4560-profile');
const BASE_URL = (process.env.DASHBOARD_URL ?? 'http://localhost:3010').replace(/\/$/, '');
const LABEL = process.env.PROFILE_LABEL ?? 'baseline';
const PROJECT_HOME = `/command-deck/${encodeURIComponent(process.env.PROFILE_PROJECT ?? 'overdeck')}`;

const STREAM_DELTAS = 40;
const STREAM_DELTA_GAP_MS = 250;
const BURST_BATCHES = 20;
const BURST_BATCH_GAP_MS = 16;
const TYPED_TEXT = 'the quick brown fox jumps over the lazy dog';
const TICKER_WINDOW_MS = 65_000;
const TOP_COMPONENTS = 15;
/** The surfaces PAN-4560's fixes target, reported in every scenario so baseline and after compare directly. */
const WATCHED_COMPONENTS = [
  'App',
  'AppChrome',
  'CommandDeck',
  'ProjectNode',
  'FeatureItem',
  'IssueMissionControl',
  'ConversationList',
  'ConversationRow',
  'ConversationPanel',
  'ComposerFooter',
];

interface ScenarioResult {
  record: ScenarioRecord | null;
  /** How many triggers the window applied, and what one trigger is. */
  triggers: number;
  triggerUnit: string;
  note?: string;
}

interface ConversationRef {
  id: number;
  name: string;
}

let probeScript = '';

async function bundleProbe(): Promise<string> {
  const result = await build({
    configFile: false,
    root: FRONTEND_ROOT,
    logLevel: 'silent',
    // bippy's entry imports react (for its useFiber hook); react's CJS entry
    // reads process.env.NODE_ENV, which does not exist in the page.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve(HERE, 'render-probe.ts'),
        formats: ['iife'],
        name: 'RenderProbe',
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    if (!('output' in output)) continue;
    for (const chunk of output.output) {
      if (chunk.type === 'chunk') return chunk.code;
    }
  }
  throw new Error('render-probe bundle produced no chunk');
}

async function openProfiledPage(browser: Browser, route: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript({ content: probeScript });
  await page.goto(`${BASE_URL}${route}`);
  await page.waitForFunction(
    () => (window as unknown as { useDashboardStore?: { getState(): { bootstrapComplete: boolean } } })
      .useDashboardStore?.getState().bootstrapComplete === true,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(5_000);
  return page;
}

async function beginWindow(page: Page, label: string): Promise<void> {
  await page.evaluate((l) => {
    (window as unknown as { __renderProbe: { begin(label: string): void } }).__renderProbe.begin(l);
  }, label);
}

async function endWindow(page: Page): Promise<ScenarioRecord> {
  return page.evaluate(() =>
    (window as unknown as { __renderProbe: { end(): ScenarioRecord } }).__renderProbe.end());
}

async function pickConversation(page: Page): Promise<ConversationRef | null> {
  return page.evaluate(async () => {
    const res = await fetch('/api/conversations');
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ id: number; name: string; sessionAlive?: boolean }>;
    const row = rows.find((c) => c.sessionAlive) ?? rows[0];
    return row ? { id: row.id, name: row.name } : null;
  });
}

/** Opens the conversation by clicking its list row, or by its deep link when the row is not on screen. */
async function openConversation(page: Page, conversation: ConversationRef): Promise<void> {
  const row = page.locator(`[draggable="true"][title="${conversation.name}"]`).first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
  } else {
    await page.goto(`${BASE_URL}/conv/${conversation.id}`);
  }
  await page.waitForFunction(
    (name) => {
      const client = (window as unknown as {
        __overdeckQueryClient?: { getQueryData(key: unknown[]): unknown };
      }).__overdeckQueryClient;
      return client?.getQueryData(['conversation-messages', name]) !== undefined;
    },
    conversation.name,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(3_000);
}

async function runStreaming(browser: Browser): Promise<ScenarioResult> {
  const page = await openProfiledPage(browser, '/command-deck');
  try {
    const conversation = await pickConversation(page);
    if (!conversation) return { record: null, triggers: 0, triggerUnit: 'delta', note: 'no conversation to open' };
    await openConversation(page, conversation);
    await beginWindow(page, 'S1 streaming conversation');
    await page.evaluate(async ({ name, deltas, gapMs }) => {
      interface Message { id: string; role: string; text: string; createdAt: string }
      const client = (window as unknown as {
        __overdeckQueryClient: {
          setQueryData(key: unknown[], updater: (prev: unknown) => unknown): void;
        };
      }).__overdeckQueryClient;
      for (let i = 0; i < deltas; i += 1) {
        // Same shape useConversationMessagesStream writes: replace the last
        // message with a grown copy, as a streamed text delta does.
        client.setQueryData(['conversation-messages', name], (prev) => {
          const cache = prev as { messages: Message[] } | undefined;
          if (!cache) return prev;
          const last = cache.messages[cache.messages.length - 1];
          const next: Message = last
            ? { ...last, id: `profile-${i}`, text: `${last.text} x` }
            : { id: `profile-${i}`, role: 'assistant', text: 'x', createdAt: new Date().toISOString() };
          return { ...cache, messages: [...cache.messages.slice(0, last ? -1 : undefined), next] };
        });
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
    }, { name: conversation.name, deltas: STREAM_DELTAS, gapMs: STREAM_DELTA_GAP_MS });
    return { record: await endWindow(page), triggers: STREAM_DELTAS, triggerUnit: 'delta' };
  } finally {
    await page.context().close();
  }
}

async function runBurst(browser: Browser): Promise<ScenarioResult> {
  const page = await openProfiledPage(browser, PROJECT_HOME);
  try {
    await beginWindow(page, 'S2 domain-event burst');
    const applied = await page.evaluate(async ({ batches, gapMs }) => {
      interface StoreState {
        sequence: number;
        agentsById: Record<string, { status?: string }>;
        backendPanesById: Record<string, { id: string; stateSince?: number }>;
        derivedIssueStateByIssueId: Record<string, { issueId: string }>;
        applyEvents(events: unknown[]): void;
      }
      const store = (window as unknown as { useDashboardStore: { getState(): StoreState } }).useDashboardStore;
      const snapshot = store.getState();
      const agentIds = Object.entries(snapshot.agentsById)
        .sort(([, a], [, b]) => Number(b.status === 'running') - Number(a.status === 'running'))
        .slice(0, 2)
        .map(([id]) => id);
      const panes = Object.values(snapshot.backendPanesById).slice(0, 3);
      const issueStates = Object.values(snapshot.derivedIssueStateByIssueId).slice(0, 3);
      for (let b = 0; b < batches; b += 1) {
        const { sequence } = store.getState();
        const timestamp = new Date().toISOString();
        const events: unknown[] = [];
        for (let i = 0; i < 4 && agentIds.length > 0; i += 1) {
          events.push({
            type: 'agent.activity_changed',
            sequence,
            timestamp,
            payload: {
              agentId: agentIds[i % agentIds.length],
              activity: (b + i) % 2 === 0 ? 'working' : 'thinking',
              currentTool: 'Read',
            },
          });
        }
        for (const pane of panes) {
          events.push({
            type: 'backend_pane.changed',
            sequence,
            timestamp,
            payload: { pane: { ...pane, stateSince: Date.now() + b } },
          });
        }
        // DerivedIssueState has no timestamp field; the server re-emits an
        // equal state as a new object, so a shallow copy is the realistic event.
        for (const issueState of issueStates) {
          events.push({
            type: 'issue_state.changed',
            sequence,
            timestamp,
            payload: { issueState: { ...issueState } },
          });
        }
        store.getState().applyEvents(events);
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
      return { agents: agentIds.length, panes: panes.length, issueStates: issueStates.length };
    }, { batches: BURST_BATCHES, gapMs: BURST_BATCH_GAP_MS });
    await page.waitForTimeout(500);
    return {
      record: await endWindow(page),
      triggers: BURST_BATCHES,
      triggerUnit: 'batch',
      note: `each batch: ${applied.agents ? 4 : 0} agent.activity_changed over ${applied.agents} agents, ` +
        `${applied.panes} backend_pane.changed, ${applied.issueStates} issue_state.changed`,
    };
  } finally {
    await page.context().close();
  }
}

async function runTyping(browser: Browser): Promise<ScenarioResult> {
  const page = await openProfiledPage(browser, '/command-deck');
  try {
    const conversation = await pickConversation(page);
    if (!conversation) return { record: null, triggers: 0, triggerUnit: 'keystroke', note: 'no conversation to open' };
    await openConversation(page, conversation);
    const editor = page.locator('[contenteditable="true"][aria-placeholder]').last();
    await editor.click();
    await beginWindow(page, 'S3 composer typing');
    await page.keyboard.type(TYPED_TEXT, { delay: 50 });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    // Never press Enter: that would send a message.
    return { record: await endWindow(page), triggers: TYPED_TEXT.length + 2, triggerUnit: 'keystroke' };
  } finally {
    await page.context().close();
  }
}

async function runTickers(browser: Browser): Promise<ScenarioResult> {
  const page = await openProfiledPage(browser, PROJECT_HOME);
  try {
    await beginWindow(page, 'S4 idle tickers');
    await page.waitForTimeout(TICKER_WINDOW_MS);
    return { record: await endWindow(page), triggers: Number((TICKER_WINDOW_MS / 60_000).toFixed(2)), triggerUnit: 'minute' };
  } finally {
    await page.context().close();
  }
}

function formatScenario(title: string, result: ScenarioResult): string {
  const lines = [`### ${title}`, ''];
  if (result.note) lines.push(`_${result.note}_`, '');
  const record = result.record;
  if (!record) {
    lines.push('Not measured.', '');
    return lines.join('\n');
  }
  lines.push(`store sets: ${record.storeSets} · commits: ${record.commits} · triggers: ${result.triggers} ${result.triggerUnit}(s)`, '');
  lines.push(`Watched surfaces:`, '');
  lines.push(`| component | updates | mounts | total self ms | updates per ${result.triggerUnit} |`);
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const name of WATCHED_COMPONENTS) {
    const stats = record.byComponent[name] ?? { updates: 0, mounts: 0, selfMs: 0 };
    const perTrigger = result.triggers > 0 ? stats.updates / result.triggers : 0;
    lines.push(`| ${name} | ${stats.updates} | ${stats.mounts} | ${stats.selfMs.toFixed(2)} | ${perTrigger.toFixed(2)} |`);
  }
  lines.push('', `Top ${TOP_COMPONENTS} by updates:`, '');
  lines.push(`| component | updates | mounts | total self ms | mean ms per render | updates per ${result.triggerUnit} |`);
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  const rows = Object.entries(record.byComponent)
    .sort(([, a], [, b]) => b.updates - a.updates)
    .slice(0, TOP_COMPONENTS);
  for (const [name, stats] of rows) {
    const renders = stats.updates + stats.mounts;
    const mean = renders > 0 ? stats.selfMs / renders : 0;
    const perTrigger = result.triggers > 0 ? stats.updates / result.triggers : 0;
    lines.push(`| ${name} | ${stats.updates} | ${stats.mounts} | ${stats.selfMs.toFixed(2)} | ${mean.toFixed(3)} | ${perTrigger.toFixed(2)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

test.describe('PAN-4560 render profile', () => {
  test.beforeAll(async () => {
    probeScript = await bundleProbe();
  });

  test('records the four scenarios', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const scenarios: Array<[string, ScenarioResult]> = [
      ['S1 — streaming conversation', await runStreaming(browser)],
      [`S2 — domain-event burst, no conversation open (${PROJECT_HOME})`, await runBurst(browser)],
      ['S3 — composer typing', await runTyping(browser)],
      [`S4 — idle tickers, 65 s (${PROJECT_HOME})`, await runTickers(browser)],
    ];

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      path.join(OUT_DIR, `${LABEL}.json`),
      `${JSON.stringify(scenarios.map(([title, result]) => ({ title, ...result })), null, 2)}\n`,
    );
    const markdown = [
      `Label: \`${LABEL}\` · target: ${BASE_URL} · ${new Date().toISOString()}`,
      '',
      ...scenarios.map(([title, result]) => formatScenario(title, result)),
    ].join('\n');
    writeFileSync(path.join(OUT_DIR, `${LABEL}.md`), markdown);
  });
});
