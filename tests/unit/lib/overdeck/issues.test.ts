import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';

import { createOverdeckDatabase } from '../../../../scripts/create-overdeck-db.js';
import { openDatabase } from '../../../../src/lib/database/driver.js';
import {
  Db,
  EventBusLive,
  makeDbLive,
  Records,
  type RecordsServiceShape,
} from '../../../../src/lib/overdeck/infra.js';
import {
  IssueWriter,
  IssuesResolver,
  IssuesResolverLive,
  makeIssueWriterLive,
  overdeckIssues,
  type IssueId,
} from '../../../../src/lib/overdeck/issues.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
import type { ProjectConfig } from '../../../../src/lib/projects.js';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-issues-'));
  tempDirs.push(dir);
  return dir;
}

function makeDbPath(): string {
  const dbPath = join(makeTempDir(), 'overdeck.db');
  createOverdeckDatabase({ dbPath });
  return dbPath;
}

function fakeRecordsLayer(service: RecordsServiceShape): Layer.Layer<Records> {
  return Layer.succeed(Records, Records.of(service));
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('overdeck Issues vertical slice', () => {
  it('advances source-first and resolves the updated stage', async () => {
    const dbPath = makeDbPath();
    const raw = openDatabase(dbPath);
    raw.prepare(`
      INSERT INTO issues (
        id,
        stage,
        review_outcome,
        test_outcome,
        verification_outcome,
        blockers,
        updated_at
      )
      VALUES ('PAN-1938', 'todo', 'pending', 'pending', 'pending', '[]', 0)
    `).run();

    const order: string[] = [];
    const recordsLayer = fakeRecordsLayer({
      writeIssue: (_project: ProjectConfig, _issueId: string, record: PanIssueRecord) =>
        Effect.sync(() => {
          const row = raw.prepare('SELECT stage FROM issues WHERE id = ?').get<{ stage: string }>('PAN-1938');
          order.push(`records-before-cache:${row?.stage}:${record.pipeline.reviewStatus}`);
          return join(makeTempDir(), 'pan-1938.json');
        }),
      readIssue: () => Effect.succeed(null),
      readSpec: () => Effect.succeed(null),
    });

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const db = yield* Db;
          yield* Effect.promise(() =>
            db.q.insert(overdeckIssues).values({
              id: 'PAN-999',
              stage: 'todo',
              reviewOutcome: 'pending',
              testOutcome: 'pending',
              verificationOutcome: 'pending',
              blockers: [],
              updatedAt: new Date(0),
            }).run(),
          );

          const writer = yield* IssueWriter;
          const advanced = yield* writer.advance('PAN-1938' as IssueId, 'planning', 'start planning');
          const resolver = yield* IssuesResolver;
          const resolved = yield* resolver.get('PAN-1938' as IssueId);
          return { advanced, resolved, writer };
        }).pipe(
          Effect.provide(makeIssueWriterLive({ name: 'test', path: makeTempDir(), issue_prefix: 'PAN' })),
          Effect.provide(IssuesResolverLive),
          Effect.provide(EventBusLive),
          Effect.provide(recordsLayer),
          Effect.provide(makeDbLive(dbPath)),
        ),
      );

      expect(order).toEqual(['records-before-cache:todo:pending']);
      expect(result.advanced.stage).toBe('planning');
      expect(result.resolved.stage).toBe('planning');
      expect(Object.keys(result.writer).sort()).toEqual(['advance', 'setBlockers', 'setPr']);
      expect('hold' in result.writer).toBe(false);
    } finally {
      raw.close();
    }
  });

  it('keeps skipped tests in the derived ready-for-merge list', async () => {
    const dbPath = makeDbPath();
    const recordsLayer = fakeRecordsLayer({
      writeIssue: () => Effect.succeed(join(makeTempDir(), 'unused.json')),
      readIssue: () => Effect.succeed(null),
      readSpec: () => Effect.succeed(null),
    });

    const readyIds = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* Db;
        yield* Effect.promise(() =>
          db.q.insert(overdeckIssues).values({
            id: 'PAN-READY',
            stage: 'testing',
            reviewOutcome: 'passed',
            testOutcome: 'skipped',
            verificationOutcome: 'pending',
            blockers: [],
            updatedAt: new Date(0),
          }).run(),
        );
        const resolver = yield* IssuesResolver;
        const ready = yield* resolver.list({ readyForMerge: true });
        return ready.map((issue) => issue.id);
      }).pipe(
        Effect.provide(IssuesResolverLive),
        Effect.provide(recordsLayer),
        Effect.provide(makeDbLive(dbPath)),
      ),
    );

    expect(readyIds).toEqual(['PAN-READY']);
  });
});
