/**
 * PAN-3674 / PAN-3917: recordAgentActivity must never take down its
 * caller. The original guard wrapped a SQLite mirror write that could throw
 * SQLITE_BUSY; PAN-3917 removed that DB mirror entirely (agent state is
 * state.json only, src/lib/agents/agent-state.ts), so there is no longer a
 * separate DB write to isolate a failure from — writeAgentStateJson is
 * itself the only write, and it is what "the JSON mirror still lands" means
 * now. This file covers the two outcomes that remain: an unknown agent is a
 * no-op, and a known agent's activity write actually lands on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { recordAgentActivity } from '../../../src/lib/agents/agent-state.js';
import type { AgentState } from '../../../src/lib/agents/agent-state.js';

describe('recordAgentActivity (PAN-3674, PAN-3917)', () => {
  const agentId = 'agent-pan-3674-test';
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-record-activity-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('returns false when the agent is unknown', () => {
    expect(recordAgentActivity(agentId, {})).toBe(false);
  });

  it('writes lastActivity and costSoFar to the JSON mirror for a known agent', () => {
    const stateDir = join(home, 'agents', agentId);
    mkdirSync(stateDir, { recursive: true });
    const state: AgentState = {
      id: agentId,
      issueId: 'PAN-3674',
      workspace: '/tmp/workspace',
      harness: 'codex',
      role: 'review',
      model: 'gpt-5.6-sol',
      status: 'running',
      startedAt: '2026-08-13T00:00:00.000Z',
    } as AgentState;
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(state, null, 2));

    expect(recordAgentActivity(agentId, { at: '2026-08-13T00:05:00.000Z', costSoFar: 1.23 })).toBe(true);

    expect(existsSync(join(stateDir, 'state.json'))).toBe(true);
    const written = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf-8')) as AgentState;
    expect(written.lastActivity).toBe('2026-08-13T00:05:00.000Z');
    expect(written.costSoFar).toBe(1.23);
  });
});
