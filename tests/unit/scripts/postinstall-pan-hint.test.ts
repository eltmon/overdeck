/**
 * PAN-2630 (WI-6): scripts/postinstall.mjs hints at a missing `pan` on PATH
 * for a source checkout (one with src/ — npm packages never ship it).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const POSTINSTALL_SCRIPT = join(REPO_ROOT, 'scripts', 'postinstall.mjs');

let tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('postinstall.mjs — missing pan hint', () => {
  it('hints at the missing pan when nothing on PATH resolves it', () => {
    const home = makeTempDir('pan-hint-home-');
    // An empty dir, not the real node bin dir: this dev machine may have a
    // real `pan` symlink sitting right next to node on PATH.
    const emptyPathDir = makeTempDir('pan-hint-empty-path-');

    const result = spawnSync(process.execPath, [POSTINSTALL_SCRIPT], {
      encoding: 'utf-8',
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home, PATH: emptyPathDir },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pan is not on your PATH');
  });

  it('omits the hint when pan is already resolvable on PATH', () => {
    const home = makeTempDir('pan-hint-home-');
    const binDir = makeTempDir('pan-hint-bin-');
    writeFileSync(join(binDir, 'pan'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(binDir, 'pan'), 0o755);

    const result = spawnSync(process.execPath, [POSTINSTALL_SCRIPT], {
      encoding: 'utf-8',
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home, PATH: binDir },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('pan is not on your PATH');
  });
});
