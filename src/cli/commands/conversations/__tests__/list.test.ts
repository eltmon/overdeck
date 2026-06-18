/**
 * Regression tests for `pan conversations list` (PAN-457).
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
  TEST_HOME = join(tmpdir(), `list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function seedSessions(count: number, workspace = '/home/user/Projects/alpha') {
  const { upsertDiscoveredSession } = await import('../../../../lib/database/discovered-sessions-db.js');
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(upsertDiscoveredSession({
      jsonlPath: `/fake/list-${i}.jsonl`,
      workspacePath: workspace,
      workspaceHash: `hash${i}`,
      messageCount: 5,
      firstTs: '2025-01-01T00:00:00Z',
      lastTs: '2025-01-01T01:00:00Z',
      modelsUsed: ['claude-sonnet-4-6'],
      primaryModel: 'claude-sonnet-4-6',
      tokenInput: 100,
      tokenOutput: 200,
      estimatedCost: 0.01,
      toolsUsed: [],
      filesTouched: [],
      panopticonManaged: false,
      panIssueId: null,
      panAgentId: null,
      fileSize: 512,
      fileMtime: '2025-01-01T00:00:00Z',
      tags: [],
    }));
  }
  return results;
}

describe('listAction', () => {
  it('prints "no sessions" when db is empty', async () => {
    const { listAction } = await import('../list.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await listAction({});

    expect(logs.join('')).toContain('No sessions found');
  });

  it('lists seeded sessions in table format by default', async () => {
    await seedSessions(3);
    const { listAction } = await import('../list.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await listAction({});

    const output = logs.join('\n');
    expect(output).toContain('/home/user/Projects/alpha');
  });

  it('filters by workspace option', async () => {
    await seedSessions(2, '/home/user/Projects/alpha');
    await seedSessions(1, '/home/user/Projects/beta');
    const { listAction } = await import('../list.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await listAction({ workspace: '/home/user/Projects/beta' });

    const output = logs.join('\n');
    expect(output).toContain('/home/user/Projects/beta');
    expect(output).not.toContain('/home/user/Projects/alpha');
  });

  it('outputs JSON format when --format json', async () => {
    await seedSessions(2);
    const { listAction } = await import('../list.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await listAction({ format: 'json' });

    const parsed = JSON.parse(logs.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
  });

  it('outputs IDs format when --format ids', async () => {
    await seedSessions(2);
    const { listAction } = await import('../list.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await listAction({ format: 'ids' });

    const output = logs.join('\n');
    // ids format prints numeric IDs
    expect(output.trim()).toMatch(/^\d+/);
  });

  it('respects --limit option', async () => {
    await seedSessions(5);
    const { listAction } = await import('../list.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await listAction({ format: 'json', limit: '2' });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.length).toBe(2);
  });
});
