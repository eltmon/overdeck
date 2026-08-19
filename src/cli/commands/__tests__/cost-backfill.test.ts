import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalHome = process.env.HOME;
const originalOverdeckHome = process.env.OVERDECK_HOME;
const originalCodexHome = process.env.CODEX_HOME;

function makeFixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'pan-cost-backfill-'));
  const overdeckHome = join(home, '.overdeck');
  const costsDir = join(overdeckHome, 'costs');
  mkdirSync(join(costsDir, 'state'), { recursive: true });
  writeFileSync(join(costsDir, 'events.jsonl'), '{"existing":true}\n');
  writeFileSync(join(costsDir, 'state', 'session.offset'), '42');

  const projectDir = join(home, '.claude', 'projects', '-home-eltmon-Projects-overdeck-workspaces-feature-pan-2389');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, '11111111-1111-4111-8111-111111111111.jsonl'),
    JSON.stringify({
      type: 'assistant',
      requestId: 'req-pan-2389-backfill-1',
      timestamp: '2026-06-17T12:34:56Z',
      message: {
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
        },
      },
    }) + '\n',
  );
  return home;
}

function snapshotLegacyCostFiles(home: string): Record<string, string> {
  const costsDir = join(home, '.overdeck', 'costs');
  const stateDir = join(costsDir, 'state');
  const snapshot: Record<string, string> = {
    'events.jsonl': readFileSync(join(costsDir, 'events.jsonl'), 'utf8'),
  };
  for (const name of readdirSync(stateDir).sort()) {
    snapshot[`state/${name}`] = readFileSync(join(stateDir, name), 'utf8');
  }
  return snapshot;
}

async function loadBackfill(home: string) {
  vi.resetModules();
  process.env.HOME = home;
  process.env.OVERDECK_HOME = join(home, '.overdeck');
  process.env.CODEX_HOME = join(home, '.codex');
  const infra = await import('../../../lib/overdeck/infra.js');
  const cost = await import('../cost.js');
  infra.getOverdeckDatabaseSync();
  return { ...cost, closeOverdeckDatabaseSync: infra.closeOverdeckDatabaseSync };
}

describe('pan cost backfill', () => {
  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    vi.restoreAllMocks();
  });

  it('dry-run reports would-import counts without touching legacy cost files', async () => {
    const home = makeFixtureHome();
    const before = snapshotLegacyCostFiles(home);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const { runCostBackfill, closeOverdeckDatabaseSync } = await loadBackfill(home);
      const summaries = await runCostBackfill();
      closeOverdeckDatabaseSync();

      expect(summaries[0]).toMatchObject({
        source: 'claude',
        sessionsScanned: 1,
        eventsImported: 1,
        duplicatesSkipped: 0,
        errors: 0,
        earliestEventTs: '2026-06-17T12:34:56.000Z',
        latestEventTs: '2026-06-17T12:34:56.000Z',
      });
      expect(log.mock.calls.flat().join('\n')).toContain('Would import');
      expect(snapshotLegacyCostFiles(home)).toEqual(before);
      expect(existsSync(join(home, '.overdeck', 'costs', 'state', 'session.offset'))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('--write imports a synthetic Claude event once and cache-skips it on rerun', async () => {
    const home = makeFixtureHome();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const { runCostBackfill, closeOverdeckDatabaseSync } = await loadBackfill(home);
      const infra = await import('../../../lib/overdeck/infra.js');
      const first = await runCostBackfill({ write: true });
      const second = await runCostBackfill({ write: true });
      const rows = infra.getOverdeckDatabaseSync()
        .prepare('SELECT request_id, issue_id, model FROM cost_events ORDER BY id')
        .all() as Array<{ request_id: string; issue_id: string; model: string }>;
      closeOverdeckDatabaseSync();

      expect(first[0]).toMatchObject({
        source: 'claude',
        eventsImported: 1,
        duplicatesSkipped: 0,
      });
      expect(second[0]).toMatchObject({
        source: 'claude',
        eventsImported: 0,
        duplicatesSkipped: 0,
        cacheSkipped: 1,
      });
      expect(rows).toEqual([
        {
          request_id: 'req-pan-2389-backfill-1',
          issue_id: 'PAN-2389',
          model: 'claude-sonnet-4-6',
        },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
