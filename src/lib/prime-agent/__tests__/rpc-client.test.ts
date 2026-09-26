import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrimeAgentManagedPolicyError } from '../policy.js';
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

  it('rejects a response whose command name does not match the request', async () => {
    const client = new PrimeAgentRpcClient({ stdin: { write: () => true } });
    const result = client.request({ type: 'get_state' });
    client.acceptStdout(Buffer.from('{"type":"response","id":"overdeck-1","command":"get_messages","success":true}\n'));
    await expect(result).rejects.toThrow('named get_messages, expected get_state');
  });

  it('rejects a success:false response with the upstream error', async () => {
    const client = new PrimeAgentRpcClient({ stdin: { write: () => true } });
    const result = client.request({ type: 'prompt', message: 'hi' });
    client.acceptStdout(Buffer.from('{"type":"response","id":"overdeck-1","command":"prompt","success":false,"error":"busy"}\n'));
    await expect(result).rejects.toThrow('prompt request failed: busy');
  });

  it('refuses denylisted commands before writing anything', async () => {
    const writes: string[] = [];
    const client = new PrimeAgentRpcClient({ stdin: { write: (chunk: unknown) => { writes.push(String(chunk)); return true; } } });
    expect(() => client.request({ type: 'refine' })).toThrow(PrimeAgentManagedPolicyError);
    expect(() => client.notify({ type: 'new_session' })).toThrow(PrimeAgentManagedPolicyError);
    expect(writes).toEqual([]);
  });

  it('writes one-way records without registering a pending request', () => {
    const writes: string[] = [];
    const client = new PrimeAgentRpcClient({ stdin: { write: (chunk: unknown) => { writes.push(String(chunk)); return true; } }, maxPendingRequests: 1 });
    client.notify({ type: 'extension_ui_response', id: 'ui-1', cancelled: true });
    expect(writes).toEqual(['{"type":"extension_ui_response","id":"ui-1","cancelled":true}\n']);
    void client.request({ type: 'get_state' }).catch(() => undefined);
    client.close();
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

  it('never throws out of acceptStdout, and keeps routing past a bad record', async () => {
    // acceptStdout runs inside the host's stdout 'data' listener. A synchronous
    // throw there is an uncaught exception: the host dies, its cleanup never
    // runs, and the Prime child is orphaned with no launch-error file written.
    const errors: string[] = [];
    const events: Array<Record<string, unknown>> = [];
    const client = new PrimeAgentRpcClient({
      stdin: { write: () => true },
      onEvent: event => events.push(event),
      onRecordError: error => errors.push(error.message),
    });

    expect(() => client.acceptStdout(Buffer.from('Prime Agent v1.2.3 starting up\n'))).not.toThrow();
    expect(() => client.acceptStdout(Buffer.from('42\n'))).not.toThrow();
    expect(() => client.acceptStdout(Buffer.from('{"type":"response","command":"get_state","success":true}\n'))).not.toThrow();
    client.acceptStdout(Buffer.from('{"type":"agent_end"}\n'));

    expect(errors).toHaveLength(3);
    expect(events).toEqual([{ type: 'agent_end' }]);
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
