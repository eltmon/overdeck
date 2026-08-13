/**
 * PAN-3674: recordAgentActivitySync must never take down its caller. On
 * 2026-08-13 an unhandled SQLITE_BUSY from the overdeck.db write crashed the
 * PAN-3668 review orchestrator's app-server host mid-synthesis — a telemetry
 * write killed the agent. The DB write is now failure-isolated; the JSON
 * state mirror still lands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

const getOverdeckAgentStateSyncMock = vi.hoisted(() => vi.fn());
const saveOverdeckAgentStateSyncMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/lib/overdeck/agent-state-sync.js', () => ({
  getOverdeckAgentStateSync: getOverdeckAgentStateSyncMock,
  saveOverdeckAgentStateSync: saveOverdeckAgentStateSyncMock,
}));

import { recordAgentActivitySync } from '../../../src/lib/agents/agent-state.js';

describe('recordAgentActivitySync failure isolation (PAN-3674)', () => {
  const agentId = 'agent-pan-3674-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when the agent is unknown', () => {
    getOverdeckAgentStateSyncMock.mockReturnValue(null);
    expect(recordAgentActivitySync(agentId, {})).toBe(false);
    expect(saveOverdeckAgentStateSyncMock).not.toHaveBeenCalled();
  });

  it('swallows a locked-database failure and still writes the JSON mirror', () => {
    getOverdeckAgentStateSyncMock.mockReturnValue({
      id: agentId,
      issueId: 'PAN-3674',
      workspace: '/tmp/workspace',
      harness: 'codex',
      role: 'review',
      model: 'gpt-5.6-sol',
      status: 'running',
      startedAt: '2026-08-13T00:00:00.000Z',
    });
    saveOverdeckAgentStateSyncMock.mockImplementation(() => {
      const err = new Error('database is locked');
      (err as NodeJS.ErrnoException & { code?: string }).code = 'ERR_SQLITE_ERROR';
      throw err;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => recordAgentActivitySync(agentId, { costSoFar: 1.23 })).not.toThrow();
    expect(recordAgentActivitySync(agentId, {})).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('database is locked'));
    // The JSON mirror still ran — state plane does not depend on the DB write.
    // (OVERDECK_HOME is the per-worker temp home from tests/setup/overdeck-home.ts.)
    expect(existsSync(join(process.env.OVERDECK_HOME!, 'agents', agentId, 'state.json'))).toBe(true);
    warn.mockRestore();
  });
});
