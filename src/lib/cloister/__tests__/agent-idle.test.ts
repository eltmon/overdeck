// PAN-1586: isAgentIdleForNudge must treat a STALE 'active' runtime mirror as idle.
// When the Stop hook fails to fire, the mirror stays 'active' forever — PAN-1574
// sat 'active' for 36h after ending its turn, invisible to every idle-nudge patrol.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRuntimeState } from '../../agents.js';

vi.mock('../../agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn(),
}));

import { isAgentIdleForNudge } from '../agent-idle.js';
import { getAgentRuntimeStateSync } from '../../agents.js';

const mockRuntime = getAgentRuntimeStateSync as unknown as ReturnType<typeof vi.fn>;
const NOW = 1_000_000_000_000;
const STALE = 5 * 60 * 1000;

function rt(partial: Partial<AgentRuntimeState>): AgentRuntimeState {
  return { state: 'active', lastActivity: new Date(NOW).toISOString(), ...partial } as AgentRuntimeState;
}

describe('isAgentIdleForNudge (PAN-1586)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when no runtime mirror exists (hook never fired)', () => {
    mockRuntime.mockReturnValue(null);
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(false);
  });

  it('returns true when the mirror is explicitly idle', () => {
    mockRuntime.mockReturnValue(rt({ state: 'idle' }));
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(true);
  });

  it('returns false for a FRESH active agent (still working)', () => {
    mockRuntime.mockReturnValue(rt({ state: 'active', lastActivity: new Date(NOW - 60_000).toISOString() }));
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(false);
  });

  it('returns true for a STALE active agent (Stop hook never fired — the PAN-1574 case)', () => {
    mockRuntime.mockReturnValue(rt({ state: 'active', lastActivity: new Date(NOW - 36 * 60 * 60 * 1000).toISOString() }));
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(true);
  });

  it('returns true for a stale uninitialized agent (unchanged behavior)', () => {
    mockRuntime.mockReturnValue(rt({ state: 'uninitialized', lastActivity: new Date(NOW - 10 * 60_000).toISOString() }));
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(true);
  });

  it('never nudges a human-blocked agent, even when stale', () => {
    mockRuntime.mockReturnValue(rt({ state: 'waiting-on-human', lastActivity: new Date(NOW - 60 * 60 * 1000).toISOString() }));
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(false);
  });

  it('never nudges suspended or stopped agents', () => {
    mockRuntime.mockReturnValue(rt({ state: 'suspended', lastActivity: new Date(NOW - 60 * 60 * 1000).toISOString() }));
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(false);
    mockRuntime.mockReturnValue(rt({ state: 'stopped', lastActivity: new Date(NOW - 60 * 60 * 1000).toISOString() }));
    expect(isAgentIdleForNudge('agent-x', STALE, NOW)).toBe(false);
  });
});
