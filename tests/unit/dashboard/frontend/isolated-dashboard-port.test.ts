import { describe, expect, it, vi } from 'vitest';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

import {
  isAddressInUseOutput,
  pickPort,
  waitForHealth,
} from '../../../../src/dashboard/frontend/tests/fixtures/isolated-dashboard';

/** Resolves once a fresh net server binds `port`; rejects on bind error. Always closes. */
async function assertBindable(port: number): Promise<void> {
  const server = createNetServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => resolve());
    });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

describe('pickPort', () => {
  it('returns a port that net.createServer().listen(port) accepts', async () => {
    const port = await pickPort();
    await expect(assertBindable(port)).resolves.toBeUndefined();
  });

  it('never returns the host dashboard port 3011', async () => {
    const probe = vi.fn<() => Promise<number>>().mockResolvedValueOnce(3011).mockResolvedValueOnce(45123);
    const port = await pickPort({ probe });
    expect(port).toBe(45123);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('throws after five probes that all return 3011', async () => {
    const probe = vi.fn<() => Promise<number>>().mockResolvedValue(3011);
    await expect(pickPort({ probe })).rejects.toThrow(/no usable free port/);
    expect(probe).toHaveBeenCalledTimes(5);
  });

  it('skips an excluded port', async () => {
    const probe = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(45123)
      .mockResolvedValueOnce(45123)
      .mockResolvedValueOnce(45200);
    const port = await pickPort({ probe, exclude: [45123] });
    expect(port).toBe(45200);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('parallel calls each return a bindable port', async () => {
    const ports = await Promise.all(Array.from({ length: 8 }, () => pickPort()));
    for (const port of ports) {
      await assertBindable(port);
    }
  });
});

describe('isAddressInUseOutput', () => {
  it('recognizes only the fatal bind line', () => {
    expect(isAddressInUseOutput('Error: listen EADDRINUSE: address already in use 0.0.0.0:39366')).toBe(true);
    expect(
      isAddressInUseOutput(
        '[overdeck] HTTP bind failed with EADDRINUSE; retry 1/3 in 250ms\nFixture dashboard did not become healthy.',
      ),
    ).toBe(false);
  });
});

describe('waitForHealth', () => {
  it('ignores a healthy response from a different process', async () => {
    const fakeChild: { pid: number; exitCode: number | null } = { pid: 4242, exitCode: null };
    const server = createHttpServer((req, res) => {
      if (req.url === '/api/health') {
        fakeChild.exitCode = 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ pid: 1 }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      await expect(
        waitForHealth(`http://127.0.0.1:${port}`, fakeChild, { pollMs: 10, timeoutMs: 5_000 }),
      ).rejects.toThrow(/exited early \(code 1\)/);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('resolves when the health pid matches the child', async () => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ pid: 4242 }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      await expect(
        waitForHealth(`http://127.0.0.1:${port}`, { pid: 4242, exitCode: null }, { pollMs: 10, timeoutMs: 5_000 }),
      ).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
