import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/guard-flywheel-orchestrator-commit.sh', import.meta.url);
const HOOK_SOURCE = new URL('../../../.husky/pre-commit', import.meta.url);

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-flywheel-orchestrator-commit-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'panopticon-agent[bot]'], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'guard-flywheel-orchestrator-commit.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function installHook(root: string): void {
  installScript(root);
  mkdirSync(join(root, '.husky'), { recursive: true });
  writeFileSync(join(root, '.husky', 'pre-commit'), readFileSync(HOOK_SOURCE, 'utf-8'), {
    mode: 0o755,
  });
  execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: root });
}

function stageFile(root: string, path: string, contents = 'staged\n'): void {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents);
  execFileSync('git', ['add', path], { cwd: root });
}

function runGuard(root: string, env: Record<string, string | undefined> = {}): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'guard-flywheel-orchestrator-commit.sh');
  const nextEnv = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete nextEnv[key];
    }
  }

  try {
    const output = execFileSync('bash', [script], {
      cwd: root,
      encoding: 'utf-8',
      env: nextEnv,
    });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

describe('guard-flywheel-orchestrator-commit.sh', () => {
  it('blocks orchestrator-staged drafts and xbrief specs and names offending paths', () => {
    const root = makeTempRepo();
    installScript(root);
    stageFile(root, '.pan/drafts/PAN-1791.md');
    stageFile(root, '.pan/specs/PAN-1791.vbrief.json', '{}\n');

    const result = runGuard(root, {
      OVERDECK_AGENT_ID: 'flywheel-orchestrator',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('.pan/drafts/PAN-1791.md');
    expect(result.output).toContain('.pan/specs/PAN-1791.vbrief.json');
  });

  it('allows the orchestrator to stage only docs/FLYWHEEL-STATE.md', () => {
    const root = makeTempRepo();
    installScript(root);
    stageFile(root, 'docs/FLYWHEEL-STATE.md');

    const result = runGuard(root, {
      OVERDECK_AGENT_ID: 'flywheel-orchestrator',
    });

    expect(result.ok).toBe(true);
  });

  it('blocks orchestrator-staged source paths', () => {
    const root = makeTempRepo();
    installScript(root);
    stageFile(root, 'src/foo.ts', 'export const foo = true;\n');

    const result = runGuard(root, {
      OVERDECK_AGENT_ID: 'flywheel-orchestrator',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('src/foo.ts');
  });

  it('allows OVERDECK_OPERATOR_COMMIT=1 to land an otherwise-blocked source path', () => {
    const root = makeTempRepo();
    installScript(root);
    stageFile(root, 'src/lib/boot-gates.ts', 'export const x = true;\n');

    const result = runGuard(root, {
      OVERDECK_AGENT_ID: 'flywheel-orchestrator',
      OVERDECK_OPERATOR_COMMIT: '1',
    });

    expect(result.ok).toBe(true);
  });

  it('no-ops for non-orchestrator contexts', () => {
    const root = makeTempRepo();
    installScript(root);
    stageFile(root, '.pan/drafts/PAN-1791.md');

    expect(runGuard(root, { OVERDECK_AGENT_ID: undefined }).ok).toBe(true);
    expect(runGuard(root, { OVERDECK_AGENT_ID: 'agent-pan-2194' }).ok).toBe(true);
  });

  it('rejects git commit through the husky pre-commit hook for orchestrator source changes', () => {
    const root = makeTempRepo();
    installHook(root);
    stageFile(root, 'src/foo.ts', 'export const foo = true;\n');

    const result = (() => {
      try {
        const output = execFileSync('git', ['commit', '-m', 'test commit'], {
          cwd: root,
          encoding: 'utf-8',
          env: { ...process.env, OVERDECK_AGENT_ID: 'flywheel-orchestrator' },
        });
        return { ok: true, output };
      } catch (err: any) {
        return { ok: false, output: [err.stdout ?? '', err.stderr ?? ''].join('\n') };
      }
    })();

    expect(result.ok).toBe(false);
    expect(result.output).toContain('Refusing flywheel-orchestrator commit');
    expect(result.output).toContain('src/foo.ts');
  });
});
