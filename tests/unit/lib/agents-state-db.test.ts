/**
 * Tests for PAN-1908: getAgentState/saveAgentState backed by the agents table.
 * Uses an in-memory SQLite database injected via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../src/lib/database/driver.js';
import { initSchema } from '../../../src/lib/database/schema.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

// ============== In-memory DB + temp PANOPTICON_HOME injection ==============

let testDb: SqliteDatabase;
let tempHome: string;

vi.mock('../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
  tempHome = mkdtempSync('/tmp/pan-agents-state-');
  process.env.PANOPTICON_HOME = tempHome;
});

afterEach(() => {
  testDb.close();
  rmSync(tempHome, { recursive: true, force: true });
  delete process.env.PANOPTICON_HOME;
});

// ============== Imports (after mock is set up) ==============

import {
  getAgentStateSync,
  saveAgentStateSync,
  getAgentState,
  saveAgentState,
  type AgentState,
} from '../../../src/lib/agents.js';
import { existsSync, readFileSync } from 'fs';
import { Effect } from 'effect';

// ============== Helpers ==============

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1908',
    issueId: 'PAN-1908',
    workspace: '/workspaces/feature-pan-1908',
    role: 'work',
    model: 'claude-opus-4-8',
    status: 'running',
    startedAt: '2026-06-15T00:00:00.000Z',
    harness: 'claude-code',
    supervisorEnabled: true,
    deliveryMethod: 'supervisor',
    ...overrides,
  } as AgentState;
}

function agentId(id: string): string {
  // normalizeAgentId prefixes bare ids with "agent-"; tests must use the same
  // canonical id that getAgentStateSync/saveAgentStateSync normalize to.
  return id.startsWith('agent-') ? id : `agent-${id}`;
}

// ============== Tests ==============

describe('agents state SQLite backing', () => {
  it('getAgentStateSync returns a state saved via saveAgentStateSync', () => {
    const id = agentId('roundtrip-1');
    const state = makeAgentState({ id });
    saveAgentStateSync(state);

    const loaded = getAgentStateSync(id);
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(id);
    expect(loaded?.issueId).toBe('PAN-1908');
    expect(loaded?.role).toBe('work');
    expect(loaded?.status).toBe('running');
    expect(loaded?.harness).toBe('claude-code');
    expect(loaded?.model).toBe('claude-opus-4-8');
    expect(loaded?.supervisorEnabled).toBe(true);
    expect(loaded?.deliveryMethod).toBe('supervisor');
  });

  it('getAgentStateSync reads from the agents table, not state.json', () => {
    // Directly insert into the agents table without touching the filesystem.
    const id = agentId('db-only');
    testDb
      .prepare(
        `INSERT INTO agents (id, issue_id, role, status, workspace, model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, 'PAN-1908', 'work', 'running', '/workspaces/feature-pan-1908', 'kimi-k2.7-code', '2026-06-15T00:00:00.000Z');

    const loaded = getAgentStateSync(id);
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(id);
    expect(loaded?.model).toBe('kimi-k2.7-code');
  });

  it('saveAgentStateSync dual-writes state.json as the rollback source', () => {
    const id = agentId('dual-write-1');
    const state = makeAgentState({ id });
    saveAgentStateSync(state);

    const stateFile = join(tempHome, 'agents', id, 'state.json');
    expect(existsSync(stateFile)).toBe(true);

    const disk = JSON.parse(readFileSync(stateFile, 'utf8')) as AgentState;
    expect(disk.id).toBe(id);
    expect(disk.status).toBe('running');
  });

  it('saveAgentStateSync detects status transitions and stamps stoppedAt for stopped agents', () => {
    const id = agentId('stop-test');
    saveAgentStateSync(makeAgentState({ id, status: 'running' }));
    saveAgentStateSync(makeAgentState({ id, status: 'stopped' }));

    const loaded = getAgentStateSync(id);
    expect(loaded?.status).toBe('stopped');
    expect(loaded?.stoppedAt).toBeDefined();
  });

  it('getAgentState returns the same fields back via Effect', async () => {
    const id = agentId('effect-roundtrip');
    const state = makeAgentState({ id });
    await Effect.runPromise(saveAgentState(state));

    const loaded = await Effect.runPromise(getAgentState(id));
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(id);
    expect(loaded?.issueId).toBe('PAN-1908');
    expect(loaded?.status).toBe('running');
  });

  it('falls back to state.json when the agents table has no row', () => {
    const id = agentId('fallback-1');
    const state = makeAgentState({ id });
    saveAgentStateSync(state);

    // Remove the DB row; state.json should still be readable.
    testDb.prepare(`DELETE FROM agents WHERE id = ?`).run(id);

    const loaded = getAgentStateSync(id);
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(id);
  });
});
