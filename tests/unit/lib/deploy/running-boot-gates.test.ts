import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readRunningDashboardBootGates } from '../../../../src/lib/deploy/running-boot-gates.js';

const OFF_BY_FLAG = {
  deacon: { enabled: false, source: 'flag' },
  resume: { enabled: false, source: 'flag' },
};

describe('readRunningDashboardBootGates (PAN-3899)', () => {
  it('returns the gates the running dashboard reports on /api/health', async () => {
    const fetchHealth = vi.fn(async () => ({ status: 'ok', repoRoot: '/repo', pid: 42, bootGates: OFF_BY_FLAG }));
    const readEnviron = vi.fn();

    await expect(readRunningDashboardBootGates(3011, '/repo', { fetchHealth, readEnviron }))
      .resolves.toEqual({ gates: OFF_BY_FLAG });
    expect(fetchHealth).toHaveBeenCalledWith('http://127.0.0.1:3011/api/health', 2000);
    expect(readEnviron).not.toHaveBeenCalled();
  });

  it('falls back to the process env markers when the server predates bootGates', async () => {
    const environ = [
      'PATH=/usr/bin',
      'OVERDECK_DISABLE_DEACON=1',
      'OVERDECK_DEACON_GATE_SOURCE=flag',
      'OVERDECK_NO_RESUME=1',
      'OVERDECK_RESUME_GATE_SOURCE=flag',
      '',
    ].join('\0');
    const readEnviron = vi.fn(async () => environ);

    await expect(readRunningDashboardBootGates(3011, '/repo', {
      fetchHealth: async () => ({ status: 'ok', repoRoot: '/repo', pid: 42 }),
      readEnviron,
    })).resolves.toEqual({ gates: OFF_BY_FLAG });
    expect(readEnviron).toHaveBeenCalledWith(42);
  });

  it('reads an env with no gate markers as the defaults, and the live shape (source=flag, Deacon on) as-is', async () => {
    const read = (environ: string) => readRunningDashboardBootGates(3011, '/repo', {
      fetchHealth: async () => ({ status: 'ok', repoRoot: '/repo', pid: 42 }),
      readEnviron: async () => environ,
    });

    await expect(read('PATH=/usr/bin\0')).resolves.toEqual({
      gates: { deacon: { enabled: true, source: 'default' }, resume: { enabled: true, source: 'default' } },
    });
    await expect(read('OVERDECK_DEACON_GATE_SOURCE=flag\0OVERDECK_RESUME=1\0OVERDECK_RESUME_GATE_SOURCE=default\0'))
      .resolves.toEqual({
        gates: { deacon: { enabled: true, source: 'flag' }, resume: { enabled: true, source: 'default' } },
      });
  });

  it('retries a failed health read once with a longer budget', async () => {
    const fetchHealth = vi.fn()
      .mockRejectedValueOnce(new Error('no answer within 2000ms'))
      .mockResolvedValueOnce({ status: 'ok', repoRoot: '/repo', bootGates: OFF_BY_FLAG });

    await expect(readRunningDashboardBootGates(3011, '/repo', { fetchHealth }))
      .resolves.toEqual({ gates: OFF_BY_FLAG });
    expect(fetchHealth.mock.calls.map(([, timeoutMs]) => timeoutMs)).toEqual([2000, 8000]);
  });

  it('misses with a reason when no dashboard answers either try', async () => {
    const fetchHealth = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const read = await readRunningDashboardBootGates(3011, '/repo', { fetchHealth });

    expect(read.gates).toBeNull();
    expect(read.reason).toContain('unreadable after 2 tries: ECONNREFUSED');
    expect(fetchHealth).toHaveBeenCalledTimes(2);
  });

  it('misses with a reason when neither the health body nor the process env can be read', async () => {
    await expect(readRunningDashboardBootGates(3011, '/repo', {
      fetchHealth: async () => ({ status: 'ok', repoRoot: '/repo' }),
    })).resolves.toMatchObject({ gates: null, reason: expect.stringContaining('neither its gates nor a pid') });
    await expect(readRunningDashboardBootGates(3011, '/repo', {
      fetchHealth: async () => ({ status: 'ok', repoRoot: '/repo', pid: 42 }),
      readEnviron: async () => { throw new Error('EACCES'); },
    })).resolves.toMatchObject({ gates: null, reason: expect.stringContaining('EACCES') });
  });

  it('ignores a server of another checkout holding the port', async () => {
    const readEnviron = vi.fn();
    await expect(readRunningDashboardBootGates(3011, '/repo', {
      fetchHealth: async () => ({ status: 'ok', repoRoot: '/elsewhere', pid: 42, bootGates: OFF_BY_FLAG }),
      readEnviron,
    })).resolves.toMatchObject({ gates: null, reason: expect.stringContaining('/elsewhere') });
    expect(readEnviron).not.toHaveBeenCalled();
  });
});

// The real health fetch against a real socket: no fetchHealth injection.
describe('readRunningDashboardBootGates over HTTP (PAN-3899)', () => {
  let server: Server | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    const current = server;
    server = null;
    if (current?.listening) {
      current.closeAllConnections();
      await new Promise<void>((resolve) => current.close(() => resolve()));
    }
  });

  async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return address.port;
  }

  it('reads the gates from a 503 (incoherent) body', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'incoherent', repoRoot: '/repo', pid: 42, bootGates: OFF_BY_FLAG }));
    });

    await expect(readRunningDashboardBootGates(port, '/repo')).resolves.toEqual({ gates: OFF_BY_FLAG });
  });

  it('misses on a non-JSON body after retrying once', async () => {
    let requests = 0;
    const port = await serve((_req, res) => {
      requests += 1;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>not the dashboard</html>');
    });

    const read = await readRunningDashboardBootGates(port, '/repo');
    expect(read.gates).toBeNull();
    expect(read.reason).toContain('unreadable after 2 tries');
    expect(requests).toBe(2);
  });

  it('gives up on a server that never answers once both budgets run out', async () => {
    let requests = 0;
    const port = await serve(() => { requests += 1; });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const waitForRequests = async (count: number) => {
      while (requests < count) await new Promise<void>((resolve) => setImmediate(resolve));
    };

    const pending = readRunningDashboardBootGates(port, '/repo');
    await waitForRequests(1);
    await vi.advanceTimersByTimeAsync(2000);
    await waitForRequests(2);
    await vi.advanceTimersByTimeAsync(8000);
    const read = await pending;

    expect(read.gates).toBeNull();
    expect(read.reason).toContain('no answer within 8000ms');
    expect(requests).toBe(2);
  });
});
