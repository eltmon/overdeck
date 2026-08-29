import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrimeAgentRpcClient } from '../rpc-client.js';

describe('PrimeAgentRpcClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('correlates responses and emits asynchronous events separately', async () => {
    const writes: string[] = [];
    const events: Record<string, unknown>[] = [];
    const client = new PrimeAgentRpcClient({ stdin: { write: (chunk: unknown) => { writes.push(String(chunk)); return true; } }, onEvent: (event) => events.push(event) });
    const result = client.request({ type: 'get_state' });
    expect(writes).toEqual(['{"type":"get_state","id":"overdeck-1"}\n']);
    client.acceptStdout(Buffer.from('{"type":"agent_start"}\n{"type":"response","id":"overdeck-1","command":"get_state","success":true,"data":{"isStreaming":false}}\n'));
    await expect(result).resolves.toMatchObject({ data: { isStreaming: false } });
    expect(events).toEqual([{ type: 'agent_start' }]);
  });

  it('uses fake timers for bounded request timeout', async () => {
    const client = new PrimeAgentRpcClient({ stdin: { write: () => true }, requestTimeoutMs: 2_000 });
    const result = client.request({ type: 'get_state' });
    const assertion = expect(result).rejects.toThrow('timed out after 2000ms');
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it('rejects all pending requests when the child exits', async () => {
    const client = new PrimeAgentRpcClient({ stdin: { write: () => true } });
    const first = client.request({ type: 'get_state' });
    const second = client.request({ type: 'get_messages' });
    client.close(new Error('Prime Agent exited with code 7'));
    await expect(first).rejects.toThrow('code 7');
    await expect(second).rejects.toThrow('code 7');
  });

  it('bounds the pending request map', async () => {
    const client = new PrimeAgentRpcClient({ stdin: { write: () => true }, maxPendingRequests: 1 });
    const first = client.request({ type: 'get_state' });
    const firstAssertion = expect(first).rejects.toThrow('process exited');
    await expect(client.request({ type: 'get_messages' })).rejects.toThrow('refusing unbounded growth');
    client.close();
    await firstAssertion;
  });
});
