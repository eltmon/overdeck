/**
 * GET /api/agents/:id/output reads the agent's pane through the host's
 * terminal backend (#4097). It used to call tmux `capture-pane` alone, so a
 * Herdr agent always came back empty. The Effect route is a thin wrapper; the
 * branching lives in `readAgentOutput`, tested here through its seams.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/terminal-backends/agent-pane-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/terminal-backends/agent-pane-io.js')>()),
  readAgentPaneText: vi.fn(async () => 'screen from the host backend'),
}));

vi.mock('../../../../lib/tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/tmux.js')>()),
  capturePane: vi.fn(async () => ''),
}));

import { readAgentPaneText } from '../../../../lib/terminal-backends/agent-pane-io.js';
import { readAgentOutput, type AgentOutputDeps } from '../agents/conversation.js';

function deps(overrides: AgentOutputDeps = {}): Required<AgentOutputDeps> {
  return {
    readPane: vi.fn(async () => ''),
    readLegacyTmuxPane: vi.fn(async () => ''),
    readRemoteState: vi.fn(async () => null),
    readRemoteOutput: vi.fn(async () => ''),
    readSavedLog: vi.fn(async () => null),
    ...overrides,
  } as Required<AgentOutputDeps>;
}

describe('readAgentOutput', () => {
  it('reads through the host terminal backend by default, not tmux alone', async () => {
    const output = await readAgentOutput('agent-pan-0', 40, {
      readRemoteState: async () => null,
      readSavedLog: async () => null,
    });
    expect(output).toBe('screen from the host backend');
    expect(readAgentPaneText).toHaveBeenCalledWith('agent-pan-0', 40);
  });

  it('returns the pane text the host backend reads (a Herdr agent)', async () => {
    const d = deps({ readPane: vi.fn(async () => 'herdr screen') });
    await expect(readAgentOutput('agent-pan-1', 50, d)).resolves.toBe('herdr screen');
    expect(d.readPane).toHaveBeenCalledWith('agent-pan-1', 50);
    expect(d.readLegacyTmuxPane).not.toHaveBeenCalled();
  });

  it('falls back to the legacy tmux session when the backend holds no pane', async () => {
    const d = deps({
      readPane: vi.fn(async () => { throw new Error('herdr holds no pane for agent-pan-2'); }),
      readLegacyTmuxPane: vi.fn(async () => 'tmux screen'),
    });
    await expect(readAgentOutput('agent-pan-2', 20, d)).resolves.toBe('tmux screen');
    expect(d.readLegacyTmuxPane).toHaveBeenCalledWith('agent-pan-2', 20);
  });

  it('falls back to the tail of output.log when no pane has text', async () => {
    const d = deps({
      readPane: vi.fn(async () => { throw new Error('no pane'); }),
      readLegacyTmuxPane: vi.fn(async () => 'Session not found'),
      readSavedLog: vi.fn(async () => 'a\nb\nc\nd'),
    });
    await expect(readAgentOutput('agent-pan-3', 2, d)).resolves.toBe('c\nd');
  });

  it('answers empty, never "Session not found", when nothing is readable', async () => {
    const d = deps({ readPane: vi.fn(async () => 'Session not found\n') });
    await expect(readAgentOutput('agent-pan-4', 10, d)).resolves.toBe('');
  });

  it('reads a remote agent from its VM and skips the local backend', async () => {
    const d = deps({
      readRemoteState: vi.fn(async () => ({ location: 'remote', vmName: 'vm-1' })),
      readRemoteOutput: vi.fn(async () => 'remote screen'),
    });
    await expect(readAgentOutput('agent-pan-5', 30, d)).resolves.toBe('remote screen');
    expect(d.readRemoteOutput).toHaveBeenCalledWith('agent-pan-5', 'vm-1', 30);
    expect(d.readPane).not.toHaveBeenCalled();
  });
});
