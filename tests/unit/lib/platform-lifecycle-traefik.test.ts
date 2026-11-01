/**
 * PAN-4299: startTraefik migrates the compose file (ports on the configured
 * bind address) before `docker compose up -d`, and a failed migration never
 * blocks the start.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls: string[] = [];

const { migrateTraefikCompose } = vi.hoisted(() => ({ migrateTraefikCompose: vi.fn() }));

vi.mock('../../../src/lib/traefik.js', () => ({ migrateTraefikCompose }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const exec = (cmd: string, opts: unknown, cb?: (err: Error | null, out: { stdout: string; stderr: string }) => void) => {
    const callback = typeof opts === 'function' ? (opts as typeof cb) : cb;
    calls.push(`exec:${cmd}`);
    callback?.(null, { stdout: '', stderr: '' });
  };
  return { ...actual, exec };
});

import { startTraefik } from '../../../src/lib/platform-lifecycle.js';

describe('startTraefik compose migration — PAN-4299', () => {
  let traefikDir: string;

  beforeEach(() => {
    traefikDir = mkdtempSync(join(tmpdir(), 'pan-lifecycle-traefik-'));
    calls.length = 0;
    migrateTraefikCompose.mockReset();
  });

  afterEach(() => {
    rmSync(traefikDir, { recursive: true, force: true });
  });

  const config = () => ({
    dashboardPort: 43990,
    dashboardApiPort: 43991,
    traefikEnabled: true,
    traefikDomain: 'overdeck.localhost',
    traefikDir,
  });

  it('migrates <traefikDir>/docker-compose.yml before docker compose up -d', async () => {
    migrateTraefikCompose.mockImplementation((path: string) => {
      calls.push(`migrate:${path}`);
      return true;
    });

    await startTraefik(config());

    expect(calls).toEqual([
      `migrate:${join(traefikDir, 'docker-compose.yml')}`,
      'exec:docker compose up -d',
    ]);
  });

  it('still runs docker compose up -d when the migration throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    migrateTraefikCompose.mockImplementation(() => {
      throw new Error('EACCES');
    });

    await expect(startTraefik(config())).resolves.toBeUndefined();

    expect(calls).toEqual(['exec:docker compose up -d']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
    warn.mockRestore();
  });

  it('does not migrate when Traefik is disabled', async () => {
    await startTraefik({ ...config(), traefikEnabled: false });

    expect(migrateTraefikCompose).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
