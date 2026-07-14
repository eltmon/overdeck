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

function writeBaseline(root: string, entries: Array<[number, string]>): void {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts', 'file-size-baseline.txt'),
    entries.map(([lines, path]) => `${lines} ${path}`).join('\n') + '\n',
  );
}

function writeAllowlist(root: string, paths: string[]): void {
  writeFileSync(join(root, 'eslint-any-allowlist.json'), `${JSON.stringify(paths, null, 2)}\n`);
}

function commitAll(root: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', message, '--quiet'], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
}

function setupRepo(): string {
  const root = makeTempRepo();
  installScript(root);
  writeBaseline(root, [[1200, 'src/base.ts']]);
  writeAllowlist(root, ['src/legacy.ts']);
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
  it('fails range mode and names the commit when a baseline entry rises without an issue ref', () => {
    const root = setupRepo();
    writeBaseline(root, [[1300, 'src/base.ts']]);
    const commit = commitAll(root, 'raise baseline');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(commit.slice(0, 12));
    expect(result.output).toContain('baseline raised: src/base.ts 1200 -> 1300');
    expect(result.output).toContain('must reference an issue');
  });

  it('passes range mode when a baseline raise commit carries an issue ref', () => {
    const root = setupRepo();
    writeBaseline(root, [[1300, 'src/base.ts']]);
    commitAll(root, 'raise baseline PAN-123');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('fails or passes allowlist additions based on whether the commit has an issue ref', () => {
    const refLessRoot = setupRepo();
    writeAllowlist(refLessRoot, ['src/legacy.ts', 'src/new-any.ts']);
    const badCommit = commitAll(refLessRoot, 'add any allowlist');

    const refLess = runAudit(refLessRoot, ['--range', 'HEAD~1..HEAD']);

    expect(refLess.ok).toBe(false);
    expect(refLess.output).toContain(badCommit.slice(0, 12));
    expect(refLess.output).toContain('allowlist added: src/new-any.ts');

    const refRoot = setupRepo();
    writeAllowlist(refRoot, ['src/legacy.ts', 'src/new-any.ts']);
    commitAll(refRoot, 'add any allowlist #456');

    const withRef = runAudit(refRoot, ['--range', 'HEAD~1..HEAD']);

    expect(withRef.ok).toBe(true);
    expect(withRef.output).toContain('ratchet audit passed');
  });

  it('passes range mode for baseline lowerings and allowlist removals without issue refs', () => {
    const root = setupRepo();
    writeBaseline(root, [[1100, 'src/base.ts']]);
    writeAllowlist(root, []);
    commitAll(root, 'lower ratchets');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('ignores malformed conflict-marker rows in the baseline', () => {
    const root = setupRepo();
    writeFileSync(
      join(root, 'scripts', 'file-size-baseline.txt'),
      '1200 src/base.ts\n<<<<<<< HEAD\n=======\n>>>>>>> feature/slot\n',
    );
    commitAll(root, 'accidental conflict markers');

    const result = runAudit(root, ['--range', 'HEAD~1..HEAD']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('last-commit mode audits the newest ratchet commit even when newer unrelated commits exist', () => {
    const root = setupRepo();
    writeBaseline(root, [[1300, 'src/base.ts']]);
    const ratchetCommit = commitAll(root, 'raise baseline');
    writeFileSync(join(root, 'README.md'), 'unrelated\n');
    commitAll(root, 'unrelated change');

    const result = runAudit(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(ratchetCommit.slice(0, 12));
    expect(result.output).toContain('baseline raised: src/base.ts 1200 -> 1300');
  });

  it('warns and passes when a root commit touches a ratchet file', () => {
    const root = makeTempRepo();
    installScript(root);
    writeBaseline(root, [[1200, 'src/base.ts']]);
    writeAllowlist(root, ['src/legacy.ts']);
    const rootCommit = commitAll(root, 'root ratchet');

    const result = runAudit(root, ['--range', rootCommit]);

    expect(result.ok).toBe(true);
    expect(result.output).toContain(`cannot see parent of ${rootCommit.slice(0, 12)}`);
    expect(result.output).toContain('ratchet audit passed');
  });

  it('does not attribute already-main ratchet additions to a local merge commit', () => {
    const root = setupRepo();
    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: root });
    writeFileSync(join(root, 'README.md'), 'feature work\n');
    commitAll(root, 'feature work');

    execFileSync('git', ['checkout', 'master'], { cwd: root });
    writeAllowlist(root, ['src/legacy.ts', 'src/main-added.ts']);
    const mainTip = commitAll(root, 'main adds allowlist');

    execFileSync('git', ['checkout', 'feature'], { cwd: root });
    execFileSync('git', ['merge', '--no-ff', 'master', '-m', 'merge main'], { cwd: root });

    const result = runAudit(root, ['--range', `${mainTip}..HEAD`]);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ratchet audit passed');
  });
});
