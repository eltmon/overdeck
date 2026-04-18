/**
 * Regression tests for `pan conversations search` (PAN-457).
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
  TEST_HOME = join(tmpdir(), `search-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function seedSession(opts: { id: number; workspace?: string; cost?: number }) {
  const { upsertDiscoveredSession } = await import('../../../../lib/database/discovered-sessions-db.js');
  return upsertDiscoveredSession({
    jsonlPath: `/fake/search-${opts.id}.jsonl`,
    workspacePath: opts.workspace ?? '/home/user/Projects/alpha',
    workspaceHash: `hash${opts.id}`,
    messageCount: 5,
    firstTs: '2025-01-01T00:00:00Z',
    lastTs: '2025-01-01T01:00:00Z',
    modelsUsed: ['claude-sonnet-4-6'],
    primaryModel: 'claude-sonnet-4-6',
    tokenInput: 100,
    tokenOutput: 200,
    estimatedCost: opts.cost ?? 0.01,
    toolsUsed: [],
    filesTouched: [],
    panopticonManaged: false,
    panIssueId: null,
    panAgentId: null,
    fileSize: 512,
    fileMtime: '2025-01-01T00:00:00Z',
    tags: [],
  });
}

describe('searchAction', () => {
  it('prints "no sessions" when nothing matches', async () => {
    const { searchAction } = await import('../search.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await searchAction(undefined, {});

    expect(logs.join('')).toContain('No sessions found');
  });

  it('filter-only: returns matching sessions by workspace', async () => {
    await seedSession({ id: 1, workspace: '/home/user/Projects/alpha' });
    await seedSession({ id: 2, workspace: '/home/user/Projects/beta' });

    const { searchAction } = await import('../search.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await searchAction(undefined, { workspace: '/home/user/Projects/alpha' });

    const output = logs.join('\n');
    expect(output).toContain('/home/user/Projects/alpha');
    expect(output).not.toContain('/home/user/Projects/beta');
  });

  it('filter-only: minCost excludes cheap sessions', async () => {
    await seedSession({ id: 1, cost: 0.001 });
    await seedSession({ id: 2, cost: 0.50 });

    const { searchAction } = await import('../search.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await searchAction(undefined, { format: 'json', minCost: '0.10' });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.length).toBe(1);
    expect(parsed[0].estimatedCost).toBeGreaterThanOrEqual(0.10);
  });

  it('outputs JSON format', async () => {
    await seedSession({ id: 1 });

    const { searchAction } = await import('../search.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await searchAction(undefined, { format: 'json' });

    const parsed = JSON.parse(logs.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });

  it('outputs brief format', async () => {
    await seedSession({ id: 1 });

    const { searchAction } = await import('../search.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await searchAction(undefined, { format: 'brief' });

    expect(logs.length).toBeGreaterThan(0);
  });

  it('respects --limit option', async () => {
    await Promise.all([1, 2, 3].map((i) => seedSession({ id: i })));

    const { searchAction } = await import('../search.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await searchAction(undefined, { format: 'json', limit: '1' });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.length).toBe(1);
  });
});
