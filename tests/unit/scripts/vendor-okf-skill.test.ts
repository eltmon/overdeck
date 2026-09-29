import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// PAN-4408: vendor-okf-skill.sh replaces sync-sources/skills/okf with a
// release tag's tree from eltmon/okf (minus repo-tooling paths) and can
// re-verify the destination against its recorded pin.
const SCRIPT_SOURCE = new URL('../../../scripts/vendor-okf-skill.sh', import.meta.url);
const tempRoots: string[] = [];

function runScript(cwd: string, args: string[]): { ok: boolean; status: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT_SOURCE.pathname, ...args], { cwd, encoding: 'utf-8' });
    return { ok: true, status: 0, output };
  } catch (error: any) {
    return {
      ok: false,
      status: typeof error.status === 'number' ? error.status : 1,
      output: [error.stdout ?? '', error.stderr ?? ''].join('\n'),
    };
  }
}

function buildFixtureTarball(root: string, opts: { withNotice: boolean } = { withNotice: true }): string {
  const srcDir = join(root, 'okf-0.1.0');
  mkdirSync(join(srcDir, 'scripts'), { recursive: true });
  mkdirSync(join(srcDir, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(srcDir, '.pan', 'drafts'), { recursive: true });
  mkdirSync(join(srcDir, 'tests'), { recursive: true });
  mkdirSync(join(srcDir, 'templates', 'repo', '.github', 'workflows'), { recursive: true });

  writeFileSync(join(srcDir, 'SKILL.md'), '# OKF Skill\n');
  writeFileSync(join(srcDir, 'LICENSE'), 'MIT License\n');
  if (opts.withNotice) {
    writeFileSync(join(srcDir, 'NOTICE'), 'OKF skill\n');
  }
  writeFileSync(join(srcDir, 'scripts', 'a.py'), '# a\n');
  writeFileSync(join(srcDir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  writeFileSync(join(srcDir, '.pan', 'drafts', 'x.md'), '# x\n');
  writeFileSync(join(srcDir, 'tests', 'test_x.py'), '# test\n');
  writeFileSync(join(srcDir, 'CHANGELOG.md'), '# changelog\n');
  writeFileSync(join(srcDir, 'templates', 'repo', '.github', 'workflows', 'conformance.yml'), 'name: conformance\n');
  writeFileSync(join(srcDir, 'templates', 'repo', '.gitignore'), 'node_modules\n');

  const tarball = join(root, 'okf-0.1.0.tar.gz');
  execFileSync('tar', ['-czf', tarball, 'okf-0.1.0'], { cwd: root });
  return tarball;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vendor-okf-skill-'));
  tempRoots.push(root);
  return root;
}

describe('vendor-okf-skill.sh', () => {
  it('exits 2 with usage on no args', () => {
    const root = makeRoot();
    const result = runScript(root, []);
    expect(result.status).toBe(2);
    expect(result.output).toContain('usage:');
  });

  it('exits 2 on a tag missing the v prefix', () => {
    const root = makeRoot();
    const result = runScript(root, ['0.1.0']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('usage:');
  });

  it('exits 2 on an unknown flag', () => {
    const root = makeRoot();
    const result = runScript(root, ['v0.1.0', '--bogus']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('usage:');
  });

  it('vendors a tag tarball into --dest, excluding repo tooling', () => {
    const root = makeRoot();
    const tarball = buildFixtureTarball(root);
    const dest = join(root, 'dest');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'stale.md'), 'stale\n');

    const result = runScript(root, ['v0.1.0', '--tarball', tarball, '--dest', dest]);

    expect(result.status).toBe(0);
    const pin = execFileSync('cat', [join(dest, '.okf-skill-version')], { encoding: 'utf-8' });
    expect(pin).toBe('v0.1.0\n');
    for (const present of [
      'LICENSE',
      'NOTICE',
      'SKILL.md',
      join('scripts', 'a.py'),
      join('templates', 'repo', '.github', 'workflows', 'conformance.yml'),
      join('templates', 'repo', '.gitignore'),
    ]) {
      expect(() => execFileSync('test', ['-e', join(dest, present)])).not.toThrow();
    }
    for (const absent of ['.github', '.pan', 'tests', 'CHANGELOG.md', 'stale.md']) {
      expect(() => execFileSync('test', ['-e', join(dest, absent)])).toThrow();
    }
  });

  it('exits 1 and leaves the destination unchanged when the tarball has no NOTICE', () => {
    const root = makeRoot();
    const tarball = buildFixtureTarball(root, { withNotice: false });
    const dest = join(root, 'dest');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'stale.md'), 'stale\n');

    const result = runScript(root, ['v0.1.0', '--tarball', tarball, '--dest', dest]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('NOTICE');
    expect(() => execFileSync('test', ['-e', join(dest, 'stale.md')])).not.toThrow();
  });

  it('--check exits 0 after a matching vendor', () => {
    const root = makeRoot();
    const tarball = buildFixtureTarball(root);
    const dest = join(root, 'dest');
    runScript(root, ['v0.1.0', '--tarball', tarball, '--dest', dest]);

    const result = runScript(root, ['--check', '--tarball', tarball, '--dest', dest]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('okf skill matches eltmon/okf v0.1.0');
  });

  it('--check exits 1 and names the drifted file after a local edit', () => {
    const root = makeRoot();
    const tarball = buildFixtureTarball(root);
    const dest = join(root, 'dest');
    runScript(root, ['v0.1.0', '--tarball', tarball, '--dest', dest]);
    appendFileSync(join(dest, 'SKILL.md'), 'extra line\n');

    const result = runScript(root, ['--check', '--tarball', tarball, '--dest', dest]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('SKILL.md');
  });

  it('--check exits 1 when the destination has no pin file', () => {
    const root = makeRoot();
    const dest = join(root, 'dest');
    mkdirSync(dest, { recursive: true });

    const result = runScript(root, ['--check', '--dest', dest]);

    expect(result.status).toBe(1);
  });
});
