import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { CostWriter, CostWriterLive } from '../cost.js';
import { makeDbLive, CostArchiveLive, EventBusLive, closeOverdeckDatabaseSync } from '../infra.js';
import { packageRoot } from '../../paths.js';
import { openDatabase } from '../../database/driver.js';

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

const MULTI_TURN_CODEX_ROLLOUT = [
  { type: 'session_meta', timestamp: '2026-07-06T00:00:00Z', payload: { id: 'thread-codex-reconcile', model_provider: 'openai' } },
  { type: 'turn_context', timestamp: '2026-07-06T00:00:00Z', payload: { turn_id: 't1', model: 'gpt-5.5' } },
  { type: 'event_msg', timestamp: '2026-07-06T00:00:01Z', payload: { type: 'agent_message', message: 'Turn 1' } },
  { type: 'event_msg', timestamp: '2026-07-06T00:00:02Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, total_tokens: 1250 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, total_tokens: 1250 } } } },
  { type: 'event_msg', timestamp: '2026-07-06T00:00:03Z', payload: { type: 'agent_message', message: 'Turn 2' } },
  { type: 'event_msg', timestamp: '2026-07-06T00:00:04Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, cached_input_tokens: 250, output_tokens: 100, total_tokens: 1450 }, last_token_usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 50, total_tokens: 200 } } } },
];

describe('CostWriter.reconcile({ source: "codex" }) (PAN-2388)', () => {
  let originalOverdeckHome: string | undefined;
  let tempHome: string;
  let tempDb: string;

  beforeEach(() => {
    originalOverdeckHome = process.env.OVERDECK_HOME;
    tempHome = mkdtempSync(join(tmpdir(), 'pan-codex-reconcile-'));
    tempDb = join(tempHome, 'overdeck.db');
    process.env.OVERDECK_HOME = tempHome;

    // Initialize the Overdeck DB schema so CostWriter.record can insert.
    initOverdeckSchema(tempDb);

    // Create a codex agent session fixture.
    const agentDir = join(tempHome, 'agents', 'agent-pan-test');
    const sessionsDir = join(agentDir, 'codex-home', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, 'rollout.jsonl'),
      MULTI_TURN_CODEX_ROLLOUT.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf-8',
    );
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    closeOverdeckDatabaseSync();
    rmSync(tempHome, { recursive: true, force: true });
  });

  function runReconcile() {
    return Effect.runPromise(
      CostWriter.use((writer) => writer.reconcile({ source: 'codex' })).pipe(
        Effect.provide(CostWriterLive),
        Effect.provide(EventBusLive),
        Effect.provide(CostArchiveLive),
        Effect.provide(makeDbLive(tempDb)),
      ),
    );
  }

  function countCodexEvents(): number {
    const db = openDatabase(tempDb);
    try {
      const rows = db.prepare("SELECT id FROM cost_events WHERE session_type = 'codex'").all();
      return (rows as unknown[]).length;
    } finally {
      db.close();
    }
  }

  function getCodexEventRequestIds(): string[] {
    const db = openDatabase(tempDb);
    try {
      const rows = db.prepare("SELECT request_id FROM cost_events WHERE session_type = 'codex'").all();
      return (rows as Array<{ request_id: string }>).map((r) => r.request_id);
    } finally {
      db.close();
    }
  }

  it('imports per-turn codex events with non-null requestIds on first reconcile', async () => {
    const result = await runReconcile();
    expect(result.imported).toBe(2);

    const requestIds = getCodexEventRequestIds();
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toMatch(/^codex:thread-codex-reconcile:/);
    expect(requestIds.every((id) => id !== null && id !== '')).toBe(true);
  });

  it('imports only the new turn when the session file grows', async () => {
    const first = await runReconcile();
    expect(first.imported).toBe(2);

    const extraTurn = [
      { type: 'event_msg', timestamp: '2026-07-06T00:00:05Z', payload: { type: 'agent_message', message: 'Turn 3' } },
      { type: 'event_msg', timestamp: '2026-07-06T00:00:06Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1500, cached_input_tokens: 300, output_tokens: 150, total_tokens: 1700 }, last_token_usage: { input_tokens: 300, cached_input_tokens: 50, output_tokens: 50, total_tokens: 350 } } } },
    ];
    const sessionsDir = join(tempHome, 'agents', 'agent-pan-test', 'codex-home', 'sessions');
    const file = join(sessionsDir, 'rollout.jsonl');
    const existing = MULTI_TURN_CODEX_ROLLOUT.map((l) => JSON.stringify(l)).join('\n') + '\n';
    writeFileSync(file, existing + extraTurn.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');

    const second = await runReconcile();
    expect(second.imported).toBe(1);

    const totalEvents = countCodexEvents();
    expect(totalEvents).toBe(3);
  });
});
