import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exec, loadConfigSync } = vi.hoisted(() => ({ exec: vi.fn(), loadConfigSync: vi.fn() }));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  exec,
}));
vi.mock('../../../lib/config.js', () => ({ loadConfigSync }));

import { checkTraefikPortBinding, classifyTraefikPorts } from '../doctor-traefik.js';

// Recorded from the planning host's live container (PAN-4299).
const EXPOSED = '0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp';
const LOOPBACK = '127.0.0.1:80->80/tcp, 127.0.0.1:443->443/tcp, 127.0.0.1:8080->8080/tcp';

describe('classifyTraefikPorts — PAN-4299', () => {
  it('errors when the container publishes on all interfaces and bind is unset', () => {
    expect(classifyTraefikPorts(EXPOSED, undefined)).toEqual({
      name: 'Traefik port binding',
      status: 'error',
      message: 'overdeck-traefik publishes on all interfaces; LAN clients can reach the dashboard',
      fix: 'Run: pan restart --traefik',
    });
  });

  it('errors on an IPv6-only all-interfaces binding', () => {
    expect(classifyTraefikPorts(':::443->443/tcp', 'loopback').status).toBe('error');
  });

  it('is ok when every port publishes on 127.0.0.1', () => {
    expect(classifyTraefikPorts(LOOPBACK, undefined)).toMatchObject({ status: 'ok', message: 'Published on 127.0.0.1 only' });
  });

  it('warns when the operator opted in with bind = "all"', () => {
    const result = classifyTraefikPorts(EXPOSED, 'all');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('traefik.bind = "all"');
  });
});

describe('checkTraefikPortBinding — PAN-4299', () => {
  beforeEach(() => {
    exec.mockReset();
    loadConfigSync.mockReset();
  });

  it('returns nothing and runs no docker command when Traefik is disabled', async () => {
    loadConfigSync.mockReturnValue({ traefik: { enabled: false } });
    await expect(checkTraefikPortBinding()).resolves.toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('classifies the live container ports', async () => {
    loadConfigSync.mockReturnValue({ traefik: { enabled: true } });
    exec.mockImplementation((_cmd: string, cb: (err: Error | null, out: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: `${EXPOSED}\n`, stderr: '' });
    });
    const results = await checkTraefikPortBinding();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'error', fix: 'Run: pan restart --traefik' });
    expect(exec.mock.calls[0][0]).toContain('name=overdeck-traefik');
  });

  it('returns nothing when docker is unavailable or the container is absent', async () => {
    loadConfigSync.mockReturnValue({ traefik: { enabled: true } });
    exec.mockImplementationOnce((_cmd: string, cb: (err: Error | null) => void) => cb(new Error('docker: not found')));
    await expect(checkTraefikPortBinding()).resolves.toEqual([]);
    exec.mockImplementationOnce((_cmd: string, cb: (err: Error | null, out: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '\n', stderr: '' });
    });
    await expect(checkTraefikPortBinding()).resolves.toEqual([]);
  });
});
