import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';

import {
  CostResolver,
  CostResolverLive,
  CostWriter,
  CostWriterLive,
} from '../cost.js';
import {
  makeDbLive,
  CostArchiveLive,
  EventBusLive,
  closeOverdeckDatabaseSync,
} from '../infra.js';
import { openDatabase } from '../../database/driver.js';
import { packageRoot } from '../../paths.js';
import type { IssueId } from '../issues.js';

const ISSUE_ID = 'PAN-9999' as IssueId;
const FIXTURE_ROOT = join(packageRoot, 'src/lib/cost-parsers/__tests__/fixtures');
const CODEX_FIXTURE = join(FIXTURE_ROOT, 'codex/rollout-nested-multi-turn.jsonl');
const OHMYPI_FIXTURE = join(FIXTURE_ROOT, 'ohmypi/openai-codex.jsonl');

function initOverdeckSchema(dbPath: string): void {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = openDatabase(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  const migration = readFileSync(join(packageRoot, 'drizzle', 'overdeck', '0000_overdeck_init.sql'), 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
  db.exec('CREATE INDEX IF NOT EXISTS `cost_session_id_idx` ON `cost_events` (`session_id`)');
  db.close();
}

function writeFixture(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(source, 'utf8'), 'utf8');
}

describe('cost reconcile multi-harness integration (PAN-2388)', () => {
  let originalOverdeckHome: string | undefined;
  let tempHome: string;
  let tempDb: string;

  beforeEach(() => {
    originalOverdeckHome = process.env.OVERDECK_HOME;
    tempHome = mkdtempSync(join(tmpdir(), 'pan-cost-harnesses-'));
    tempDb = join(tempHome, 'overdeck.db');
    process.env.OVERDECK_HOME = tempHome;
    initOverdeckSchema(tempDb);

    writeFixture(
      CODEX_FIXTURE,
      join(
        tempHome,
        'agents',
        'agent-pan-9999-slot-1',
        'codex-home',
        'sessions',
        '2026',
        '05',
        '31',
        'rollout.jsonl',
      ),
    );
    writeFixture(
      OHMYPI_FIXTURE,
      join(tempHome, 'agents', 'agent-pan-9999', 'sessions', 'openai-codex.jsonl'),
    );
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    closeOverdeckDatabaseSync();
    rmSync(tempHome, { recursive: true, force: true });
  });

  function runReconcile(source: 'codex' | 'ohmypi') {
    return Effect.runPromise(
      CostWriter.use((writer) => writer.reconcile({ source })).pipe(
        Effect.provide(CostWriterLive),
        Effect.provide(EventBusLive),
        Effect.provide(CostArchiveLive),
        Effect.provide(makeDbLive(tempDb)),
      ),
    );
  }

  function readIssue() {
    return Effect.runPromise(
      CostResolver.use((resolver) =>
        Effect.all({
          byIssue: resolver.byIssue(),
          detail: resolver.issueDetail(ISSUE_ID),
          recent: resolver.recent(20),
        }),
      ).pipe(
        Effect.provide(CostResolverLive),
        Effect.provide(makeDbLive(tempDb)),
      ),
    );
  }

  it('reads non-zero codex and ohmypi spend for one issue and remains idempotent', async () => {
    const codexFirst = await runReconcile('codex');
    const ohmypiFirst = await runReconcile('ohmypi');

    expect(codexFirst.imported).toBeGreaterThan(0);
    expect(ohmypiFirst.imported).toBeGreaterThan(0);

    const readBack = await readIssue();
    const issueRollup = readBack.byIssue.find((rollup) => rollup.key === ISSUE_ID);
    expect(issueRollup?.cost).toBeGreaterThan(0);

    expect(readBack.detail.totalCost).toBeGreaterThan(0);
    expect(readBack.detail.byStage.codex?.['gpt-5.5']).toMatchObject({
      input: expect.any(Number),
      output: expect.any(Number),
      cacheRead: expect.any(Number),
      cacheWrite: 0,
    });
    expect(readBack.detail.byStage.ohmypi?.['gpt-5.5']).toMatchObject({
      input: 42853,
      output: 125,
      cacheRead: 0,
      cacheWrite: 0,
    });

    const codexEvent = readBack.recent.find((event) => event.sessionType === 'codex');
    const ohmypiEvent = readBack.recent.find((event) => event.sessionType === 'ohmypi');
    expect(codexEvent).toMatchObject({
      issueId: ISSUE_ID,
      provider: 'openai',
      model: 'gpt-5.5',
    });
    expect(codexEvent?.cost).toBeGreaterThan(0);
    expect(ohmypiEvent).toMatchObject({
      issueId: ISSUE_ID,
      provider: 'openai-codex',
      model: 'gpt-5.5',
    });
    expect(ohmypiEvent?.cost).toBeGreaterThan(0);

    const codexSecond = await runReconcile('codex');
    const ohmypiSecond = await runReconcile('ohmypi');
    expect(codexSecond.imported).toBe(0);
    expect(ohmypiSecond.imported).toBe(0);
  });
});
