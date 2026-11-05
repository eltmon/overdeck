import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findExecutableOnPath,
  panCliShimLauncherLines,
  renderPanCliShim,
  writePanCliShims,
} from '../../../src/lib/pan-cli-shim.js';

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

describe('renderPanCliShim', () => {
  it('renders the exact shim body for a plain node runtime', () => {
    expect(renderPanCliShim({ nodePath: '/n/node', root: '/r' })).toBe(
      "#!/bin/sh\nexec '/n/node' '/r/dist/cli/index.js' \"$@\"\n",
    );
  });

  it('adds the Electron export as the second line when electron is true', () => {
    const shim = renderPanCliShim({ nodePath: '/n/node', root: '/r', electron: true });
    const lines = shim.split('\n');
    expect(lines[0]).toBe('#!/bin/sh');
    expect(lines[1]).toBe('export ELECTRON_RUN_AS_NODE=1');
  });
});

describe('panCliShimLauncherLines', () => {
  function writeFakeBundle(root: string): void {
    const cliDir = join(root, 'dist', 'cli');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(
      join(cliDir, 'index.js'),
      "console.log(JSON.stringify(process.argv.slice(2)));\n",
    );
  }

  it('resolves pan to the shim and forwards arguments containing spaces unchanged', () => {
    const root = makeTempDir('pan-shim-root-');
    writeFakeBundle(root);
    const dir = join(makeTempDir('pan-shim-dir-'), 'cli-bin');

    const lines = panCliShimLauncherLines({ nodePath: process.execPath, root, dir });
    const script = `${lines.join('\n')}\ncommand -v pan\npan a "b c"\n`;

    const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });

    expect(result.status).toBe(0);
    const stdoutLines = result.stdout.trim().split('\n');
    expect(stdoutLines[0]).toBe(join(dir, 'pan'));
    expect(stdoutLines[1]).toBe(JSON.stringify(['a', 'b c']));
    const leftoverTmpFiles = readdirSync(dir).filter(name => name.includes('.tmp.'));
    expect(leftoverTmpFiles).toEqual([]);
  });

  it('exits 0 and leaves PATH untouched when the CLI bundle is missing', () => {
    const root = makeTempDir('pan-shim-missing-root-');
    const dir = join(makeTempDir('pan-shim-missing-dir-'), 'cli-bin');

    const lines = panCliShimLauncherLines({ nodePath: process.execPath, root, dir });
    const script = `${lines.join('\n')}\necho "$PATH"\n`;

    const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(dir);
    expect(existsSync(join(dir, 'pan'))).toBe(false);
  });
});

describe('writePanCliShims', () => {
  it('writes pan and overdeck with mode 0o755 and the rendered shim content', async () => {
    const root = makeTempDir('pan-shim-write-root-');
    const cliDir = join(root, 'dist', 'cli');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, 'index.js'), '');
    const dir = join(makeTempDir('pan-shim-write-dir-'), 'cli-bin');

    const runtime = { nodePath: process.execPath, root, dir };
    const result = await writePanCliShims(runtime);

    expect(result).toEqual({ status: 'written', dir });
    const expectedContent = renderPanCliShim(runtime);
    for (const name of ['pan', 'overdeck']) {
      const filePath = join(dir, name);
      expect(readFileSync(filePath, 'utf-8')).toBe(expectedContent);
      expect(statSync(filePath).mode & 0o777).toBe(0o755);
    }
  });

  it('returns missing-bundle and writes nothing when the bundle is absent', async () => {
    const root = makeTempDir('pan-shim-write-nobundle-root-');
    const dir = join(makeTempDir('pan-shim-write-nobundle-dir-'), 'cli-bin');

    const result = await writePanCliShims({ nodePath: process.execPath, root, dir });

    expect(result.status).toBe('missing-bundle');
    expect(existsSync(dir)).toBe(false);
  });
});

describe('findExecutableOnPath', () => {
  it('returns the first matching executable on PATH', () => {
    const result = findExecutableOnPath('pan', '/a::/b', {
      isExecutableFile: p => p === '/b/pan',
    });
    expect(result).toBe('/b/pan');
  });

  it('returns null when nothing on PATH matches', () => {
    const result = findExecutableOnPath('pan', '/a:/b', {
      isExecutableFile: () => false,
    });
    expect(result).toBeNull();
  });

  it('returns null when PATH is undefined', () => {
    expect(findExecutableOnPath('pan', undefined)).toBeNull();
  });
});
