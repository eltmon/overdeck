import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PROJECTS_CONFIG_FILE, invalidateProjectsConfigCache } from '../../../../src/lib/projects.js';
import { launchAgentPane } from '../../../../src/lib/terminal-backends/launch.js';
import type {
  AgentPaneRef,
  StartAgentSpec,
  TerminalBackend,
  WorkspaceRef,
} from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-5061 WI-8: launchAgentPane merges the launch project's secrets file into
 * the pane env, under Overdeck's own launch env. A launch of another project
 * never sees them. tests/setup/overdeck-home.ts points HOME and OVERDECK_HOME
 * at per-worker temp dirs, so projects.yaml and the secrets file live there.
 */

const ROOT = join(homedir(), 'pan-5061-launch-project-env');
const ALPHA_REPO = join(ROOT, 'alpha');
const BETA_REPO = join(ROOT, 'beta');

beforeEach(() => {
  mkdirSync(join(ALPHA_REPO, 'workspaces', 'feature-alp-1'), { recursive: true });
  mkdirSync(join(BETA_REPO, 'workspaces', 'feature-bet-1'), { recursive: true });
  writeFileSync(join(ROOT, 'alpha.env'), 'PAN5061_PROBE=alpha\n');
  writeFileSync(
    PROJECTS_CONFIG_FILE,
    `projects:\n` +
      `  alpha:\n    name: alpha\n    path: ${ALPHA_REPO}\n    issue_prefix: ALP\n` +
      `    workspace:\n      env:\n        secrets_file: ${join(ROOT, 'alpha.env')}\n` +
      `  beta:\n    name: beta\n    path: ${BETA_REPO}\n    issue_prefix: BET\n`,
  );
  invalidateProjectsConfigCache();
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(PROJECTS_CONFIG_FILE, { force: true });
  invalidateProjectsConfigCache();
});

function fakeBackend(onStart: (spec: StartAgentSpec) => void): TerminalBackend {
  const pane: AgentPaneRef = {
    backend: 'herdr',
    workspaceId: 'w1',
    paneId: 'w1:p1',
    terminalId: 'w1:p1',
    agentName: 'agent-x',
  };
  return {
    name: 'herdr',
    workspaceFor: (issueId: string, cwd: string) =>
      Effect.succeed({ backend: 'herdr', workspaceId: 'w1', issueId, cwd } as WorkspaceRef),
    startAgent: (_workspace: WorkspaceRef, spec: StartAgentSpec) => {
      onStart(spec);
      return Effect.succeed(pane);
    },
  } as unknown as TerminalBackend;
}

async function launchEnv(request: { issueId?: string; cwd: string; env?: Record<string, string> }) {
  let env: Readonly<Record<string, string>> | undefined;
  await launchAgentPane({
    issueId: request.issueId,
    cwd: request.cwd,
    agentId: 'agent-x',
    argv: ['bash', 'launcher.sh'],
    env: request.env ?? { OVERDECK_AGENT_ID: 'agent-x' },
    tokens: { role: 'work', harness: 'codex', model: 'gpt' },
  }, fakeBackend((spec) => { env = spec.env; }));
  return env!;
}

describe('launchAgentPane project secrets (PAN-5061 WI-8)', () => {
  it("gives a launch in project A's workspace A's secrets next to Overdeck's env", async () => {
    const env = await launchEnv({ cwd: join(ALPHA_REPO, 'workspaces', 'feature-alp-1') });
    expect(env).toEqual({ PAN5061_PROBE: 'alpha', OVERDECK_AGENT_ID: 'agent-x' });
  });

  it("gives a launch of project B none of A's secrets", async () => {
    const env = await launchEnv({ issueId: 'BET-1', cwd: join(BETA_REPO, 'workspaces', 'feature-bet-1') });
    expect(env).not.toHaveProperty('PAN5061_PROBE');
    expect(env).toEqual({ OVERDECK_AGENT_ID: 'agent-x' });
  });

  it("keeps the launch env's value when it sets the same key", async () => {
    const env = await launchEnv({ issueId: 'ALP-1', cwd: ALPHA_REPO, env: { PAN5061_PROBE: 'overdeck-wins' } });
    expect(env.PAN5061_PROBE).toBe('overdeck-wins');
  });
});
