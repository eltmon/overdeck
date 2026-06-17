import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-overdeck-boundaries.sh', import.meta.url);

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-overdeck-boundaries-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-overdeck-boundaries.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function commitAll(root: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture', '--quiet'], { cwd: root });
}

function runLint(root: string, strict = true): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-overdeck-boundaries.sh');
  try {
    const output = execFileSync('bash', [script], {
      cwd: root,
      encoding: 'utf-8',
      env: { ...process.env, PAN_OVERDECK_BOUNDARY_LINT: strict ? '1' : '0' },
    });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

describe('lint-overdeck-boundaries.sh', () => {
  it('stays wired into lint but gated off until cutover', () => {
    const root = makeTempRepo();
    installScript(root);
    mkdirSync(join(root, 'src', 'dashboard', 'server', 'routes'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'dashboard', 'server', 'routes', 'issues.ts'),
      `import { Db } from '../../../lib/overdeck/infra.js';\nexport const route = Db;\n`,
    );
    commitAll(root);

    const { ok, output } = runLint(root, false);
    expect(ok).toBe(true);
    expect(output).toContain('strict enforcement disabled until ci-guard-on');
  });

  it('fails strict mode when a route imports the Db handle directly', () => {
    const root = makeTempRepo();
    installScript(root);
    mkdirSync(join(root, 'src', 'dashboard', 'server', 'routes'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'dashboard', 'server', 'routes', 'issues.ts'),
      `import { Db } from '../../../lib/overdeck/infra.js';\nexport const route = Db;\n`,
    );
    commitAll(root);

    const { ok, output } = runLint(root);
    expect(ok).toBe(false);
    expect(output).toContain('overdeck import-boundary violation');
    expect(output).toContain('routes/issues.ts');
  });

  it('passes strict mode when route code imports only resolver and writer services', () => {
    const root = makeTempRepo();
    installScript(root);
    mkdirSync(join(root, 'src', 'dashboard', 'server', 'routes'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'dashboard', 'server', 'routes', 'issues.ts'),
      `import { IssuesResolver, IssueWriter } from '../../../lib/overdeck/issues.js';\nexport const route = { IssuesResolver, IssueWriter };\n`,
    );
    commitAll(root);

    const { ok, output } = runLint(root);
    expect(ok).toBe(true);
    expect(output).toContain('overdeck import-boundary lint passed');
  });
});
