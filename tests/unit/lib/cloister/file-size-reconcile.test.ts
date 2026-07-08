import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { reconcileFileSizeBaseline } from '../../../../src/lib/cloister/file-size-reconcile.js';

const execFileAsync = promisify(execFile);
const SCRIPT_SOURCE = new URL('../../../../scripts/lint-file-size.sh', import.meta.url);

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'file-size-reconcile-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function installScript(root: string): void {
  const scriptDest = join(root, 'scripts', 'lint-file-size.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  writeFileSync(join(root, 'scripts', 'file-size-baseline.txt'), '');
}

function writeLines(root: string, path: string, count: number): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, Array.from({ length: count }, (_, i) => `line ${i}`).join('\n') + '\n');
}

function writeBaseline(root: string, entries: Array<[number, string]>): void {
  writeFileSync(
    join(root, 'scripts', 'file-size-baseline.txt'),
    entries.map(([lines, path]) => `${lines} ${path}`).join('\n') + '\n',
  );
}

function readBaseline(root: string): string {
  return readFileSync(join(root, 'scripts', 'file-size-baseline.txt'), 'utf-8');
}

function commitAll(root: string): void {
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root });
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return { stdout };
}

async function status(root: string): Promise<string> {
  return (await runGit(['status', '--porcelain', '--', 'scripts/file-size-baseline.txt'], root)).stdout;
}

describe('reconcileFileSizeBaseline', () => {
  it('lowers a stale baseline entry and stages the baseline file', async () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/shrunk.ts', 1200);
    writeBaseline(root, [[1500, 'src/shrunk.ts']]);
    commitAll(root);

    writeLines(root, 'src/shrunk.ts', 1100);

    const result = await reconcileFileSizeBaseline(root, runGit);

    expect(result).toEqual({ changed: true });
    expect(readBaseline(root)).toBe('1100 src/shrunk.ts\n');
    expect(await status(root)).toBe('M  scripts/file-size-baseline.txt\n');
  });

  it('returns unchanged and stages nothing when the baseline already matches', async () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/current.ts', 1200);
    writeBaseline(root, [[1200, 'src/current.ts']]);
    commitAll(root);

    const result = await reconcileFileSizeBaseline(root, runGit);

    expect(result).toEqual({ changed: false });
    expect(readBaseline(root)).toBe('1200 src/current.ts\n');
    expect(await status(root)).toBe('');
  });

  it('drops deleted and sub-ceiling entries and stages the baseline file', async () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/small.ts', 999);
    writeBaseline(root, [
      [1400, 'src/deleted.ts'],
      [1200, 'src/small.ts'],
    ]);
    commitAll(root);

    const result = await reconcileFileSizeBaseline(root, runGit);

    expect(result).toEqual({ changed: true });
    expect(readBaseline(root)).toBe('');
    expect(await status(root)).toBe('M  scripts/file-size-baseline.txt\n');
  });
});
