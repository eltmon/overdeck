/**
 * PAN-3189: work, strike and review agents are the agents the stash/rebase
 * rules exist for, yet their launchers were the only ones built without an
 * agent id — so `generateLauncherScriptSync` never emitted a git guard for
 * them and they ran behind whichever guard their spawner happened to have on
 * PATH. These tests lock the guard onto the fresh-spawn and resume paths of
 * `buildAgentLaunchConfig`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAgentLaunchConfig } from '../spawn-prep.js';

let home: string;
let workspace: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-3189-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-3189-ws-'));
  previousHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function expectGuardInstalled(launcherContent: string, agentId: string) {
  const guardDir = join(home, 'agents', agentId, 'git-guard');
  expect(launcherContent).toContain(`mkdir -p '${guardDir}'`);
  expect(launcherContent).toContain(`export PATH="${guardDir}:$PATH"`);
  // The guard must be scoped to this agent's own worktree.
  expect(launcherContent).toContain(`_OVERDECK_GUARD_ROOT="$(cd '${workspace}' 2>/dev/null && pwd -P)"`);
  // ...and must drop any guard dir inherited from the spawner.
  expect(launcherContent).toContain('[[ "$_overdeck_path_segment" == */git-guard ]] || _overdeck_kept_path+=("$_overdeck_path_segment")');
}

describe('buildAgentLaunchConfig git guard', () => {
  for (const role of ['work', 'review', 'test'] as const) {
    it(`installs the agent's own guard on a fresh ${role} spawn`, async () => {
      const agentId = `agent-pan-3189-${role}`;
      const { launcherContent } = await buildAgentLaunchConfig({
        agentId,
        model: 'claude-sonnet-4-6',
        workspace,
        role,
      });
      expectGuardInstalled(launcherContent, agentId);
    });
  }

  it('installs the guard on a resumed work agent', async () => {
    const agentId = 'agent-pan-3189-resume';
    const { launcherContent } = await buildAgentLaunchConfig({
      agentId,
      model: 'claude-sonnet-4-6',
      workspace,
      role: 'work',
      spawnMode: 'resume',
      resumeSessionId: 'sess-3189',
    });
    expectGuardInstalled(launcherContent, agentId);
  });
});
