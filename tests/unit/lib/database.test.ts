/**
 * Tests for unified panopticon.db foundation
 *
 * Each describe block runs in isolation via vi.mock to avoid singleton issues.
 * Tests use unique IDs to avoid cross-test interference within a block.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, type SqliteDatabase } from '../../../src/lib/database/driver.js';
import { initSchema } from '../../../src/lib/database/schema.js';
import type { CostEvent } from '../../../src/lib/costs/events.js';

// ============== In-memory DB helper ==============
// We test the logic directly using in-memory DBs to avoid singleton issues

function createTestDb(): SqliteDatabase {
  const db = openDatabase(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

// ============== Schema Tests ==============

describe('Database schema', () => {
  it('creates all expected tables', () => {
    const db = createTestDb();
    const tables = (db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all() as Array<{ name: string }>).map(r => r.name);

    expect(tables).toContain('cost_events');
    expect(tables).toContain('review_status');
    expect(tables).toContain('status_history');
    expect(tables).toContain('health_events');
    expect(tables).toContain('processed_sessions');
    db.close();
  });

  it('sets schema version after init', () => {
    const db = createTestDb();
    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBeGreaterThan(0);
    db.close();
  });

  it('cost_events has UNIQUE index on request_id', () => {
    const db = createTestDb();
    const ts = new Date().toISOString();

    db.prepare(`
      INSERT INTO cost_events (ts, agent_id, issue_id, session_type, provider, model,
        input, output, cache_read, cache_write, cost, request_id)
      VALUES (?, 'agent-1', 'PAN-1', 'impl', 'anthropic', 'claude-s', 100, 50, 0, 0, 0.01, 'req-1')
    `).run(ts);

    // Second insert with same request_id should be ignored (OR IGNORE)
    const result = db.prepare(`
      INSERT OR IGNORE INTO cost_events (ts, agent_id, issue_id, session_type, provider, model,
        input, output, cache_read, cache_write, cost, request_id)
      VALUES (?, 'agent-1', 'PAN-1', 'impl', 'anthropic', 'claude-s', 100, 50, 0, 0, 0.01, 'req-1')
    `).run(ts);

    expect(result.changes).toBe(0);
    db.close();
  });

  it('idempotent — second initSchema call does not fail', () => {
    const db = createTestDb();
    expect(() => initSchema(db)).not.toThrow();
    db.close();
  });
});

// ============== Review Status Logic Tests ==============

describe('review_status table', () => {
  let db: SqliteDatabase;
  beforeAll(() => { db = createTestDb(); });
  afterAll(() => db.close());

  function upsert(issueId: string, reviewStatus = 'pending', testStatus = 'pending', readyForMerge = 0) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        review_status = excluded.review_status,
        test_status = excluded.test_status,
        updated_at = excluded.updated_at,
        ready_for_merge = excluded.ready_for_merge
    `).run(issueId, reviewStatus, testStatus, now, readyForMerge);
  }

  it('inserts and retrieves a review status', () => {
    upsert('PAN-RS-100');
    const row = db.prepare('SELECT * FROM review_status WHERE issue_id = ?').get('PAN-RS-100') as any;
    expect(row).toBeTruthy();
    expect(row.review_status).toBe('pending');
  });

  it('updates on conflict', () => {
    upsert('PAN-RS-101', 'pending');
    upsert('PAN-RS-101', 'passed', 'passed', 1);
    const row = db.prepare('SELECT * FROM review_status WHERE issue_id = ?').get('PAN-RS-101') as any;
    expect(row.review_status).toBe('passed');
    expect(row.ready_for_merge).toBe(1);
  });

  it('stores history entries', () => {
    const now = new Date().toISOString();
    upsert('PAN-RS-102');
    db.prepare(`
      INSERT INTO status_history (issue_id, type, status, timestamp, notes)
      VALUES (?, 'review', 'reviewing', ?, 'Started')
    `).run('PAN-RS-102', now);
    db.prepare(`
      INSERT INTO status_history (issue_id, type, status, timestamp)
      VALUES (?, 'review', 'passed', ?)
    `).run('PAN-RS-102', now);

    const rows = db.prepare('SELECT * FROM status_history WHERE issue_id = ?').all('PAN-RS-102') as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe('Started');
  });

  it('deletes cascades to history', () => {
    const now = new Date().toISOString();
    upsert('PAN-RS-103');
    db.prepare(`INSERT INTO status_history (issue_id, type, status, timestamp) VALUES (?, 'review', 'pending', ?)`).run('PAN-RS-103', now);

    db.prepare('DELETE FROM review_status WHERE issue_id = ?').run('PAN-RS-103');
    const history = db.prepare('SELECT * FROM status_history WHERE issue_id = ?').all('PAN-RS-103');
    expect(history).toHaveLength(0);
  });
});

// ============== Cost Events Logic Tests ==============

describe('cost_events table', () => {
  let db: SqliteDatabase;
  beforeAll(() => { db = createTestDb(); });
  afterAll(() => db.close());

  function insertEvent(overrides: Partial<Record<string, any>> = {}) {
    const defaults = {
      ts: new Date().toISOString(),
      agent_id: 'agent-1',
      issue_id: 'PAN-CE-200',
      session_type: 'implementation',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      input: 1000,
      output: 500,
      cache_read: 200,
      cache_write: 100,
      cost: 0.01,
      request_id: `req-${Math.random().toString(36).slice(2)}`,
    };
    const vals = { ...defaults, ...overrides };
    db.prepare(`
      INSERT OR IGNORE INTO cost_events
        (ts, agent_id, issue_id, session_type, provider, model,
         input, output, cache_read, cache_write, cost, request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(vals.ts, vals.agent_id, vals.issue_id, vals.session_type,
           vals.provider, vals.model, vals.input, vals.output,
           vals.cache_read, vals.cache_write, vals.cost, vals.request_id);
    return vals;
  }

  it('inserts a cost event', () => {
    insertEvent({ issue_id: 'PAN-CE-201', request_id: 'r201a' });
    const row = db.prepare(`SELECT * FROM cost_events WHERE issue_id = 'PAN-CE-201'`).get() as any;
    expect(row).toBeTruthy();
    expect(row.model).toBe('claude-sonnet-4');
  });

  it('deduplicates by request_id', () => {
    insertEvent({ issue_id: 'PAN-CE-202', request_id: 'fixed-req' });
    const r2 = db.prepare(`
      INSERT OR IGNORE INTO cost_events
        (ts, agent_id, issue_id, session_type, provider, model,
         input, output, cache_read, cache_write, cost, request_id)
      VALUES (?, 'agent-1', 'PAN-CE-202', 'impl', 'anthropic', 'model', 1, 1, 0, 0, 0.001, 'fixed-req')
    `).run(new Date().toISOString());
    expect(r2.changes).toBe(0);
  });

  it('aggregates costs by issue', () => {
    insertEvent({ issue_id: 'PAN-CE-203', cost: 0.01, request_id: 'a1' });
    insertEvent({ issue_id: 'PAN-CE-203', cost: 0.02, request_id: 'a2' });

    const row = db.prepare(`
      SELECT UPPER(issue_id) as iid, SUM(cost) as total
      FROM cost_events
      WHERE UPPER(issue_id) = 'PAN-CE-203'
      GROUP BY UPPER(issue_id)
    `).get() as any;

    expect(row.total).toBeCloseTo(0.03);
  });

  it('groups by model', () => {
    insertEvent({ model: 'opus', cost: 0.05, request_id: 'model-1' });
    insertEvent({ model: 'haiku', cost: 0.01, request_id: 'model-2' });

    const rows = db.prepare(`
      SELECT model, SUM(cost) as cost FROM cost_events GROUP BY model
    `).all() as any[];

    const models = rows.map(r => r.model);
    expect(models).toContain('opus');
    expect(models).toContain('haiku');
  });

  it('groups by agent (developer)', () => {
    insertEvent({ agent_id: 'dev-alice', cost: 0.05, request_id: 'dev-1' });
    insertEvent({ agent_id: 'dev-bob', cost: 0.03, request_id: 'dev-2' });

    const rows = db.prepare(`
      SELECT agent_id, SUM(cost) as total FROM cost_events GROUP BY agent_id ORDER BY total DESC
    `).all() as any[];

    const ids = rows.map(r => r.agent_id);
    expect(ids).toContain('dev-alice');
    expect(ids).toContain('dev-bob');
    expect(rows[0].total).toBeGreaterThanOrEqual(rows[1].total);
  });

  it('daily trend groups by DATE(ts)', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEvent({ ts: `${today}T10:00:00Z`, cost: 0.03, request_id: 'trend-1' });
    insertEvent({ ts: `${today}T11:00:00Z`, cost: 0.04, request_id: 'trend-2' });

    const rows = db.prepare(`
      SELECT DATE(ts) as date, SUM(cost) as total FROM cost_events
      WHERE ts >= ? GROUP BY DATE(ts)
    `).all(today) as any[];

    const todayRow = rows.find(r => r.date === today);
    expect(todayRow).toBeTruthy();
    expect(todayRow.total).toBeGreaterThan(0);
  });
});

// ============== Health Events Logic Tests ==============

describe('health_events table', () => {
  let db: SqliteDatabase;
  beforeAll(() => { db = createTestDb(); });
  afterAll(() => db.close());

  it('inserts and retrieves a health event', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO health_events (agent_id, timestamp, state)
      VALUES ('agent-h1', ?, 'active')
    `).run(now);

    const row = db.prepare(`SELECT * FROM health_events WHERE agent_id = 'agent-h1'`).get() as any;
    expect(row).toBeTruthy();
    expect(row.state).toBe('active');
  });

  it('retrieves most recent event via ORDER BY timestamp DESC', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const t2 = '2026-01-01T11:00:00Z';
    db.prepare(`INSERT INTO health_events (agent_id, timestamp, state) VALUES ('agent-h2', ?, 'idle')`).run(t1);
    db.prepare(`INSERT INTO health_events (agent_id, timestamp, state) VALUES ('agent-h2', ?, 'active')`).run(t2);

    const latest = db.prepare(`
      SELECT * FROM health_events WHERE agent_id = 'agent-h2'
      ORDER BY timestamp DESC LIMIT 1
    `).get() as any;
    expect(latest.state).toBe('active');
  });

  it('deletes old events', () => {
    const old = '2020-01-01T00:00:00Z';
    db.prepare(`INSERT INTO health_events (agent_id, timestamp, state) VALUES ('agent-old', ?, 'idle')`).run(old);

    const result = db.prepare(`DELETE FROM health_events WHERE timestamp < '2021-01-01'`).run();
    expect(result.changes).toBeGreaterThan(0);
  });
});

// ============== WAL file parsing ==============

describe('WAL file import', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = join(tmpdir(), `pan-wal-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('parses valid JSONL lines', () => {
    const walFile = join(tmpDir, 'PAN-WAL-1.jsonl');
    const event: CostEvent = {
      ts: new Date().toISOString(),
      type: 'cost',
      agentId: 'agent-1',
      issueId: 'PAN-WAL-1',
      sessionType: 'implementation',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      input: 100, output: 50, cacheRead: 0, cacheWrite: 0,
      cost: 0.001,
      requestId: 'wal-parse-test-1',
    };

    writeFileSync(walFile, JSON.stringify(event) + '\n', 'utf-8');

    // Read and parse manually (mirrors syncWalFromDir logic)
    const content = require('fs').readFileSync(walFile, 'utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as CostEvent;
    expect(parsed.issueId).toBe('PAN-WAL-1');
    expect(parsed.requestId).toBe('wal-parse-test-1');
  });

  it('skips malformed lines', () => {
    const walFile = join(tmpDir, 'PAN-WAL-2.jsonl');
    const goodLine = JSON.stringify({
      ts: new Date().toISOString(), type: 'cost', agentId: 'a', issueId: 'PAN-WAL-2',
      sessionType: 'impl', provider: 'anthropic', model: 'm', input: 1, output: 1,
      cacheRead: 0, cacheWrite: 0, cost: 0.001, requestId: 'wal-parse-test-2',
    });
    writeFileSync(walFile, `NOT_JSON\n${goodLine}\n{broken\n`, 'utf-8');

    const content = require('fs').readFileSync(walFile, 'utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim());
    const valid = lines.filter((l: string) => {
      try { JSON.parse(l); return true; } catch { return false; }
    });
    expect(valid).toHaveLength(1);
  });
});
