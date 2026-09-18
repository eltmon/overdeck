/**
 * Prime delivery and kill, exercised through the paths production actually
 * takes. An earlier version of this file drove an in-process session registry
 * that nothing ever populated, so it proved a code path the adapter never runs
 * — which is how the kill-path defect (abort rejects, terminate skipped) got
 * past several review cycles.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;
let savedOverdeckHome: string | undefined;
let server: Server | undefined;
let received: Array<Record<string, unknown>>;
let respond: (body: Record<string, unknown>) => { status: number; payload: string };

const AGENT = 'agent-prime';

/** Stand up the host's unix socket exactly where `postPrimeAgentHost` looks. */
async function startHost(): Promise<void> {
  const socketDir = join(home, 'sockets');
  mkdirSync(socketDir, { recursive: true });
  mkdirSync(join(home, 'agents', AGENT), { recursive: true });
  writeFileSync(join(home, 'agents', AGENT, 'prime-agent-token'), 'test-token');

  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      received.push({ ...body, token: request.headers['x-overdeck-bridge-token'] });
      const { status, payload } = respond(body);
      response.writeHead(status, { 'content-type': 'application/json' }).end(payload);
    });
  });
  await new Promise<void>(resolve => server!.listen(join(socketDir, `prime-agent-${AGENT}.sock`), resolve));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'prime-delivery-'));
  savedOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  received = [];
  respond = () => ({ status: 200, payload: JSON.stringify({ command: 'prompt' }) });
  vi.resetModules();
});

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  rmSync(home, { recursive: true, force: true });
  // Restore rather than leave OVERDECK_HOME pointing at a directory this
  // afterEach just deleted — the per-worker home is shared by every test file
  // that runs after this one in the same worker.
  if (savedOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = savedOverdeckHome;
  vi.useRealTimers();
});

describe('Prime Agent delivery', () => {
  it('posts the message to the host and reports the command the host chose', async () => {
    await startHost();
    respond = () => ({ status: 200, payload: JSON.stringify({ command: 'steer' }) });
    const { deliverPrimeAgentMessage } = await import('../../../../src/lib/prime-agent/session-controller.js');

    await expect(deliverPrimeAgentMessage(AGENT, 'guidance', 'steer')).resolves.toEqual({ accepted: true, command: 'steer' });
    expect(received).toEqual([{ op: 'message', message: 'guidance', preferred: 'steer', token: 'test-token' }]);
  });

  it('rejects when the host answers non-2xx', async () => {
    await startHost();
    respond = () => ({ status: 500, payload: 'child is wedged' });
    const { deliverPrimeAgentMessage } = await import('../../../../src/lib/prime-agent/session-controller.js');

    await expect(deliverPrimeAgentMessage(AGENT, 'hello')).rejects.toThrow('HTTP 500');
  });

  it('rejects when no host socket exists', async () => {
    const { deliverPrimeAgentMessage } = await import('../../../../src/lib/prime-agent/session-controller.js');
    await expect(deliverPrimeAgentMessage(AGENT, 'hello')).rejects.toThrow('host is unavailable');
  });
});

describe('Prime Agent kill', () => {
  it('aborts, waits a bounded grace period, then terminates', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const { PrimeAgentRuntimeSync } = await import('../../../../src/lib/runtimes/prime-agent.js');
    const { PRIME_AGENT_KILL_GRACE_MS } = await import('../../../../src/lib/prime-agent/session-controller.js');
    const runtime = new PrimeAgentRuntimeSync({
      controller: {
        spawn: vi.fn(), send: vi.fn(), isRunning: vi.fn(), stats: vi.fn(), lastEventAt: vi.fn(), sessionPath: vi.fn(),
        abort: async () => { order.push('abort'); },
        terminate: async () => { order.push('terminate'); },
      } as never,
    });

    const killed = runtime.killAgent(AGENT);
    expect(order).toEqual(['abort']);
    await vi.advanceTimersByTimeAsync(PRIME_AGENT_KILL_GRACE_MS);
    await killed;
    expect(order).toEqual(['abort', 'terminate']);
  });

  it('still terminates the process tree when abort rejects', async () => {
    // The wedged-child case: the host's own RPC request times out and it
    // answers 500. Skipping terminate here left the tmux session, the host,
    // and the Prime child alive while Cloister emitted killed_agent.
    vi.useFakeTimers();
    const order: string[] = [];
    const { PrimeAgentRuntimeSync } = await import('../../../../src/lib/runtimes/prime-agent.js');
    const { PRIME_AGENT_KILL_GRACE_MS } = await import('../../../../src/lib/prime-agent/session-controller.js');
    const runtime = new PrimeAgentRuntimeSync({
      controller: {
        spawn: vi.fn(), send: vi.fn(), isRunning: vi.fn(), stats: vi.fn(), lastEventAt: vi.fn(), sessionPath: vi.fn(),
        abort: async () => { order.push('abort'); throw new Error('Prime Agent host returned HTTP 500: timed out'); },
        terminate: async () => { order.push('terminate'); },
      } as never,
    });

    const killed = runtime.killAgent(AGENT);
    await vi.advanceTimersByTimeAsync(PRIME_AGENT_KILL_GRACE_MS);
    await expect(killed).resolves.toBeUndefined();
    expect(order).toEqual(['abort', 'terminate']);
  });

  it('terminates even when the host socket is already gone', async () => {
    vi.useFakeTimers();
    const terminate = vi.fn(async () => undefined);
    const { PrimeAgentRuntimeSync } = await import('../../../../src/lib/runtimes/prime-agent.js');
    const { PRIME_AGENT_KILL_GRACE_MS } = await import('../../../../src/lib/prime-agent/session-controller.js');
    const runtime = new PrimeAgentRuntimeSync({
      controller: {
        spawn: vi.fn(), send: vi.fn(), isRunning: vi.fn(), stats: vi.fn(), lastEventAt: vi.fn(), sessionPath: vi.fn(),
        abort: async () => { throw new Error('MessageDeliveryFailed: Prime Agent host is unavailable for agent-prime'); },
        terminate,
      } as never,
    });

    const killed = runtime.killAgent(AGENT);
    await vi.advanceTimersByTimeAsync(PRIME_AGENT_KILL_GRACE_MS);
    await killed;
    expect(terminate).toHaveBeenCalledOnce();
  });
});
