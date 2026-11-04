/**
 * PAN-5011: deriveSessionPresence is pane-first. On Herdr the tmux session
 * set never holds an agent, so without this the function always read
 * 'ended' even while the backend reported the pane 'working'.
 */

import { describe, it, expect } from 'vitest';
import type { BackendPane } from '@overdeck/contracts';

import { deriveSessionPresence } from '../../../../../src/dashboard/server/services/session-presence.js';

function pane(overrides: Partial<BackendPane> = {}): BackendPane {
  return {
    id: 'wKZ:p3',
    role: 'work',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    state: 'done',
    ...overrides,
  };
}

describe('deriveSessionPresence', () => {
  it('reads idle for a done pane even with an empty tmux session set', async () => {
    const presence = await deriveSessionPresence('agent-pan-5011', null, new Set(), pane({ state: 'done' }));
    expect(presence).toBe('idle');
  });

  it('reads active for a working pane', async () => {
    const presence = await deriveSessionPresence('agent-pan-5011', null, new Set(), pane({ state: 'working' }));
    expect(presence).toBe('active');
  });

  it('reads ended for an exited pane', async () => {
    const presence = await deriveSessionPresence('agent-pan-5011', null, new Set(), pane({ state: 'exited' }));
    expect(presence).toBe('ended');
  });

  it('falls back to the tmux-only rule when no pane is given', async () => {
    const presence = await deriveSessionPresence('agent-pan-5011', null, new Set());
    expect(presence).toBe('ended');
  });
});
