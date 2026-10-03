import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { saveAgentStateSync } from '../agent-state.js';
import { getAgentState, type AgentState } from '../agent-state-read.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-agent-state-effort-test-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
});

function agentDir(agentId: string): string {
  return join(tempHome, 'agents', agentId);
}

const baseState = {
  issueId: 'PAN-4253',
  workspace: '/tmp/workspace',
  role: 'work',
  model: 'claude-opus-5-5',
  status: 'stopped',
  startedAt: new Date().toISOString(),
} as const;

describe('AgentState effort persistence', () => {
  it('round-trips effort and effortSource through saveAgentStateSync', () => {
    const agentId = 'agent-effort-roundtrip';
    saveAgentStateSync({
      id: agentId,
      ...baseState,
      effort: 'max',
      effortSource: 'role',
    } as AgentState);

    const state = getAgentState(agentId);
    expect(state?.effort).toBe('max');
    expect(state?.effortSource).toBe('role');
  });

  it('drops an invalid persisted effort level and its source', () => {
    const agentId = 'agent-effort-invalid';
    mkdirSync(agentDir(agentId), { recursive: true });
    writeFileSync(
      join(agentDir(agentId), 'state.json'),
      JSON.stringify({
        id: agentId,
        ...baseState,
        effort: 'ultra',
        effortSource: 'role',
      }),
    );

    const state = getAgentState(agentId);
    expect(state?.effort).toBeUndefined();
    expect(state?.effortSource).toBeUndefined();
  });

  it('leaves effort fields undefined and preserves every other field for legacy state', () => {
    const agentId = 'agent-effort-legacy';
    mkdirSync(agentDir(agentId), { recursive: true });
    writeFileSync(
      join(agentDir(agentId), 'state.json'),
      JSON.stringify({
        id: agentId,
        ...baseState,
      }),
    );

    const state = getAgentState(agentId);
    expect(state?.effort).toBeUndefined();
    expect(state?.effortSource).toBeUndefined();
    expect(state?.id).toBe(agentId);
    expect(state?.issueId).toBe(baseState.issueId);
    expect(state?.workspace).toBe(baseState.workspace);
    expect(state?.role).toBe(baseState.role);
    expect(state?.model).toBe(baseState.model);
    expect(state?.status).toBe(baseState.status);
    expect(state?.startedAt).toBe(baseState.startedAt);
  });
});
