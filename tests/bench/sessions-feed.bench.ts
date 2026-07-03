import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-sessions-feed-bench-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../src/lib/overdeck/infra.js');
  const { resetDiscoveredSessionsSchemaBootstrap } = await import('../../src/lib/overdeck/discovered-sessions.js');
  closeOverdeckDatabaseSync();
  resetDiscoveredSessionsSchemaBootstrap();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('sessions feed bench', () => {
  it('returns a 50-row page under 100 ms against 10,000 sessions', async () => {
    const { upsertDiscoveredSession } = await import('../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    for (let i = 0; i < 10_000; i += 1) {
      upsertDiscoveredSession({
        jsonlPath: `/tmp/bench-${i}.jsonl`,
        sessionId: `bench-${i}`,
        workspacePath: `/workspace/${i % 25}`,
        primaryModel: i % 2 === 0 ? 'model-a' : 'model-b',
        messageCount: i % 100,
        estimatedCost: (i % 1_000) / 100,
        tags: [`tag-${i % 10}`],
        toolsUsed: [`Tool${i % 8}`],
        filesTouched: [`/repo/file-${i % 50}.ts`],
        lastTs: new Date(base - i * 1_000).toISOString(),
        firstTs: new Date(base - i * 1_000 - 500).toISOString(),
      });
    }

    const started = performance.now();
    const page = listSessionsFeed({ limit: 50 });
    const elapsed = performance.now() - started;

    expect(page.rows).toHaveLength(50);
    expect(elapsed).toBeLessThan(100);
  }, 30_000);
});
