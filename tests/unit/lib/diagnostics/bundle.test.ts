import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBundleDir,
  diagnosticsRoot,
  writeDiagnosticBundle,
  type BundleEntry,
  type CollectorFailure,
} from '../../../../src/lib/diagnostics/bundle.js';

const RUNTIME_SECRET = ['sk', 'ant', 'api03', 'Q'.repeat(40)].join('-');
const NOW = new Date('2026-11-01T04:44:53.027Z');

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'overdeck-diagnostics-bundle-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('diagnosticsRoot', () => {
  it('joins the given home with diagnostics', () => {
    expect(diagnosticsRoot('/home/op/.overdeck')).toBe('/home/op/.overdeck/diagnostics');
  });
});

describe('createBundleDir', () => {
  it('creates the stamp directory with mode 0700', async () => {
    const dir = await createBundleDir(root, NOW);
    expect(dir).toBe(join(root, '20261101T044453Z'));

    if (process.platform !== 'win32') {
      const info = await stat(dir);
      expect(info.mode & 0o777).toBe(0o700);
    }
  });

  it('suffixes a colliding stamp directory with -2, then -3', async () => {
    const first = await createBundleDir(root, NOW);
    const second = await createBundleDir(root, NOW);
    const third = await createBundleDir(root, NOW);

    expect(first).toBe(join(root, '20261101T044453Z'));
    expect(second).toBe(join(root, '20261101T044453Z-2'));
    expect(third).toBe(join(root, '20261101T044453Z-3'));
  });
});

describe('writeDiagnosticBundle', () => {
  function entries(home: string): BundleEntry[] {
    return [
      {
        path: 'config/config.yaml',
        content: `linear_api_key: ${RUNTIME_SECRET}\nenabled: true\n`,
        kind: 'config',
        description: 'Overdeck config',
      },
      {
        path: 'logs/dashboard.log',
        content: `auth failed, home is ${home}, secret was ${RUNTIME_SECRET}`,
        kind: 'text',
        description: 'Dashboard log tail',
      },
    ];
  }

  it('writes every entry with mode 0600, redacting secrets and the home path', async () => {
    const dir = await createBundleDir(root, NOW);
    const home = '/home/exampleuser';
    const failures: CollectorFailure[] = [];

    const result = await writeDiagnosticBundle({ dir, entries: entries(home), failures, now: NOW, home });

    expect(result.files).toHaveLength(2);
    for (const file of result.files) {
      const fullPath = join(dir, file.path);
      const content = await readFile(fullPath, 'utf-8');
      expect(content).not.toContain(RUNTIME_SECRET);
      expect(content).toContain('[REDACTED');
      expect(file.redactions).toBeGreaterThan(0);

      if (process.platform !== 'win32') {
        const info = await stat(fullPath);
        expect(info.mode & 0o777).toBe(0o600);
      }
    }

    const logContent = await readFile(join(dir, 'logs/dashboard.log'), 'utf-8');
    expect(logContent).not.toContain(home);
    expect(logContent).toContain('~');
  });

  it('writes a manifest listing each file with its byte count and redaction count, and the failures', async () => {
    const dir = await createBundleDir(root, NOW);
    const home = '/home/exampleuser';
    const failures: CollectorFailure[] = [{ source: 'environment.json', reason: 'fetch failed: ECONNREFUSED' }];

    const result = await writeDiagnosticBundle({ dir, entries: entries(home), failures, now: NOW, home });
    const manifest = await readFile(result.manifestPath, 'utf-8');

    expect(manifest).toContain('# Overdeck diagnostic bundle');
    expect(manifest).toContain('## Files');
    for (const file of result.files) {
      expect(manifest).toContain(`| ${file.path} | ${file.bytes} | ${file.redactions} |`);
    }
    expect(manifest).toContain('## Collection failures');
    expect(manifest).toContain('- environment.json: fetch failed: ECONNREFUSED');
    expect(manifest).toContain('## Not included');
    expect(manifest).toContain("Failed `pan` commands");

    if (process.platform !== 'win32') {
      const info = await stat(result.manifestPath);
      expect(info.mode & 0o777).toBe(0o600);
    }
  });

  it('writes "- none" under Collection failures when there are no failures', async () => {
    const dir = await createBundleDir(root, NOW);
    const result = await writeDiagnosticBundle({ dir, entries: [], failures: [], now: NOW });
    const manifest = await readFile(result.manifestPath, 'utf-8');
    expect(manifest).toContain('## Collection failures\n\n- none');
  });

  it('rejects an entry path containing a .. segment', async () => {
    const dir = await createBundleDir(root, NOW);
    const badEntries: BundleEntry[] = [
      { path: '../x', content: 'anything', kind: 'text', description: 'escape attempt' },
    ];

    await expect(
      writeDiagnosticBundle({ dir, entries: badEntries, failures: [], now: NOW }),
    ).rejects.toThrow(/\.\./);
  });

  it('rejects an absolute entry path', async () => {
    const dir = await createBundleDir(root, NOW);
    const badEntries: BundleEntry[] = [
      { path: '/etc/passwd', content: 'anything', kind: 'text', description: 'escape attempt' },
    ];

    await expect(
      writeDiagnosticBundle({ dir, entries: badEntries, failures: [], now: NOW }),
    ).rejects.toThrow(/relative/);
  });

  it('rejects an entry path equal to MANIFEST.md', async () => {
    const dir = await createBundleDir(root, NOW);
    const badEntries: BundleEntry[] = [
      { path: 'MANIFEST.md', content: 'anything', kind: 'text', description: 'collides with the writer' },
    ];

    await expect(
      writeDiagnosticBundle({ dir, entries: badEntries, failures: [], now: NOW }),
    ).rejects.toThrow(/MANIFEST\.md/);
  });
});
