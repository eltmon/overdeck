import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HELPER_SOURCE = new URL('../../../scripts/lib/pusher-identity.sh', import.meta.url);

const STRIPPED_VARS = [
  'OVERDECK_AGENT_ID',
  'OVERDECK_CONVERSATION',
  'OVERDECK_AGENT_STARTED_BY',
  'OVERDECK_OPERATOR_PUSH',
] as const;

function makeTempRepo(userName: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pusher-identity-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', userName], { cwd: root });
  const helperPath = join(root, 'pusher-identity.sh');
  writeFileSync(helperPath, readFileSync(HELPER_SOURCE, 'utf-8'), { mode: 0o755 });
  return root;
}

function runHelper(root: string, env: Record<string, string | undefined> = {}): boolean {
  const nextEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of STRIPPED_VARS) {
    delete nextEnv[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete nextEnv[key];
    } else {
      nextEnv[key] = value;
    }
  }

  try {
    execFileSync('bash', ['-c', 'source pusher-identity.sh; overdeck_pusher_is_agent'], {
      cwd: root,
      env: nextEnv,
    });
    return true;
  } catch {
    return false;
  }
}

describe('pusher-identity.sh', () => {
  it('treats a plain agent id as an agent', () => {
    const root = makeTempRepo('Human Operator');

    expect(runHelper(root, { OVERDECK_AGENT_ID: 'agent-pan-1' })).toBe(true);
  });

  it('treats an operator conversation (conv-*) as not an agent', () => {
    const root = makeTempRepo('overdeck-agent[bot]');

    expect(runHelper(root, { OVERDECK_AGENT_ID: 'conv-123' })).toBe(false);
  });

  it('treats OVERDECK_AGENT_ID=conv-flywheel as an agent, whatever the git identity', () => {
    const root = makeTempRepo('Human Operator');

    expect(runHelper(root, { OVERDECK_AGENT_ID: 'conv-flywheel' })).toBe(true);
  });

  it('treats OVERDECK_CONVERSATION=conv-flywheel with no agent id as an agent', () => {
    const root = makeTempRepo('Human Operator');

    expect(runHelper(root, { OVERDECK_AGENT_ID: undefined, OVERDECK_CONVERSATION: 'conv-flywheel' })).toBe(true);
  });

  it('treats a flywheel-started OVERDECK_AGENT_STARTED_BY as an agent, overriding a conv-* exemption', () => {
    const root = makeTempRepo('Human Operator');

    expect(
      runHelper(root, {
        OVERDECK_AGENT_ID: 'conv-123',
        OVERDECK_AGENT_STARTED_BY: 'flywheel:conv-flywheel',
      }),
    ).toBe(true);
  });

  it('treats a [bot] git identity with no Overdeck env as an agent', () => {
    const root = makeTempRepo('overdeck-agent[bot]');

    expect(runHelper(root)).toBe(true);
  });

  it('treats a human git identity with no Overdeck env as not an agent', () => {
    const root = makeTempRepo('Human Operator');

    expect(runHelper(root)).toBe(false);
  });
});
