import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/guard-agent-main-push.sh', import.meta.url);

function makeTempRepo(userName = 'panopticon-agent[bot]'): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-agent-main-push-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', userName], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'guard-agent-main-push.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function commitAll(root: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', message, '--quiet'], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
}

function setupRepo(userName?: string): { root: string; base: string } {
  const root = makeTempRepo(userName);
  installScript(root);
  writeFileSync(join(root, 'README.md'), 'base\n');
  const base = commitAll(root, 'base PAN-0000');
  return { root, base };
}

function runGuard(
  root: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'guard-agent-main-push.sh');
  const nextEnv = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete nextEnv[key];
    }
  }

  try {
    const output = execFileSync('bash', [script, ...args], {
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

describe('guard-agent-main-push.sh', () => {
  it('blocks agent-context ranges touching src and names pan done plus the escape hatch', () => {
    const { root, base } = setupRepo();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'code.ts'), 'export const code = true;\n');
    const head = commitAll(root, 'code change');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'agent-pan-2227',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('pan done');
    expect(result.output).toContain('OVERDECK_OPERATOR_PUSH=1');
    expect(result.output).toContain('src/code.ts');
  });

  it('allows agent-context ranges touching only state-plane paths', () => {
    const { root, base } = setupRepo();
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    mkdirSync(join(root, '.tasks'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'pan-2227.json'), '{}\n');
    writeFileSync(join(root, '.tasks', 'state.json'), '{}\n');
    const head = commitAll(root, 'state sync');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'agent-pan-2227',
    });

    expect(result.ok).toBe(true);
  });

  it('blocks flywheel-orchestrator ranges touching artifact paths and names them', () => {
    const { root, base } = setupRepo();
    mkdirSync(join(root, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(root, '.pan', 'specs', 'x.vbrief.json'), '{}\n');
    const head = commitAll(root, 'vbrief artifact');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'flywheel-orchestrator',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('flywheel-orchestrator');
    expect(result.output).toContain('.pan/specs/x.vbrief.json');
  });

  it('allows flywheel-orchestrator ranges touching only flywheel state', () => {
    const { root, base } = setupRepo();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'FLYWHEEL-STATE.md'), 'tick\n');
    const head = commitAll(root, 'flywheel state');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'flywheel-orchestrator',
    });

    expect(result.ok).toBe(true);
  });

  it('allows conversation-context (conv-*) ranges touching src without the operator escape hatch', () => {
    const { root, base } = setupRepo();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'code.ts'), 'export const code = true;\n');
    const head = commitAll(root, 'code change');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'conv-20260708-3490',
    });

    expect(result.ok).toBe(true);
  });

  it('still blocks a non-conversation agent id that merely contains "conv" mid-string', () => {
    const { root, base } = setupRepo();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'code.ts'), 'export const code = true;\n');
    const head = commitAll(root, 'code change');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'agent-reconvene-2227',
    });

    expect(result.ok).toBe(false);
  });

  it('allows operator escape-hatch ranges even when code paths changed', () => {
    const { root, base } = setupRepo();
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'new-tool.sh'), '#!/bin/sh\n');
    const head = commitAll(root, 'script change');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'agent-pan-2227',
      OVERDECK_OPERATOR_PUSH: '1',
    });

    expect(result.ok).toBe(true);
  });

  it('allows code paths in a non-agent context', () => {
    const { root, base } = setupRepo('Human Operator');
    mkdirSync(join(root, 'roles'), { recursive: true });
    writeFileSync(join(root, 'roles', 'work.md'), 'human edit\n');
    const head = commitAll(root, 'role change');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: undefined,
    });

    expect(result.ok).toBe(true);
  });

  it('fails closed for an empty range argument', () => {
    const { root } = setupRepo();

    const result = runGuard(root, ['--range', ''], {
      OVERDECK_AGENT_ID: 'agent-pan-2227',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('missing push range');
    expect(result.output).toContain('trust gate');
  });
});
