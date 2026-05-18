/**
 * Regression tests for `pan conversations show` (PAN-457).
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
  TEST_HOME = join(tmpdir(), `show-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function seedSession() {
  const { upsertDiscoveredSession } = await import('../../../../lib/database/discovered-sessions-db.js');
  return upsertDiscoveredSession({
    jsonlPath: '/fake/show-test.jsonl',
    workspacePath: '/home/user/Projects/myapp',
    workspaceHash: 'abc123',
    messageCount: 10,
    firstTs: '2025-01-01T00:00:00Z',
    lastTs: '2025-01-01T01:00:00Z',
    modelsUsed: ['claude-sonnet-4-6'],
    primaryModel: 'claude-sonnet-4-6',
    tokenInput: 500,
    tokenOutput: 1000,
    estimatedCost: 0.05,
    toolsUsed: ['Read', 'Write'],
    filesTouched: [],
    panopticonManaged: false,
    panIssueId: null,
    panAgentId: null,
    fileSize: 2048,
    fileMtime: '2025-01-01T00:00:00Z',
    tags: ['feat'],
  });
}

describe('showAction', () => {
  it('exits 1 for non-numeric id', async () => {
    const { showAction } = await import('../show.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(showAction('notanumber', {})).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 for session not found', async () => {
    const { showAction } = await import('../show.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(showAction('9999', {})).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('outputs JSON when --json flag set', async () => {
    const session = await seedSession();
    const { showAction } = await import('../show.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));

    await showAction(String(session.id), { json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.id).toBe(session.id);
    expect(parsed.jsonlPath).toBe('/fake/show-test.jsonl');
  });

  it('outputs human-readable detail by default', async () => {
    const session = await seedSession();
    const { showAction } = await import('../show.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await showAction(String(session.id), {});

    const output = logs.join('\n');
    expect(output).toContain(String(session.id));
    expect(output).toContain('/fake/show-test.jsonl');
  });
});
