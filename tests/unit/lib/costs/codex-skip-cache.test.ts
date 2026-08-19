import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/cost-parsers/codex-parser.js', () => ({
  parseCodexSessionCostEventsSync: vi.fn(),
  parseCodexSessionSync: vi.fn(() => null),
}));

import { parseCodexSessionCostEventsSync } from '../../../../src/lib/cost-parsers/codex-parser.js';
import { CostWriter, CostWriterLive } from '../../../../src/lib/overdeck/cost.js';
import {
  closeOverdeckDatabaseSync,
  CostArchiveLive,
  EventBusLive,
  getOverdeckDatabaseSync,
  makeDbLive,
} from '../../../../src/lib/overdeck/infra.js';

let testHome: string;
let sessionFile: string;

function makeLayer() {
  const dbLayer = makeDbLive(join(testHome, 'overdeck.db'));
  return CostWriterLive.pipe(Layer.provide(Layer.mergeAll(
    dbLayer,
    EventBusLive.pipe(Layer.provide(dbLayer)),
    CostArchiveLive,
  )));
}

function usageEvent() {
  return {
    requestId: 'codex:sess-1:0',
    timestamp: '2026-08-16T10:00:00Z',
    sessionId: 'sess-1',
    provider: 'openai',
    model: 'gpt-5.5',
    input: 10,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.001,
  };
}

async function reconcile() {
  return Effect.runPromise(
    CostWriter.use((writer) => writer.reconcile({ source: 'codex' })).pipe(
      Effect.provide(makeLayer()),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  testHome = mkdtempSync(join(tmpdir(), 'pan-3743-codex-cache-'));
  process.env.OVERDECK_HOME = testHome;
  const sessionDir = join(testHome, 'agents', 'agent-pan-3743', 'codex-home', 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  sessionFile = join(sessionDir, 'rollout.jsonl');
  writeFileSync(sessionFile, '{}\n');
  getOverdeckDatabaseSync();
  closeOverdeckDatabaseSync();
  vi.mocked(parseCodexSessionCostEventsSync).mockReturnValue([usageEvent()]);
});

afterEach(() => {
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('codex reconcile skip cache', () => {
  it('does not parse or emit per-file skip logs for an unchanged cached file', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const first = await reconcile();
    const second = await reconcile();

    expect(first).toMatchObject({ sessionsScanned: 1, cacheSkipped: 0 });
    expect(second).toMatchObject({ sessionsScanned: 1, cacheSkipped: 1 });
    expect(parseCodexSessionCostEventsSync).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[cost-reconcile] skipped'));
  });

  it('re-parses a cached file after its mtime changes', async () => {
    await reconcile();
    const changed = new Date(Date.now() + 10_000);
    utimesSync(sessionFile, changed, changed);

    const result = await reconcile();

    expect(result.cacheSkipped).toBe(0);
    expect(parseCodexSessionCostEventsSync).toHaveBeenCalledTimes(2);
  });

  it('does not cache parse failures', async () => {
    vi.mocked(parseCodexSessionCostEventsSync).mockImplementation(() => {
      throw new Error('broken transcript');
    });

    await reconcile();
    await reconcile();

    expect(parseCodexSessionCostEventsSync).toHaveBeenCalledTimes(2);
  });
});
