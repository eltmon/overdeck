import { describe, expect, it } from 'vitest';

import { sendToRemoteAgentKeyed } from '../remote-agents.js';
import { dedupPendingOptionName, dedupTerminalOptionName } from '../../tmux-dedup.js';

/**
 * Fake remote tmux server for the keyed remote-delivery protocol (PAN-2997
 * cycle 7). Implements just enough of the marker/paste semantics to prove the
 * command sequencing: option state per marker, a paste log, and an Enter log.
 */
function createFakeRemoteTmux(seed: { pending?: string; terminal?: string; failPaste?: boolean } = {}) {
  const state = {
    pending: seed.pending ?? '',
    terminal: seed.terminal ?? '',
    failPaste: seed.failPaste ?? false,
    pastes: 0,
    enters: 0,
    writes: [] as string[],
    commands: [] as string[],
  };

  const exec = async (command: string): Promise<string> => {
    state.commands.push(command);
    if (command.includes('base64 -d >')) {
      state.writes.push(command);
      return '';
    }
    if (command.includes('if-shell')) {
      if (!state.failPaste && state.pending === '' && state.terminal === '') {
        state.pastes += 1;
        // The onTrue command string ends with `set-option -t <agent> <pendingOption> <sendId>`.
        const sendId = command.trim().replace(/'/g, '').split(/\s+/).at(-1) ?? '';
        state.pending = sendId;
      }
      return '';
    }
    if (command.includes('show-option')) {
      const option = command.trim().split(/\s+/).at(-1)?.replace(/'/g, '') ?? '';
      if (option.includes('-pending-')) return `${state.pending}\n`;
      return `${state.terminal}\n`;
    }
    if (command.includes('send-keys')) {
      state.enters += 1;
      return '';
    }
    if (command.includes('set-option')) {
      // The finalize step sets the terminal marker and unsets pending in one
      // command; both option names appear in the string.
      if (command.includes(dedupTerminalOptionName(KEY))) state.terminal = '1';
      if (command.includes(`'-u'`) && command.includes(dedupPendingOptionName(KEY))) state.pending = '';
      return '';
    }
    return '';
  };

  return { exec, state };
}

const AGENT = 'agent-remote-1';
const VM = 'vm-test-1';
const KEY = 'linear-mcp-auth-wake:lifecycle-1';

describe('sendToRemoteAgentKeyed', () => {
  it('pastes once, submits, and flips the key terminal on a fresh delivery', async () => {
    const { exec, state } = createFakeRemoteTmux();

    const outcome = await sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec);

    expect(outcome).toBe('delivered');
    expect(state.pastes).toBe(1);
    expect(state.enters).toBe(1);
    expect(state.terminal).toBe('1');
    expect(state.pending).toBe('');
    // The message travels base64-encoded in the prompt-file write.
    expect(state.writes[0]).toContain(Buffer.from('wake up remote').toString('base64'));
  });

  it('completes a crashed attempt from the pending marker WITHOUT a second paste', async () => {
    // A prior attempt pasted and set its pending claim, then the dashboard died
    // before the Enter.
    const { exec, state } = createFakeRemoteTmux({ pending: 'earlier-send-id' });

    const outcome = await sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec);

    expect(outcome).toBe('delivered');
    expect(state.pastes).toBe(0);
    expect(state.enters).toBe(1);
    expect(state.terminal).toBe('1');
    expect(state.pending).toBe('');
  });

  it('suppresses the replay entirely once the key is terminal', async () => {
    const { exec, state } = createFakeRemoteTmux({ terminal: '1' });

    const outcome = await sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec);

    expect(outcome).toBe('deduplicated');
    expect(state.pastes).toBe(0);
    expect(state.enters).toBe(0);
  });

  it('fails loudly when the paste did not land and no marker explains why', async () => {
    const { exec } = createFakeRemoteTmux({ failPaste: true });

    await expect(sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec))
      .rejects.toThrow(/did not land/);
  });

  it('rejects keys that are unsafe for tmux option names', async () => {
    const { exec } = createFakeRemoteTmux();

    await expect(sendToRemoteAgentKeyed(AGENT, VM, 'wake', 'bad key with spaces', exec))
      .rejects.toThrow(/dedupKey/);
  });
});
