import { describe, it, expect, vi } from 'vitest';

import { startTraefikContainer } from '../traefik-start.js';

const TRAEFIK_DIR = '/home/user/.overdeck/traefik';

describe('startTraefikContainer — pan dev (skipWhenRunning: false)', () => {
  it('runs docker compose up -d in traefikDir when the migration throws', async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const migrate = vi.fn(() => {
      throw new Error('EACCES');
    });
    const exec = vi.fn(async (command: string, cwd: string) => {
      calls.push(`exec:${command}:${cwd}`);
      return { stdout: '' };
    });
    const log = vi.fn((line: string) => logs.push(line));

    const result = await startTraefikContainer(TRAEFIK_DIR, { skipWhenRunning: false }, { migrate, exec, log });

    expect(result).toBe('started');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('docker compose up -d', TRAEFIK_DIR);
    expect(logs.some((line) => line.includes('Traefik compose migration failed: EACCES'))).toBe(true);
  });

  it('migrates <traefikDir>/docker-compose.yml before any docker command', async () => {
    const calls: string[] = [];
    const migrate = vi.fn((composePath: string) => {
      calls.push(`migrate:${composePath}`);
      return false;
    });
    const exec = vi.fn(async (command: string) => {
      calls.push(`exec:${command}`);
      return { stdout: '' };
    });

    await startTraefikContainer(TRAEFIK_DIR, { skipWhenRunning: false }, { migrate, exec, log: vi.fn() });

    expect(calls).toEqual([`migrate:${TRAEFIK_DIR}/docker-compose.yml`, 'exec:docker compose up -d']);
  });

  it('returns failed and does not reject when docker compose up -d fails', async () => {
    const migrate = vi.fn(() => false);
    const exec = vi.fn(async () => {
      throw new Error('docker not running');
    });

    const result = await startTraefikContainer(TRAEFIK_DIR, { skipWhenRunning: false }, { migrate, exec, log: vi.fn() });

    expect(result).toBe('failed');
  });
});
