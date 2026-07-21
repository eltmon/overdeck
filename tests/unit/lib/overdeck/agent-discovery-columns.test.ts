/**
 * PAN-2585: the PAN-1862 discovery-fork fields must be real agents-table columns.
 * They were state.json-only, which made them write-only under the PAN-1908
 * DB-first reader — the discovery-ready signal and the deacon's stalled-discovery
 * backstop read `undefined` forever and the convoy never launched.
 *
 * Two protections:
 *  1. Structural audit — the codec's column list and the drizzle DDL must agree,
 *     so a field added to one but not the other fails at build time.
 *  2. Behavioral round-trip — the discovery fields survive state → row → state
 *     through the real overdeck DB.
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

describe('agents-table discovery columns (PAN-2585)', () => {
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

    it('discovery-fork fields survive state → row → state', () => {
      const state: AgentState = {
        id: 'agent-pan-9999-review',
        issueId: 'PAN-9999',
        workspace: '/tmp/ws',
        role: 'review',
        model: 'gpt-5.5',
        status: 'running',
        startedAt: '2026-07-12T02:00:00.000Z',
        reviewRunId: 'agent-pan-9999-review-abcd1234',
        reviewDiscoveryPending: true,
        reviewContextManifestPath: '/tmp/ws/.pan/review/run/context.json',
        reviewDiscoveryReadyAt: '2026-07-12T02:05:00.000Z',
        reviewConvoyForkedAt: '2026-07-12T02:06:00.000Z',
        reviewForkCacheChecked: false,
        reviewForkedFromParent: true,
      };
      saveOverdeckAgentStateSync(state);

      const readBack = getOverdeckAgentStateSync('agent-pan-9999-review');
      expect(readBack).not.toBeNull();
      expect(readBack?.reviewDiscoveryPending).toBe(true);
      expect(readBack?.reviewContextManifestPath).toBe('/tmp/ws/.pan/review/run/context.json');
      expect(readBack?.reviewDiscoveryReadyAt).toBe('2026-07-12T02:05:00.000Z');
      expect(readBack?.reviewConvoyForkedAt).toBe('2026-07-12T02:06:00.000Z');
      expect(readBack?.reviewForkCacheChecked).toBe(false);
      expect(readBack?.reviewForkedFromParent).toBe(true);
    });
  });
});
