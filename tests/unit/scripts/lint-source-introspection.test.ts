import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-source-introspection.sh', import.meta.url);
const READ_FILE_SYNC = 'read' + 'FileSync';
const TS = '.t' + 's';
const TSX = '.t' + 'sx';

function makeTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'lint-source-introspection-'));
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-source-introspection.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  writeFileSync(join(root, 'scripts', 'source-introspection-baseline.txt'), '');
  return scriptDest;
}

function writeTestFile(root: string, path: string, content: string): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

function sourceRead(path: string): string {
  return [
    "import { join } from 'node:path';",
    "import { readFileSync } from 'node:fs';",
    'const cwd = process.cwd();',
    `${READ_FILE_SYNC}(join(cwd, '${path}'), 'utf8');`,
    '',
  ].join('\n');
}

function multilineSourceRead(path: string): string {
  return [
    "import { readFileSync } from 'node:fs';",
    `${READ_FILE_SYNC}(`,
    `  '${path}',`,
    "  'utf8',",
    ');',
    '',
  ].join('\n');
}

function writeBaseline(root: string, entries: Array<[number, string]>): void {
  writeFileSync(
    join(root, 'scripts', 'source-introspection-baseline.txt'),
    entries.map(([count, path]) => `${count} ${path}`).join('\n') + '\n',
  );
}

function readBaseline(root: string): string {
  return readFileSync(join(root, 'scripts', 'source-introspection-baseline.txt'), 'utf-8');
}

function runLint(root: string, args: string[] = []): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-source-introspection.sh');
  const result = spawnSync('bash', [script, ...args], { cwd: root, encoding: 'utf-8' });
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].join('\n'),
  };
}

describe('lint-source-introspection.sh', () => {
  it('passes for a clean temp tree with an empty baseline', () => {
    const root = makeTempWorkspace();
    installScript(root);

    const { ok, output } = runLint(root);

    expect(ok).toBe(true);
    expect(output).toContain('source-introspection guard passed');
  });

  it('fails when a new single-line source read has no baseline entry', () => {
    const root = makeTempWorkspace();
    installScript(root);
    writeTestFile(root, 'tests/new-offender.test.ts', sourceRead(`src/foo${TS}`));

    const { ok, output } = runLint(root);

    expect(ok).toBe(false);
    expect(output).toContain('tests/new-offender.test.ts has 1 source-introspection read(s) but is not baselined');
  });

  it('detects a multi-line source read', () => {
    const root = makeTempWorkspace();
    installScript(root);
    writeTestFile(root, 'tests/multiline.test.ts', multilineSourceRead(`../foo${TSX}`));

    const { ok, output } = runLint(root);

    expect(ok).toBe(false);
    expect(output).toContain('tests/multiline.test.ts has 1 source-introspection read(s) but is not baselined');
  });

  it('reports a stale lowered count and ratchets it down with --update', () => {
    const root = makeTempWorkspace();
    installScript(root);
    writeTestFile(root, 'tests/shrunk.test.ts', sourceRead(`src/foo${TS}`));
    writeBaseline(root, [[2, 'tests/shrunk.test.ts']]);

    const check = runLint(root);
    const update = runLint(root, ['--update']);
    const after = runLint(root);

    expect(check.ok).toBe(false);
    expect(check.output).toContain('stale baseline: tests/shrunk.test.ts has 1 source-introspection read(s) but is baselined at 2');
    expect(update.ok).toBe(true);
    expect(update.output).toContain('source-introspection baseline updated: 1 lowered, 0 dropped, 0 unchanged');
    expect(readBaseline(root)).toBe('1 tests/shrunk.test.ts\n');
    expect(after.ok).toBe(true);
  });

  it('never raises counts or adds new files during --update', () => {
    const root = makeTempWorkspace();
    installScript(root);
    writeTestFile(
      root,
      'tests/grown.test.ts',
      [sourceRead(`src/foo${TS}`), sourceRead(`../bar${TSX}`)].join('\n'),
    );
    writeTestFile(root, 'tests/new.test.ts', sourceRead(`src/new${TS}`));
    writeBaseline(root, [[1, 'tests/grown.test.ts']]);

    const update = runLint(root, ['--update']);
    const check = runLint(root);

    expect(update.ok).toBe(true);
    expect(update.output).toContain('source-introspection baseline updated: 0 lowered, 0 dropped, 1 unchanged');
    expect(readBaseline(root)).toBe('1 tests/grown.test.ts\n');
    expect(check.ok).toBe(false);
    expect(check.output).toContain('tests/grown.test.ts has 2 source-introspection read(s) (baseline 1)');
    expect(check.output).toContain('tests/new.test.ts has 1 source-introspection read(s) but is not baselined');
  });
});
