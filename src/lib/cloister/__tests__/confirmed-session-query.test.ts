import { beforeEach, describe, expect, it, vi } from 'vitest';

const querySessionSync = vi.hoisted(() => vi.fn());
const supervisorProcessAliveSync = vi.hoisted(() => vi.fn());

vi.mock('../../tmux.js', () => ({
  querySessionSync: (...args: unknown[]) => querySessionSync(...args),
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

  it('passes through an existing tmux session without consulting supervisor liveness', () => {
    querySessionSync.mockReturnValue({ status: 'exists' });
    const [query, retain] = queryConfirmedSession('agent-min-882');
    expect(query.status).toBe('exists');
    expect(retain).toBeUndefined();
    expect(supervisorProcessAliveSync).not.toHaveBeenCalled();
  });

  it('retains an agent whose tmux session is missing but whose pty-supervisor lives (PAN-3002)', () => {
    querySessionSync.mockReturnValue({ status: 'missing', detail: 'exit=1' });
    supervisorProcessAliveSync.mockReturnValue(true);
    // Two consecutive calls must BOTH retain — the miss counter must not
    // advance toward orphaning while the worker process is alive.
    for (let i = 0; i < 2; i += 1) {
      const [, retain] = queryConfirmedSession('agent-min-882');
      expect(retain).toContain('pty-supervisor');
    }
  });

  it('keeps the two-miss escalation when tmux is missing and no supervisor lives', () => {
    querySessionSync.mockReturnValue({ status: 'missing', detail: 'exit=1' });
    supervisorProcessAliveSync.mockReturnValue(false);
    const first = queryConfirmedSession('agent-min-882');
    expect(first[1]).toContain('first confirmed tmux miss');
    const second = queryConfirmedSession('agent-min-882');
    expect(second[1]).toBeUndefined();
  });
});
