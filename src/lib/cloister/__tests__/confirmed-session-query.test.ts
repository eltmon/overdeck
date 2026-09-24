import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const querySession = vi.hoisted(() => vi.fn());
const supervisorProcessAliveSync = vi.hoisted(() => vi.fn());

vi.mock('../../tmux.js', () => ({
  querySession: (...args: unknown[]) => querySession(...args),
}));
vi.mock('../../agents/supervisor-liveness.js', () => ({
  supervisorProcessAliveSync: (...args: unknown[]) => supervisorProcessAliveSync(...args),
}));

import { clearConfirmedSessionMiss, queryConfirmedSession } from '../confirmed-session-query.js';

describe('queryConfirmedSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConfirmedSessionMiss('agent-min-882');
  });

  it('passes through an existing tmux session without consulting supervisor liveness', async () => {
    querySession.mockReturnValue(Effect.succeed({ status: 'exists' }));
    const [query, retain] = await queryConfirmedSession('agent-min-882');
    expect(query.status).toBe('exists');
    expect(retain).toBeUndefined();
    expect(supervisorProcessAliveSync).not.toHaveBeenCalled();
  });

  it('retains an agent whose tmux session is missing but whose pty-supervisor lives (PAN-3002)', async () => {
    querySession.mockReturnValue(Effect.succeed({ status: 'missing', detail: 'exit=1' }));
    supervisorProcessAliveSync.mockReturnValue(true);
    // Two consecutive calls must BOTH retain — the miss counter must not
    // advance toward orphaning while the worker process is alive.
    for (let i = 0; i < 2; i += 1) {
      const [, retain] = await queryConfirmedSession('agent-min-882');
      expect(retain).toContain('pty-supervisor');
    }
  });

  it('keeps the two-miss escalation when tmux is missing and no supervisor lives', async () => {
    querySession.mockReturnValue(Effect.succeed({ status: 'missing', detail: 'exit=1' }));
    supervisorProcessAliveSync.mockReturnValue(false);
    const first = await queryConfirmedSession('agent-min-882');
    expect(first[1]).toContain('first confirmed tmux miss');
    const second = await queryConfirmedSession('agent-min-882');
    expect(second[1]).toBeUndefined();
  });
});
