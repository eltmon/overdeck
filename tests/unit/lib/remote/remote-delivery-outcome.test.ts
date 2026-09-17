import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { FlyProvider } from '../../../../src/lib/remote/fly-provider.js';
import { sendToRemoteAgent } from '../../../../src/lib/remote/remote-agents.js';

/** Provider whose ssh exit codes are scripted per call index. */
function fakeProvider(exitCodes: number[]): { provider: FlyProvider; commands: string[] } {
  const commands: string[] = [];
  let call = 0;
  const provider = {
    ssh: (_vm: string, command: string) => {
      commands.push(command);
      const exitCode = exitCodes[call++] ?? 0;
      return Effect.succeed({ stdout: '', stderr: exitCode === 0 ? '' : 'tmux: no such session', exitCode });
    },
  } as unknown as FlyProvider;
  return { provider, commands };
}

describe('sendToRemoteAgent delivery outcome (PR #3870 finding 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ok:true when every remote step exits zero', async () => {
    const { provider, commands } = fakeProvider([0, 0, 0, 0, 0, 0]);
    const promise = sendToRemoteAgent('agent-remote-1', 'vm-1', 'hello', { createFlyProvider: () => provider });
    await vi.advanceTimersByTimeAsync(400);
    await expect(promise).resolves.toEqual({ ok: true });
    // ensure context, write, load, paste, send-keys, cleanup
    expect(commands.some((c) => c.includes('send-keys'))).toBe(true);
  });

  it('returns ok:false with the failing step when paste-buffer exits nonzero', async () => {
    const { provider } = fakeProvider([0, 0, 0, 1]);
    const promise = sendToRemoteAgent('agent-remote-1', 'vm-1', 'hello', { createFlyProvider: () => provider });
    await vi.advanceTimersByTimeAsync(400);
    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toContain('paste-buffer');
    expect(outcome.failure).toContain('exit 1');
  });

  it('returns ok:false when the send-keys Enter fails', async () => {
    const { provider } = fakeProvider([0, 0, 0, 0, 1]);
    const promise = sendToRemoteAgent('agent-remote-1', 'vm-1', 'hello', { createFlyProvider: () => provider });
    await vi.advanceTimersByTimeAsync(400);
    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toContain('send-keys');
  });

  it('returns ok:false when the prompt-file write fails', async () => {
    const { provider } = fakeProvider([0, 1]);
    const promise = sendToRemoteAgent('agent-remote-1', 'vm-1', 'hello', { createFlyProvider: () => provider });
    await vi.advanceTimersByTimeAsync(400);
    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toContain('prompt-file write');
  });
});
