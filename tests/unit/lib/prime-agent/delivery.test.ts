import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPrimeAgentSessionsForTests,
  deliverPrimeAgentMessage,
  killPrimeAgentSession,
  registerPrimeAgentSession,
} from '../../../../src/lib/prime-agent/session-controller.js';

function session(streaming: boolean) {
  const commands: Array<Record<string, unknown>> = [];
  const terminate = vi.fn(async () => undefined);
  registerPrimeAgentSession('agent-prime', {
    client: {
      request: vi.fn(async (command: Record<string, unknown>) => {
        commands.push(command);
        return { type: 'response', id: 'test', command: command.type, success: true, data: { isStreaming: streaming } };
      }),
    },
    terminate,
  });
  return { commands, terminate };
}

describe('Prime Agent managed delivery', () => {
  beforeEach(() => {
    clearPrimeAgentSessionsForTests();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('uses prompt when idle', async () => {
    const target = session(false);
    await expect(deliverPrimeAgentMessage('agent-prime', 'hello')).resolves.toEqual({ accepted: true, command: 'prompt' });
    expect(target.commands.map(command => command.type)).toEqual(['get_state', 'prompt']);
  });

  it.each(['steer', 'follow_up'] as const)('uses %s while streaming', async (preferred) => {
    const target = session(true);
    await expect(deliverPrimeAgentMessage('agent-prime', 'guidance', preferred)).resolves.toEqual({ accepted: true, command: preferred });
    expect(target.commands.map(command => command.type)).toEqual(['get_state', preferred]);
  });

  it('reports rejected and crashed sessions', async () => {
    registerPrimeAgentSession('agent-prime', {
      client: { request: vi.fn(async () => { throw new Error('process exited'); }) },
      terminate: vi.fn(async () => undefined),
    });
    await expect(deliverPrimeAgentMessage('agent-prime', 'hello')).rejects.toThrow('process exited');
  });

  it('aborts, waits a bounded grace period, and terminates', async () => {
    const target = session(true);
    const killed = killPrimeAgentSession('agent-prime', 500);
    await vi.advanceTimersByTimeAsync(500);
    await killed;
    expect(target.commands.map(command => command.type)).toEqual(['abort']);
    expect(target.terminate).toHaveBeenCalledOnce();
  });
});
