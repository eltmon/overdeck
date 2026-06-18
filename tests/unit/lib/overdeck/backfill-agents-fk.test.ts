/**
 * Reproduces the cutover crash (PAN-1938): on a fresh empty overdeck.db,
 * backfillAgentsSync reads each ~/.overdeck/agents/<id>/state.json and inserts agents,
 * but agents.issue_id FKs to issues(id) and the issues table is empty → the boot
 * crash-looped on `FOREIGN KEY constraint failed`. The smoke tests missed this
 * because they ran against a throwaway home with NO state.json files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import { backfillAgentsSync } from '../../../../src/lib/overdeck/agents.js';

describe('backfillAgentsSync FK-safety on a fresh overdeck.db (PAN-1938)', () => {
  let odb: OverdeckTestDb;
  beforeEach(() => { odb = setupOverdeckTestDb(); });
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
});
