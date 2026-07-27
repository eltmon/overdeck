/**
 * Reproduces the cutover crash (PAN-1938): on a fresh empty overdeck.db,
 * backfillAgentsSync reads each ~/.overdeck/agents/<id>/state.json and inserts agents,
 * but agents.issue_id FKs to issues(id) and the issues table is empty → the boot
 * crash-looped on `FOREIGN KEY constraint failed`. The smoke tests missed this
 * because they ran against a throwaway home with NO state.json files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: vi.fn(),
}));

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import { backfillAgentsSync } from '../../../../src/lib/overdeck/agents.js';
import { logAgentLifecycleSync } from '../../../../src/lib/persistent-logger.js';

describe('backfillAgentsSync FK-safety on a fresh overdeck.db (PAN-1938)', () => {
  let odb: OverdeckTestDb;
  beforeEach(() => {
    vi.clearAllMocks();
    odb = setupOverdeckTestDb();
  });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  it('creates the parent issue row so the agents.issue_id FK is satisfied (no FOREIGN KEY error)', () => {
    // An agent whose issue has NO row in the fresh (empty) overdeck.db.
    const agentDir = join(odb.home, 'agents', 'agent-pan-9999');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'state.json'),
      JSON.stringify({
        id: 'agent-pan-9999',
        issueId: 'PAN-9999',
        role: 'work',
        status: 'stopped',
        workspace: '/tmp/ws',
        model: 'x',
        harness: 'claude-code',
        startedAt: new Date().toISOString(),
      }),
    );

    // Must NOT throw "FOREIGN KEY constraint failed".
    const result = backfillAgentsSync({ listLiveSessions: () => new Set() });

    expect(result.processed).toBe(1);
    // The parent issue row was created (FK satisfied) and the agent is present.
    expect(odb.raw().prepare('SELECT id FROM issues WHERE id = ?').get('PAN-9999')).toBeTruthy();
    expect(odb.raw().prepare('SELECT issue_id FROM agents WHERE id = ?').get('agent-pan-9999')).toBeTruthy();
  });

  it('reports and logs agents reconciled from running to stopped', () => {
    const agentDir = join(odb.home, 'agents', 'agent-pan-9998');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'state.json'),
      JSON.stringify({
        id: 'agent-pan-9998',
        issueId: 'PAN-9998',
        role: 'work',
        status: 'running',
        workspace: '/tmp/ws',
        model: 'x',
        harness: 'claude-code',
        startedAt: new Date().toISOString(),
      }),
    );

    const result = backfillAgentsSync({ listLiveSessions: () => new Set() });

    expect(result.markedStoppedIds).toEqual([
      { id: 'agent-pan-9998', previousStatus: 'running' },
    ]);
    expect(logAgentLifecycleSync).toHaveBeenCalledWith(
      'agent-pan-9998',
      expect.stringContaining('boot backfill reconcile'),
    );
    expect(odb.raw().prepare('SELECT status FROM agents WHERE id = ?').get('agent-pan-9998'))
      .toEqual(expect.objectContaining({ status: 'stopped' }));
  });
});
