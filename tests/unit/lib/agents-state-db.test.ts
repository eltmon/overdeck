/**
 * Tests for PAN-1908: getAgentState/saveAgentState backed by the overdeck agents table.
 * PAN-1938: repointed from the old panopticon.db mock to the shared overdeck fixture.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  saveOverdeckAgentStateSync,
  type OverdeckTestDb,
} from '../../helpers/overdeck-test-db.js';

// ============== Overdeck DB fixture + temp PANOPTICON_HOME ==============

let odb: OverdeckTestDb;
let tempHome: string;

vi.mock('../../../src/lib/database/index.js', () => ({
  // panopticon.db is still used for review_status / events; give it a no-op stub
  // so tests that don't touch it don't fail on missing DB files.
  getDatabase: vi.fn(),
}));

beforeEach(() => {
  odb = setupOverdeckTestDb();
  tempHome = odb.home;
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
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
    // Seed via the overdeck writer (the new single source of truth).
    const id = agentId('db-only');
    saveOverdeckAgentStateSync(makeAgentState({ id, model: 'kimi-k2.7-code' }));

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

  it('falls back to state.json when the overdeck table has no row', () => {
    const id = agentId('fallback-1');
    const state = makeAgentState({ id });
    saveAgentStateSync(state);

    // Remove the overdeck row; state.json should still be readable as rollback.
    odb.raw().prepare(`DELETE FROM agents WHERE id = ?`).run(id);

    const loaded = getAgentStateSync(id);
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(id);
  });
});
