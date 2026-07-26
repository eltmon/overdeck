import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { sendToRemoteAgentKeyed } from '../remote-agents.js';
import { dedupPendingOptionName, dedupTerminalOptionName, KeyedSubmitTargetDeadError } from '../../tmux-dedup.js';

/**
 * Fake remote tmux server for the keyed remote-delivery protocol (PAN-2997
 * cycle 9). Implements just enough of the marker/paste/liveness semantics to
 * prove the command sequencing: option state per marker, pane liveness, a
 * paste log, and an Enter log. The submit phase is the atomic if-shell
 * (liveness check, Enter, then terminal claim — in one server-owned list).
 */
function createFakeRemoteTmux(seed: {
  pending?: string;
  terminal?: string;
  failPaste?: boolean;
  failSubmit?: boolean;
  paneDead?: boolean;
  dieOnEnter?: boolean;
} = {}) {
  const state = {
    pending: seed.pending ?? '',
    terminal: seed.terminal ?? '',
    failPaste: seed.failPaste ?? false,
    failSubmit: seed.failSubmit ?? false,
    paneDead: seed.paneDead ?? false,
    dieOnEnter: seed.dieOnEnter ?? false,
    pid: '4242',
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
      // Phase 2: atomic submit — liveness gate, Enter, then terminal claim.
      if (state.failSubmit) throw new Error('exit 1: simulated submit failure');
      if (state.pending !== '' && state.terminal === '' && !state.paneDead) {
        state.enters += 1;
        state.terminal = '1';
        state.pending = '';
        // The pane dies in the shell-to-branch handoff window: send-keys
        // already "succeeded", the markers already flipped.
        if (state.dieOnEnter) state.paneDead = true;
      }
      return '';
    }
    if (command.includes('show-option')) {
      const option = command.trim().split(/\s+/).at(-1)?.replace(/'/g, '') ?? '';
      if (option.includes('-pending-')) return `${state.pending}\n`;
      return `${state.terminal}\n`;
    }
    if (command.includes('display-message')) {
      return `${state.pid} ${state.paneDead ? '1' : '0'}\n`;
    }
    if (command.includes('set-option')) {
      // Marker rollback: each subcommand is quoted as `';'`-separated argv.
      for (const sub of command.split(`';'`)) {
        if (sub.includes(dedupTerminalOptionName(KEY))) {
          state.terminal = sub.includes(`'-u'`) ? '' : '1';
        }
        if (sub.includes(dedupPendingOptionName(KEY))) {
          state.pending = sub.includes(`'-u'`)
            ? ''
            : (sub.trim().replace(/'/g, '').split(/\s+/).at(-1) ?? '');
        }
      }
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

  it('a pane that dies after the paste keeps the key NON-terminal and recoverable (cycle 9)', async () => {
    // The harness exited during the settle window: pending claim exists, pane dead.
    const { exec, state } = createFakeRemoteTmux({ pending: 'earlier-send-id', paneDead: true });

    await expect(sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec))
      .rejects.toThrow(KeyedSubmitTargetDeadError);
    // No Enter was attempted, no terminal marker was written, and the pending
    // claim survived so recovery can retry after the agent resumes.
    expect(state.enters).toBe(0);
    expect(state.terminal).toBe('');
    expect(state.pending).toBe('earlier-send-id');

    // Recovery once the pane is alive again: never a false dedup.
    state.paneDead = false;
    const outcome = await sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec);
    expect(outcome).toBe('delivered');
    expect(state.enters).toBe(1);
    expect(state.terminal).toBe('1');
  });

  it('rolls the key back when the pane dies AROUND the Enter — send-keys "succeeded" but the harness is gone (cycle 10)', async () => {
    // The if-shell condition sees a live pane, the Enter lands, the markers
    // flip — and the pane dies in the same breath, inside the shell-to-branch
    // handoff window. tmux reported success throughout.
    const { exec, state } = createFakeRemoteTmux({ pending: 'earlier-send-id', dieOnEnter: true });

    await expect(sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec))
      .rejects.toThrow(KeyedSubmitTargetDeadError);
    // The terminal marker was rolled back and the pending claim restored.
    expect(state.terminal).toBe('');
    expect(state.pending).toBe('earlier-send-id');

    // Recovery after the pane is alive again: real submission, never a false dedup.
    state.paneDead = false;
    state.dieOnEnter = false;
    const outcome = await sendToRemoteAgentKeyed(AGENT, VM, 'wake up remote', KEY, exec);
    expect(outcome).toBe('delivered');
    // Two Enters in total: the one lost to the dying pane, and the recovery's.
    expect(state.enters).toBe(2);
    expect(state.terminal).toBe('1');
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
