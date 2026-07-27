import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-ratchet-audit.sh', import.meta.url);

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-ratchet-audit-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-ratchet-audit.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function writeFileSizeAllowlist(root: string, entries: Array<[number, string]>): void {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts', 'file-size-allowlist.txt'),
    entries.map(([lines, path]) => `${lines} ${path} # PAN-3116`).join('\n') + '\n',
  );
}

function writeEslintAllowlist(root: string, paths: string[]): void {
  writeFileSync(join(root, 'eslint-any-allowlist.json'), `${JSON.stringify(paths, null, 2)}\n`);
}

function writeCircularBaseline(root: string, cycles: string[]): void {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'circular-deps-baseline.txt'), `${cycles.join('\n')}\n`);
}

function commitAll(root: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', message, '--quiet'], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
}

function setupRepo(): string {
  const root = makeTempRepo();
  installScript(root);
  writeFileSizeAllowlist(root, [[1200, 'src/base.ts']]);
  writeEslintAllowlist(root, ['src/legacy.ts']);
  commitAll(root, 'initial PAN-0000');
  return root;
}

function runAudit(root: string, args: string[] = []): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-ratchet-audit.sh');
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

describe('lint-ratchet-audit.sh', () => {
  it('passes a file-size allowlist raise because the row carries its own issue ref', () => {
    const root = setupRepo();
    writeFileSizeAllowlist(root, [[1300, 'src/base.ts']]);
    commitAll(root, 'raise file-size allowance');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('also passes when a file-size allowlist raise commit carries an issue ref', () => {
    const root = setupRepo();
    writeFileSizeAllowlist(root, [[1300, 'src/base.ts']]);
    commitAll(root, 'raise file-size allowance PAN-123');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('fails or passes allowlist additions based on whether the commit has an issue ref', () => {
    const refLessRoot = setupRepo();
    writeEslintAllowlist(refLessRoot, ['src/legacy.ts', 'src/new-any.ts']);
    const badCommit = commitAll(refLessRoot, 'add any allowlist');

    const refLess = runAudit(refLessRoot, ['--range', 'HEAD~1..HEAD']);

    expect(refLess.ok).toBe(false);
    expect(refLess.output).toContain(badCommit.slice(0, 12));
    expect(refLess.output).toContain('allowlist added: src/new-any.ts');

    const refRoot = setupRepo();
    writeEslintAllowlist(refRoot, ['src/legacy.ts', 'src/new-any.ts']);
    commitAll(refRoot, 'add any allowlist #456');

    const withRef = runAudit(refRoot, ['--range', 'HEAD~1..HEAD']);

    expect(withRef.ok).toBe(true);
    expect(withRef.output).toContain('ratchet audit passed');
  });

  it('passes range mode for file-size allowlist lowerings and ESLint allowlist removals without issue refs', () => {
    const root = setupRepo();
    writeFileSizeAllowlist(root, [[1100, 'src/base.ts']]);
    writeEslintAllowlist(root, []);
    commitAll(root, 'lower ratchets');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('ignores malformed conflict-marker rows in the file-size allowlist', () => {
    const root = setupRepo();
    writeFileSync(
      join(root, 'scripts', 'file-size-allowlist.txt'),
      '1200 src/base.ts # PAN-3116\n<<<<<<< HEAD\n=======\n>>>>>>> feature/slot\n',
    );
    commitAll(root, 'accidental conflict markers');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('last-commit mode ignores file-size raises even when newer unrelated commits exist', () => {
    const root = setupRepo();
    writeFileSizeAllowlist(root, [[1300, 'src/base.ts']]);
    commitAll(root, 'raise file-size allowance');
    writeFileSync(join(root, 'README.md'), 'unrelated\n');
    commitAll(root, 'unrelated change');

    const result = runAudit(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('warns and passes when a root commit touches a ratchet file', () => {
    const root = makeTempRepo();
    installScript(root);
    writeFileSizeAllowlist(root, [[1200, 'src/base.ts']]);
    writeEslintAllowlist(root, ['src/legacy.ts']);
    const rootCommit = commitAll(root, 'root ratchet');

    const result = runAudit(root, ['--range', rootCommit]);

    expect(result.ok).toBe(true);
    expect(result.output).toContain(`cannot see parent of ${rootCommit.slice(0, 12)}`);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('passes when circular baseline entries only follow source-file renames', () => {
    const root = setupRepo();
    const oldDir = join(root, 'src', 'lib', 'vbrief');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, 'io.ts'), 'export const io = true;\n');
    writeFileSync(join(oldDir, 'vbrief-index.ts'), 'export const index = true;\n');
    writeCircularBaseline(root, [
      'src/lib/pan-dir/specs.ts > src/lib/vbrief/io.ts',
      'src/lib/pan-dir/specs.ts > src/lib/vbrief/vbrief-index.ts > src/lib/vbrief/io.ts',
    ]);
    commitAll(root, 'add existing cycles PAN-1');

    mkdirSync(join(root, 'src', 'lib', 'xbrief'), { recursive: true });
    execFileSync('git', ['mv', 'src/lib/vbrief/io.ts', 'src/lib/xbrief/io.ts'], { cwd: root });
    execFileSync(
      'git',
      ['mv', 'src/lib/vbrief/vbrief-index.ts', 'src/lib/xbrief/xbrief-index.ts'],
      { cwd: root },
    );
    commitAll(root, 'rename module PAN-2');

    writeCircularBaseline(root, [
      'src/lib/pan-dir/specs.ts > src/lib/xbrief/io.ts',
      'src/lib/pan-dir/specs.ts > src/lib/xbrief/xbrief-index.ts > src/lib/xbrief/io.ts',
    ]);
    commitAll(root, 'update cycle paths');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('rejects replacing a removed circular baseline entry with an unrelated cycle', () => {
    const root = setupRepo();
    writeCircularBaseline(root, ['src/old.ts > src/shared.ts']);
    commitAll(root, 'add existing cycle PAN-1');

    writeCircularBaseline(root, ['src/unrelated.ts > src/shared.ts']);
    const commit = commitAll(root, 'swap cycle');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(commit.slice(0, 12));
    expect(result.output).toContain('circular baseline added: src/unrelated.ts > src/shared.ts');
  });

  it('rejects a genuinely new circular baseline entry without an issue reference', () => {
    const root = setupRepo();
    writeCircularBaseline(root, ['src/existing.ts > src/shared.ts']);
    commitAll(root, 'add existing cycle PAN-1');

    writeCircularBaseline(root, [
      'src/existing.ts > src/shared.ts',
      'src/new.ts > src/shared.ts',
    ]);
    const commit = commitAll(root, 'add new cycle');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(commit.slice(0, 12));
    expect(result.output).toContain('circular baseline added: src/new.ts > src/shared.ts');
  });

  it('does not attribute already-main ratchet additions to a local merge commit', () => {
    const root = setupRepo();
    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: root });
    writeFileSync(join(root, 'README.md'), 'feature work\n');
    commitAll(root, 'feature work');

    execFileSync('git', ['checkout', 'master'], { cwd: root });
    writeEslintAllowlist(root, ['src/legacy.ts', 'src/main-added.ts']);
    const mainTip = commitAll(root, 'main adds allowlist');

    execFileSync('git', ['checkout', 'feature'], { cwd: root });
    execFileSync('git', ['merge', '--no-ff', 'master', '-m', 'merge main'], { cwd: root });

    const result = runAudit(root, ['--range', `${mainTip}..HEAD`]);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });
});
