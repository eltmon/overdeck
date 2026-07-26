import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-file-size.sh', import.meta.url);
const ALLOWLIST_SOURCE = new URL('../../../scripts/file-size-allowlist.txt', import.meta.url);

function makeTempRepo(setupBase?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-file-size-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  installScript(root);
  setupBase?.(root);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: root });
  execFileSync('git', ['update-ref', 'refs/heads/base', 'HEAD'], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-file-size.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  const allowlist = readFileSync(ALLOWLIST_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  writeFileSync(join(root, 'scripts', 'file-size-allowlist.txt'), allowlist);
  return scriptDest;
}

function writeLines(root: string, path: string, count: number): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, Array.from({ length: count }, (_, i) => `line ${i}`).join('\n') + '\n');
}

function writeAllowlist(root: string, rows: string[]): void {
  writeFileSync(
    join(root, 'scripts', 'file-size-allowlist.txt'),
    `# Audited growth exceptions: <lines> <path> # <ISSUE-REF>\n${rows.join('\n')}\n`,
  );
}

function runLint(root: string, baseRef = 'base'): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-file-size.sh');
  try {
    const output = execFileSync('bash', [script], {
      cwd: root,
      encoding: 'utf-8',
      env: { ...process.env, FILE_SIZE_BASE_REF: baseRef },
    });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

describe('lint-file-size.sh', () => {
  it('rejects a new god file with the allowlist remedy', () => {
    const root = makeTempRepo();
    writeLines(root, 'src/new-god-file.ts', 1001);

    const { ok, output } = runLint(root);

    expect(ok).toBe(false);
    expect(output).toContain('src/new-god-file.ts is 1001 lines (allowed 1000)');
    expect(output).toContain('1001 src/new-god-file.ts # <ISSUE-REF>');
  });

  it('accepts the base count and rejects growth past it', () => {
    const root = makeTempRepo((repo) => writeLines(repo, 'src/existing-god-file.ts', 1200));

    const unchanged = runLint(root);
    writeLines(root, 'src/existing-god-file.ts', 1201);
    const grown = runLint(root);

    expect(unchanged.ok).toBe(true);
    expect(unchanged.output).toContain('file-size guard passed');
    expect(grown.ok).toBe(false);
    expect(grown.output).toContain('src/existing-god-file.ts is 1201 lines (allowed 1200)');
  });

  it('permits audited growth only through the declared allowlist count', () => {
    const root = makeTempRepo((repo) => writeLines(repo, 'src/audited-growth.ts', 1200));
    writeAllowlist(root, ['1300 src/audited-growth.ts # PAN-3116']);
    writeLines(root, 'src/audited-growth.ts', 1300);

    const allowed = runLint(root);
    writeLines(root, 'src/audited-growth.ts', 1301);
    const exceeded = runLint(root);

    expect(allowed.ok).toBe(true);
    expect(exceeded.ok).toBe(false);
    expect(exceeded.output).toContain('src/audited-growth.ts is 1301 lines (allowed 1300)');
  });

  it('rejects malformed allowlist rows and names the line', () => {
    const root = makeTempRepo();
    writeAllowlist(root, ['1300 src/missing-issue-ref.ts']);

    const { ok, output } = runLint(root);

    expect(ok).toBe(false);
    expect(output).toContain('malformed scripts/file-size-allowlist.txt line 2');
    expect(output).toContain('expected: <lines> <path> # <ISSUE-REF>');
  });

  it('fails with an actionable message when the base ref is missing', () => {
    const root = makeTempRepo();

    const { ok, output } = runLint(root, 'missing-base');

    expect(ok).toBe(false);
    expect(output).toContain("cannot resolve base ref 'missing-base'");
    expect(output).toContain('Fetch the merge target');
    expect(output).toContain('FILE_SIZE_BASE_REF');
  });

  it('accepts a shrunk god file without baseline metadata', () => {
    const root = makeTempRepo((repo) => writeLines(repo, 'src/shrunk.ts', 1200));
    writeLines(root, 'src/shrunk.ts', 1100);

    const { ok, output } = runLint(root);

    expect(ok).toBe(true);
    expect(output).toContain('file-size guard passed');
    expect(existsSync(join(root, 'scripts', 'file-size-baseline.txt'))).toBe(false);
    // The guard must not REWRITE the allowlist — asserting a literal header
    // instead would fail the moment anyone lands an audited exception, which
    // is the very remedy the guard's own failure message prescribes.
    expect(readFileSync(join(root, 'scripts', 'file-size-allowlist.txt'), 'utf-8')).toBe(
      readFileSync(ALLOWLIST_SOURCE, 'utf-8'),
    );
  });
});
