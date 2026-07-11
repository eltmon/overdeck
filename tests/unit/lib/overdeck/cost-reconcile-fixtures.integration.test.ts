import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';

import { CostArchiveLive, EventBusLive, makeDbLive, getOverdeckDatabaseSync, closeOverdeckDatabaseSync } from '../../../../src/lib/overdeck/infra.js';
import { CostResolver, CostResolverLive, CostWriter, CostWriterLive } from '../../../../src/lib/overdeck/cost.js';
import type { IssueId } from '../../../../src/lib/overdeck/issues.js';

const FIXTURES = join(__dirname, '../../../../src/lib/cost-parsers/__tests__/fixtures');
const ISSUE_ID = 'PAN-9999' as IssueId;

describe('CostWriter.reconcile fixture-backed readback', () => {
  let previousHome: string | undefined;
  let tempHome: string | undefined;

  afterEach(() => {
    closeOverdeckDatabaseSync();
    if (tempHome) rmSync(tempHome, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    tempHome = undefined;
  });

  it('reconciles real codex and ohmypi fixtures into issue cost detail idempotently', async () => {
    previousHome = process.env.OVERDECK_HOME;
    tempHome = mkdtempSync(join(tmpdir(), 'pan-2388-cost-reconcile-'));
    process.env.OVERDECK_HOME = tempHome;

    const codexDir = join(tempHome, 'agents', 'agent-pan-9999-slot-1', 'codex-home', 'sessions', '2026', '05', '31');
    const ohmypiDir = join(tempHome, 'agents', 'agent-pan-9999', 'sessions');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(ohmypiDir, { recursive: true });
    copyFileSync(
      join(FIXTURES, 'codex', 'rollout-nested-multi-turn.jsonl'),
      join(codexDir, 'rollout-2026-05-31T03-31-14-019e7cf1-b148-7a80-80a4-2b891cb13d4c.jsonl'),
    );
    copyFileSync(
      join(FIXTURES, 'ohmypi', 'openai-codex-gpt-5.5.jsonl'),
      join(ohmypiDir, '2026-06-27T14-43-13-805Z_019f0988-e30d-7000-b11c-23c3826c54ab.jsonl'),
    );

    const dbPath = join(tempHome, 'overdeck.db');
    getOverdeckDatabaseSync(dbPath);
    closeOverdeckDatabaseSync();

    const dbLayer = makeDbLive(dbPath);
    const layer = Layer.mergeAll(CostWriterLive, CostResolverLive).pipe(
      Layer.provide(Layer.mergeAll(
        dbLayer,
        EventBusLive.pipe(Layer.provide(dbLayer)),
        CostArchiveLive,
      )),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* CostWriter;
        const resolver = yield* CostResolver;

        const firstCodex = yield* writer.reconcile({ source: 'codex' });
        const firstOhmypi = yield* writer.reconcile({ source: 'ohmypi' });
        const detail = yield* resolver.issueDetail(ISSUE_ID);
        const recent = yield* resolver.recent(20);

        const secondCodex = yield* writer.reconcile({ source: 'codex' });
        const secondOhmypi = yield* writer.reconcile({ source: 'ohmypi' });
        const afterSecond = yield* resolver.recent(20);

        return { firstCodex, firstOhmypi, detail, recent, secondCodex, secondOhmypi, afterSecond };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.firstCodex.imported).toBe(2);
    expect(result.firstCodex.skipped).toHaveLength(0);
    expect(result.firstOhmypi.imported).toBe(1);
    expect(result.firstOhmypi.skipped).toHaveLength(0);

    expect(result.detail.issueId).toBe(ISSUE_ID);
    expect(result.detail.totalCost).toBeGreaterThan(0);
    expect(result.detail.byStage.codex?.['gpt-5.5']).toMatchObject({
      input: 60198,
      output: 96,
      cacheRead: 37120,
      cacheWrite: 0,
    });
    expect(result.detail.byStage.ohmypi?.['gpt-5.5']).toMatchObject({
      input: 42853,
      output: 125,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(result.detail.byModel['gpt-5.5']?.cost).toBeGreaterThan(0);
    expect(result.recent.some((event) =>
      event.issueId === ISSUE_ID &&
      event.sessionType === 'codex' &&
      event.provider === 'openai' &&
      event.model === 'gpt-5.5' &&
      event.cost > 0
    )).toBe(true);
    expect(result.recent.some((event) =>
      event.issueId === ISSUE_ID &&
      event.sessionType === 'ohmypi' &&
      event.provider === 'openai-codex' &&
      event.model === 'gpt-5.5' &&
      event.cost > 0
    )).toBe(true);

    expect(result.secondCodex.imported).toBe(0);
    expect(result.secondCodex.skipped).toHaveLength(0);
    expect(result.secondOhmypi.imported).toBe(0);
    expect(result.secondOhmypi.skipped).toHaveLength(0);
    expect(result.afterSecond).toHaveLength(result.recent.length);
  });
});
