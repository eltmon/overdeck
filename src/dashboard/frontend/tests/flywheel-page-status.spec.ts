import { test, expect } from '@playwright/test';

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:3010';

const flywheelStatus = {
  runId: 'RUN-7',
  startedAt: '2026-05-18T12:00:00.000Z',
  elapsedMs: 125000,
  orchestrator: {
    harness: 'claude-code',
    model: 'claude-opus-4-7',
    effort: 'high',
    ctxPercent: 42,
  },
  headline: {
    bugsFixed: 1,
    swarmItemsMerged: 2,
    swarmItemsTotal: 3,
    prsMerged: 4,
    awaitingUat: 5,
  },
  activePipeline: [
    { issueId: 'PAN-1', title: 'Fix dashboard status', verb: 'working', status: 'running', progressPercent: 50, pr: 123 },
  ],
  substrateBugs: [],
  agents: [
    { id: 'flywheel-orchestrator', label: 'flywheel-orchestrator', status: 'running', role: 'flywheel', model: 'claude-opus-4-7' },
  ],
  parked: [],
  suggestions: [],
  system: {
    mainHead: 'cafebabefeed1234',
    ramUsedMb: 1024,
    ramTotalMb: 4096,
    swapUsedMb: 512,
    swapTotalMb: 1024,
    agentsActive: 3,
    agentsCap: 8,
  },
  openQuestions: [],
  ticks: 3,
  lastTickAt: '2026-05-18T12:03:00.000Z',
};

test.describe('Flywheel page', () => {
  test('renders a live FlywheelStatus payload without browser console errors', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.addInitScript(() => {
      class MockWebSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        url: string;
        readyState = MockWebSocket.CONNECTING;
        bufferedAmount = 0;
        extensions = '';
        protocol = '';
        binaryType: BinaryType = 'blob';
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;

        constructor(url: string | URL) {
          super();
          this.url = String(url);
          queueMicrotask(() => {
            this.readyState = MockWebSocket.OPEN;
            const event = new Event('open');
            this.onopen?.(event);
            this.dispatchEvent(event);
          });
        }

        send() {}

        close() {
          this.readyState = MockWebSocket.CLOSED;
          const event = new CloseEvent('close');
          this.onclose?.(event);
          this.dispatchEvent(event);
        }
      }

      window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    });

    await page.route('**/api/dashboard/session', (route) => route.fulfill({ status: 200, body: '{}' }));
    await page.route('**/api/flywheel/current', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(flywheelStatus),
    }));
    await page.route('**/api/flywheel/runs?limit=10', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'RUN-7', startedAt: flywheelStatus.startedAt, status: 'running' }]),
    }));
    await page.route('**/api/flywheel/runs/RUN-7', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'RUN-7',
        startedAt: flywheelStatus.startedAt,
        status: 'running',
        latest: flywheelStatus,
        paths: { latest: '/tmp/latest.json' },
      }),
    }));
    await page.route('**/api/flywheel/conversation', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null',
    }));
    await page.route('**/api/settings', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ roles: { flywheel: { model: 'claude-opus-4-7', effort: 'high' } } }),
    }));

    await page.goto(`${DASHBOARD_URL}/flywheel`);

    await expect(page.getByLabel('Flywheel page')).toBeVisible();
    const statusPane = page.getByLabel('Flywheel status pane');
    await expect(statusPane.getByText('Live run')).toBeVisible();
    await expect(statusPane.getByText('RUN-7')).toBeVisible();
    await expect(statusPane.getByText('PAN-1')).toBeVisible();
    await page.getByLabel('Flywheel page').screenshot({ path: testInfo.outputPath('flywheel-page-live.png') });

    expect(consoleErrors).toEqual([]);
  });
});
