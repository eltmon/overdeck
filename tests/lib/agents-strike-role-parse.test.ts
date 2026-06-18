/**
 * PAN-1506 regression — strike role survives state.json roundtrip.
 *
 * The bug: `isRole()` in src/lib/agents.ts excluded 'strike', so any
 * state.json with role='strike' was treated as legacy roleless and dropped
 * by parseAgentState — making strike agents invisible to listRunningAgents
 * and the dashboard read-model bootstrap (which iterates groundTruthAgents
 * from listRunningAgents to build agentsById).
 *
 * This test exercises the file → parseAgentState path through
 * getAgentStateSync to prove a persisted strike state is returned, not
 * dropped. The Role type in packages/contracts already includes 'strike'.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Set OVERDECK_HOME *before* importing src/lib/agents.js — AGENTS_DIR is
// resolved from process.env at module load.
const tmpHome = mkdtempSync(join(tmpdir(), 'pan-1506-strike-'));
const previousHome = process.env.OVERDECK_HOME;
process.env.OVERDECK_HOME = tmpHome;

const { getAgentStateSync } = await import('../../src/lib/agents.js');

function writeAgentState(agentId: string, role: string): void {
  const dir = join(tmpHome, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      id: agentId,
      issueId: agentId.replace(/^(agent|strike|planning)-/, '').toUpperCase(),
      role,
      status: 'running',
      startedAt: '2026-05-25T00:00:00.000Z',
    }),
    'utf8',
  );
}

describe('PAN-1506: parseAgentState accepts strike role', () => {
  beforeAll(() => {
    writeAgentState('strike-pan-1506', 'strike');
    writeAgentState('agent-pan-1419', 'work');
    writeAgentState('planning-pan-1234', 'plan');
  });

  afterAll(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    if (previousHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = previousHome;
    }
  });

  it('returns the strike state instead of null (regression for invisible strikes)', () => {
    const state = getAgentStateSync('strike-pan-1506');
    expect(state).not.toBeNull();
    expect(state?.role).toBe('strike');
    expect(state?.id).toBe('strike-pan-1506');
  });

  it('also returns work and plan states for parity', () => {
    expect(getAgentStateSync('agent-pan-1419')?.role).toBe('work');
    expect(getAgentStateSync('planning-pan-1234')?.role).toBe('plan');
  });
});
