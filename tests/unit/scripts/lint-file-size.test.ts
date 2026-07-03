import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-file-size.sh', import.meta.url);

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-file-size-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-file-size.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  writeFileSync(join(root, 'scripts', 'file-size-baseline.txt'), '');
  return scriptDest;
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

function runLint(root: string, args: string[] = []): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-file-size.sh');
  try {
    const output = execFileSync('bash', [script, ...args], { cwd: root, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

describe('lint-file-size.sh', () => {
  it('fails when a new src file exceeds the ceiling without a baseline entry', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/new-god-file.ts', 1001);

    const { ok, output } = runLint(root);

    expect(ok).toBe(false);
    expect(output).toContain('src/new-god-file.ts is 1001 lines (> 1000)');
  });

  it('fails when a baselined file grows above its entry', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/grown.ts', 1201);
    writeBaseline(root, [[1200, 'src/grown.ts']]);

    const { ok, output } = runLint(root);

    expect(ok).toBe(false);
    expect(output).toContain('src/grown.ts grew to 1201 lines (baseline 1200)');
    expect(output).toContain('god files must shrink, not grow');
  });

  it('fails with an update hint when a baselined file shrinks but stays over the ceiling', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/shrunk.ts', 1200);
    writeBaseline(root, [[1500, 'src/shrunk.ts']]);

    const { ok, output } = runLint(root);

    expect(ok).toBe(false);
    expect(output).toContain('stale baseline: src/shrunk.ts is 1200 lines but baselined at 1500');
    expect(output).toContain('bash scripts/lint-file-size.sh --update');
  });

  it('lowers a stale entry with --update and then passes check mode', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/shrunk.ts', 1200);
    writeBaseline(root, [[1500, 'src/shrunk.ts']]);

    const update = runLint(root, ['--update']);
    const check = runLint(root);

    expect(update.ok).toBe(true);
    expect(update.output).toContain('baseline updated: 1 lowered, 0 dropped, 0 unchanged');
    expect(readBaseline(root)).toBe('1200 src/shrunk.ts\n');
    expect(check.ok).toBe(true);
    expect(check.output).toContain('file-size guard passed');
  });

  it('drops deleted and sub-ceiling entries with --update and then passes check mode', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/small.ts', 999);
    writeBaseline(root, [
      [1400, 'src/deleted.ts'],
      [1200, 'src/small.ts'],
    ]);

    const update = runLint(root, ['--update']);
    const check = runLint(root);

    expect(update.ok).toBe(true);
    expect(update.output).toContain('baseline updated: 0 lowered, 2 dropped, 0 unchanged');
    expect(readBaseline(root)).toBe('');
    expect(check.ok).toBe(true);
    expect(check.output).toContain('file-size guard passed');
  });

  it('never raises a violation entry during --update and check mode still fails', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/grown.ts', 1200);
    writeBaseline(root, [[1100, 'src/grown.ts']]);

    const update = runLint(root, ['--update']);
    const check = runLint(root);

    expect(update.ok).toBe(true);
    expect(update.output).toContain('baseline updated: 0 lowered, 0 dropped, 1 unchanged');
    expect(readBaseline(root)).toBe('1100 src/grown.ts\n');
    expect(check.ok).toBe(false);
    expect(check.output).toContain('src/grown.ts grew to 1200 lines (baseline 1100)');
  });
});
