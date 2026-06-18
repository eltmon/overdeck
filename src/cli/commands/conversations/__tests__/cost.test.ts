/**
 * Regression tests for `pan conversations cost` (PAN-457).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../../../lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `cost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function seedSessions() {
  const { upsertDiscoveredSession } = await import('../../../../lib/database/discovered-sessions-db.js');
  const workspaces = ['/home/user/Projects/alpha', '/home/user/Projects/beta', '/home/user/Projects/alpha'];
  const models = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-6'];
  const costs = [0.10, 0.05, 0.20];
  const days = ['2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z', '2025-01-01T00:00:00Z'];

  for (let i = 0; i < 3; i++) {
    upsertDiscoveredSession({
      jsonlPath: `/fake/cost-${i}.jsonl`,
      workspacePath: workspaces[i],
      workspaceHash: `hash${i}`,
      messageCount: 5,
      firstTs: days[i],
      lastTs: days[i],
      modelsUsed: [models[i]],
      primaryModel: models[i],
      tokenInput: 500,
      tokenOutput: 1000,
      estimatedCost: costs[i],
      toolsUsed: [],
      filesTouched: [],
      panopticonManaged: false,
      panIssueId: null,
      panAgentId: null,
      fileSize: 512,
      fileMtime: days[i],
      tags: [],
    });
  }
}

describe('costAction', () => {
  it('prints "no sessions" when db is empty', async () => {
    const { costAction } = await import('../cost.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({});

    expect(logs.join('')).toContain('No sessions found');
  });

  it('groups by workspace by default', async () => {
    await seedSessions();
    const { costAction } = await import('../cost.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({});

    const output = logs.join('\n');
    expect(output).toContain('workspace');
    expect(output).toContain('/home/user/Projects/alpha');
    expect(output).toContain('/home/user/Projects/beta');
  });

  it('groups by model when --by model', async () => {
    await seedSessions();
    const { costAction } = await import('../cost.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({ by: 'model' });

    const output = logs.join('\n');
    expect(output).toContain('model');
    expect(output).toContain('claude-sonnet-4-6');
    expect(output).toContain('claude-haiku-4-5');
  });

  it('groups by day when --by day', async () => {
    await seedSessions();
    const { costAction } = await import('../cost.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({ by: 'day' });

    const output = logs.join('\n');
    expect(output).toContain('2025-01-01');
    expect(output).toContain('2025-01-02');
  });

  it('groups by month when --by month', async () => {
    await seedSessions();
    const { costAction } = await import('../cost.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({ by: 'month' });

    const output = logs.join('\n');
    expect(output).toContain('2025-01');
  });

  it('outputs JSON format when --json', async () => {
    await seedSessions();
    const { costAction } = await import('../cost.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('estimatedCost');
    // Sorted by cost descending
    for (let i = 1; i < parsed.length; i++) {
      expect(parsed[i - 1].estimatedCost).toBeGreaterThanOrEqual(parsed[i].estimatedCost);
    }
  });

  it('dashboard workspace aggregate matches CLI workspace JSON semantics', async () => {
    await seedSessions();
    const { costAction } = await import('../cost.js');
    const { aggregateDiscoveredSessionCostBy } = await import('../../../../lib/database/discovered-sessions-db.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({ json: true, by: 'workspace' });

    const cliRows = JSON.parse(logs.join('')) as Array<{
      key: string;
      sessions: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
    }>;
    const dashboardRows = aggregateDiscoveredSessionCostBy('workspace').entries.map((entry) => ({
      key: entry.key,
      sessions: entry.sessionCount,
      inputTokens: entry.totalTokensIn,
      outputTokens: entry.totalTokensOut,
      estimatedCost: entry.totalCost,
    }));

    expect(dashboardRows).toEqual(cliRows);
  });

  it('total row matches sum of all session costs', async () => {
    await seedSessions();
    const { costAction } = await import('../cost.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await costAction({});

    // Total cost = 0.10 + 0.05 + 0.20 = 0.35
    const output = logs.join('\n');
    expect(output).toContain('0.3500');
  });
});
