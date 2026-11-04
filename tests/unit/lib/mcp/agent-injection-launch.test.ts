/**
 * PAN-4932 W-6: `buildAgentLaunchConfig` gives a Claude Code work agent the
 * overdeck MCP server on both the fresh and the resume path, mints its 0600
 * token file, keeps the token out of the launcher, and skips Docker workspaces.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests } from '../../../../src/lib/access-tokens.js';
import { buildAgentLaunchConfig } from '../../../../src/lib/agents/spawn-prep.js';

let home: string;
let workspace: string;
let previousHome: string | undefined;
let previousDocker: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4932-launch-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-4932-launch-ws-'));
  previousHome = process.env.OVERDECK_HOME;
  previousDocker = process.env.OVERDECK_DOCKER_WORKSPACE;
  process.env.OVERDECK_HOME = home;
  delete process.env.OVERDECK_DOCKER_WORKSPACE;
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  if (previousDocker === undefined) delete process.env.OVERDECK_DOCKER_WORKSPACE;
  else process.env.OVERDECK_DOCKER_WORKSPACE = previousDocker;
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function expectOverdeckMcp(launcherContent: string, agentId: string) {
  const dir = join(home, 'agents', agentId);
  expect(launcherContent).toContain(`--mcp-config='${join(dir, 'overdeck-mcp.json')}'`);
  expect(launcherContent).toContain('--allowedTools=mcp__overdeck');
  expect(launcherContent).not.toContain('odk_');
  expect(statSync(join(dir, 'mcp-token')).mode & 0o777).toBe(0o600);
}

describe('buildAgentLaunchConfig overdeck MCP (PAN-4932)', () => {
  it('injects the server into a fresh work launch', async () => {
    const agentId = 'agent-pan-4932-fresh';
    const { launcherContent } = await buildAgentLaunchConfig({ agentId, model: 'claude-sonnet-4-6', workspace, role: 'work' });
    expectOverdeckMcp(launcherContent, agentId);
  });

  it('injects the server into a resumed work launch', async () => {
    const agentId = 'agent-pan-4932-resume';
    const { launcherContent } = await buildAgentLaunchConfig({
      agentId,
      model: 'claude-sonnet-4-6',
      workspace,
      role: 'work',
      spawnMode: 'resume',
      resumeSessionId: 'sess-4932',
    });
    expectOverdeckMcp(launcherContent, agentId);
  });

  it('skips the server in a Docker workspace', async () => {
    process.env.OVERDECK_DOCKER_WORKSPACE = '1';
    const { launcherContent } = await buildAgentLaunchConfig({ agentId: 'agent-pan-4932-docker', model: 'claude-sonnet-4-6', workspace, role: 'work' });
    expect(launcherContent).not.toContain('--mcp-config=');
  });
});
