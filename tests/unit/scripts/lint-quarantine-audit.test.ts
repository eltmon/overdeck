import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-quarantine-audit.sh', import.meta.url);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lint-quarantine-audit-'));
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-quarantine-audit.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function writeQuarantine(root: string, content: string): void {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'flaky-quarantine.txt'), content);
}

function runAudit(root: string): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-quarantine-audit.sh');
  try {
    const output = execFileSync('bash', [script], { cwd: root, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

describe('lint-quarantine-audit.sh', () => {
  it('passes and counts valid entries with tracker-issue refs', () => {
    const root = makeTempDir();
    installScript(root);
    writeQuarantine(
      root,
      'tests/foo.test.ts  # PAN-123\nsrc/bar.test.ts  # #456\n',
    );

    const result = runAudit(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('quarantine audit passed (2 entries validated)');
  });

  it('fails when an entry lacks an inline issue ref', () => {
    const root = makeTempDir();
    installScript(root);
    writeQuarantine(root, 'tests/foo.test.ts\n');

    const result = runAudit(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('tests/foo.test.ts');
    expect(result.output).toContain('lack an issue reference');
  });

  it('passes when the quarantine file is absent', () => {
    const root = makeTempDir();
    installScript(root);

    const result = runAudit(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('no quarantine file or file is empty');
  });

  it('passes when the quarantine file is empty', () => {
    const root = makeTempDir();
    installScript(root);
    writeQuarantine(root, '\n# only a comment\n');

    const result = runAudit(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('no quarantine file or file is empty');
  });

  it('ignores blank and comment lines', () => {
    const root = makeTempDir();
    installScript(root);
    writeQuarantine(
      root,
      '# header\n\ntests/foo.test.ts  # PAN-123\n\n# footer\n',
    );

    const result = runAudit(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('quarantine audit passed (1 entries validated)');
  });
});
