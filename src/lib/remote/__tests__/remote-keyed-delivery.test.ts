import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { sendToRemoteAgentKeyed } from '../remote-agents.js';
import { dedupPendingOptionName, dedupTerminalOptionName } from '../../tmux-dedup.js';

/**
 * Fake remote tmux server for the keyed remote-delivery protocol (PAN-2997
 * cycle 8). Implements just enough of the marker/paste semantics to prove the
 * command sequencing: option state per marker, a paste log, and an Enter log.
 * The submit phase is the atomic if-shell (claim terminal + clear pending +
 * Enter in one server-owned command list).
 */
function createFakeRemoteTmux(seed: {
  pending?: string;
  terminal?: string;
  failPaste?: boolean;
  failSubmit?: boolean;
} = {}) {
  const state = {
    pending: seed.pending ?? '',
    terminal: seed.terminal ?? '',
    failPaste: seed.failPaste ?? false,
    failSubmit: seed.failSubmit ?? false,
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
    if (command.includes('if-shell') && command.includes('paste-buffer')) {
      // Phase 1: atomic check + paste + pending claim.
      if (state.failPaste) throw new Error('exit 1: simulated paste failure');
      if (state.pending === '' && state.terminal === '') {
        state.pastes += 1;
        // The onTrue command string ends with `set-option -t <agent> <pendingOption> <sendId>`.
        const sendId = command.trim().replace(/'/g, '').split(/\s+/).at(-1) ?? '';
        state.pending = sendId;
      }
      return '';
    }
    if (command.includes('if-shell') && command.includes('send-keys')) {
      // Phase 2: atomic submit — claim terminal, clear pending, then Enter.
      if (state.failSubmit) throw new Error('exit 1: simulated submit failure');
      if (state.pending !== '' && state.terminal === '') {
        state.terminal = '1';
        state.pending = '';
        state.enters += 1;
      }
      return '';
    }
    if (command.includes('show-option')) {
      const option = command.trim().split(/\s+/).at(-1)?.replace(/'/g, '') ?? '';
      if (option.includes('-pending-')) return `${state.pending}\n`;
      return `${state.terminal}\n`;
    }
    return '';
  };

  return { exec, state };
}

const AGENT = 'agent-remote-1';
const VM = 'vm-test-1';
const KEY = 'linear-mcp-auth-wake:lifecycle-1';

describe('sendToRemoteAgentKeyed', () => {
  it('pastes once, submits atomically, and flips the key terminal on a fresh delivery', async () => {
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
    // before the submit.
    const { exec, state } = createFakeRemoteTmux({ pending: 'earlier-send-id' });

    const outcome = await sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec);

    expect(outcome).toBe('delivered');
    expect(state.pastes).toBe(0);
    expect(state.enters).toBe(1);
    expect(state.terminal).toBe('1');
    expect(state.pending).toBe('');
  });

  it('admits exactly one completer when the submit races (cycle 8)', async () => {
    // Both a prior paste claim and a racing completer hit the atomic submit:
    // the first claims terminal; the second loses the server-side condition.
    const { exec, state } = createFakeRemoteTmux({ pending: 'earlier-send-id' });

    const [first, second] = await Promise.all([
      sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec),
      sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec),
    ]);

    expect(first).toBe('delivered');
    expect(second).toBe('delivered');
    expect(state.pastes).toBe(0);
    expect(state.enters).toBe(1);
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
      .rejects.toThrow(/simulated paste failure/);
  });

  it('a FAILED Enter-submit can never return delivered or create a terminal marker (cycle 8)', async () => {
    const { exec, state } = createFakeRemoteTmux({ failSubmit: true });

    await expect(sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec))
      .rejects.toThrow(/simulated submit failure/);
    expect(state.enters).toBe(0);
    expect(state.terminal).toBe('');
  });

  it('rejects keys that are unsafe for tmux option names', async () => {
    const { exec } = createFakeRemoteTmux();

    await expect(sendToRemoteAgentKeyed(AGENT, VM, 'wake', 'bad key with spaces', exec))
      .rejects.toThrow(/dedupKey/);
  });
});

describe('sendToRemoteAgentKeyed production adapter (cycle 8)', () => {
  it('throws on any non-zero SSH exit instead of acknowledging the command', async () => {
    vi.resetModules();
    vi.doMock('../fly-provider.js', () => ({
      createFlyProvider: () => ({
        ssh: (_vm: string, command: string) => {
          // The tmux-context bootstrap succeeds; the first protocol command fails.
          if (command.includes('overdeck.tmux.conf')) {
            return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 });
          }
          return Effect.succeed({ stdout: '', stderr: 'simulated remote failure', exitCode: 1 });
        },
      }),
    }));
    const { sendToRemoteAgentKeyed: keyedWithRealAdapter } = await import('../remote-agents.js');

    await expect(keyedWithRealAdapter(AGENT, VM, 'wake up remote', KEY))
      .rejects.toThrow(/exit 1.*simulated remote failure/);
    vi.doUnmock('../fly-provider.js');
    vi.resetModules();
  });
});
