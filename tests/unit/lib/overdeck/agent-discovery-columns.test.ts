/**
 * Missing-reviewer recovery needs the parent review run's context manifest after
 * the runtime registry has been rebuilt, so it must survive state → row → state.
 * The structural audit keeps its DDL and codec projections aligned.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_COLUMNS_FOR_DB } from '../../../../src/lib/overdeck/agent-state-sync.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import {
  saveOverdeckAgentStateSync,
  getOverdeckAgentStateSync,
} from '../../../../src/lib/overdeck/agent-state-sync.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';

function ddlAgentColumns(): string[] {
  const sql = readFileSync(resolve(process.cwd(), 'drizzle/overdeck/0000_overdeck_init.sql'), 'utf-8');
  const create = sql.match(/CREATE TABLE `agents` \(([\s\S]*?)\n\);/);
  if (!create) throw new Error('agents DDL not found in 0000_overdeck_init.sql');
  return [...create[1].matchAll(/^\s*`([a-z_]+)`/gm)].map((m) => m[1]);
}

describe('agents-table review recovery metadata', () => {
  it('codec column list and drizzle DDL agree exactly', () => {
    const ddl = ddlAgentColumns().sort();
    const codec = [...AGENT_COLUMNS_FOR_DB].sort();
    expect(codec).toEqual(ddl);
  });

  describe('round-trip through a real overdeck DB', () => {
    let odb: OverdeckTestDb;

    beforeEach(() => {
      odb = setupOverdeckTestDb();
    });

    afterEach(() => {
      teardownOverdeckTestDb(odb);
    });

    it('review context manifest survives state → row → state', () => {
      const state: AgentState = {
        id: 'agent-pan-9999-review',
        issueId: 'PAN-9999',
        workspace: '/tmp/ws',
        role: 'review',
        model: 'gpt-5.5',
        status: 'running',
        startedAt: '2026-07-12T02:00:00.000Z',
        reviewRunId: 'agent-pan-9999-review-abcd1234',
        startedBy: 'flywheel:RUN-71',
        reviewContextManifestPath: '/tmp/ws/.pan/review/run/context.json',
      };
      saveOverdeckAgentStateSync(state);

      const readBack = getOverdeckAgentStateSync('agent-pan-9999-review');
      expect(readBack).not.toBeNull();
      expect(readBack?.startedBy).toBe('flywheel:RUN-71');
      expect(readBack?.reviewContextManifestPath).toBe('/tmp/ws/.pan/review/run/context.json');
    });
  });
});
