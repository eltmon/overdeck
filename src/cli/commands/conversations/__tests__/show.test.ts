/**
 * Regression tests for `pan conversations show` (PAN-457).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../../tests/helpers/overdeck-test-db.js';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.clearAllMocks();
});

async function seedSession() {
  const { upsertDiscoveredSession } = await import('../../../../lib/overdeck/discovered-sessions.js');
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
    overdeckManaged: false,
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
