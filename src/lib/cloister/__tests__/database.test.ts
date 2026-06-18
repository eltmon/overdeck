import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testHome: string;

beforeEach(() => {
  vi.resetModules();
  testHome = join(tmpdir(), `pan-1579-cloister-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const database = await import('../database.js');
  database.closeHealthDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('cloister health database', () => {
  it('rolls back a batch insert when one event fails inside the transaction', async () => {
    const database = await import('../database.js');

    expect(() =>
      database.writeHealthEventsSync([
        {
          agentId: 'agent-1',
          timestamp: '2026-06-04T08:00:00.000Z',
          state: 'active',
          source: 'test',
          metadata: JSON.stringify({ ok: true }),
        },
        {
          agentId: 'agent-1',
          timestamp: '2026-06-04T08:01:00.000Z',
          state: 'warning',
          source: 'test',
          metadata: true as never,
        },
      ]),
    ).toThrow('SQLite boolean bind values are not supported');

    expect(database.getDatabaseStatsSync().totalEvents).toBe(0);
  });
});
