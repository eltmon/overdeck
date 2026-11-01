import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const fsControl = vi.hoisted(() => ({ failWrite: false, failRename: false }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      const [path] = args;
      if (fsControl.failWrite && typeof path === 'string' && path.endsWith('.tmp')) {
        actual.writeFileSync(path, 'partial', 'utf-8');
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      return actual.writeFileSync(...args);
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsControl.failRename) throw Object.assign(new Error('rename blocked'), { code: 'EACCES' });
      return actual.renameSync(...args);
    },
  };
});

describe('migrateTraefikCompose atomic write — PAN-4672', () => {
  let tempDir: string;
  let originalOverdeckHome: string | undefined;

  const legacyCompose = [
    'services:',
    '  traefik:',
    '    ports:',
    '      - "80:80"       # HTTP (redirects to HTTPS)',
    '      - "443:443"     # HTTPS',
    '      - "8080:8080"   # Traefik Dashboard',
    '      - "8443:443"',
    '      - "3000:3000"',
    'networks:',
    '  overdeck:',
    '    name: overdeck',
    '    driver: bridge',
    '',
  ].join('\n');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-traefik-atomic-test-'));
    originalOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = tempDir;
    fsControl.failWrite = false;
    fsControl.failRename = false;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    fsControl.failWrite = false;
    fsControl.failRename = false;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function listTmpEntries(dir: string): string[] {
    return readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  }

  it('ac1: migrates successfully and leaves no .tmp file behind', async () => {
    writeFileSync(join(tempDir, 'config.toml'), '[traefik]\nenabled = true\nbind = "all"\n');
    const composePath = join(tempDir, 'docker-compose.yml');
    writeFileSync(composePath, legacyCompose);
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');

    expect(migrateTraefikCompose(composePath)).toBe(true);
    expect(readFileSync(composePath, 'utf-8')).toContain('0.0.0.0:80:80');
    expect(listTmpEntries(tempDir)).toEqual([]);
  });

  it('ac2: keeps the original file byte-identical when the temp write fails', async () => {
    writeFileSync(join(tempDir, 'config.toml'), '[traefik]\nenabled = true\nbind = "all"\n');
    const composePath = join(tempDir, 'docker-compose.yml');
    writeFileSync(composePath, legacyCompose);
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');

    fsControl.failWrite = true;

    expect(() => migrateTraefikCompose(composePath)).toThrow('disk full');
    expect(readFileSync(composePath, 'utf-8')).toBe(legacyCompose);
    expect(listTmpEntries(tempDir)).toEqual([]);
  });

  it('ac3: keeps the original file byte-identical when the rename fails', async () => {
    writeFileSync(join(tempDir, 'config.toml'), '[traefik]\nenabled = true\nbind = "all"\n');
    const composePath = join(tempDir, 'docker-compose.yml');
    writeFileSync(composePath, legacyCompose);
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');

    fsControl.failRename = true;

    expect(() => migrateTraefikCompose(composePath)).toThrow('rename blocked');
    expect(readFileSync(composePath, 'utf-8')).toBe(legacyCompose);
    expect(listTmpEntries(tempDir)).toEqual([]);
  });

  it('ac4: preserves the original file mode under a restrictive umask', async () => {
    writeFileSync(join(tempDir, 'config.toml'), '[traefik]\nenabled = true\nbind = "all"\n');
    const composePath = join(tempDir, 'docker-compose.yml');
    writeFileSync(composePath, legacyCompose);
    chmodSync(composePath, 0o640);
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');

    const previousUmask = process.umask(0o077);
    try {
      expect(migrateTraefikCompose(composePath)).toBe(true);
      expect(statSync(composePath).mode & 0o777).toBe(0o640);
    } finally {
      process.umask(previousUmask);
    }
  });
});
