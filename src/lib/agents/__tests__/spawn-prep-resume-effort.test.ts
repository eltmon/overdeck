import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAgentLaunchConfig } from '../spawn-prep.js';

let home: string;
let workspace: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4253-resume-effort-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-4253-resume-effort-ws-'));
  previousHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('buildAgentLaunchConfig resume effort injection (PAN-4253)', () => {
  it('injects opts.effort instead of the role frontmatter default', async () => {
    const { launcherContent } = await buildAgentLaunchConfig({
      agentId: 'agent-pan-4253-resume-max',
      model: 'claude-opus-5-5',
      workspace,
      role: 'work',
      spawnMode: 'resume',
      resumeSessionId: 'sess-4253',
      harness: 'claude-code',
      effort: 'max',
    });

    expect(launcherContent).toContain('--effort max');
    expect(launcherContent).not.toContain('--effort high');
  });

  it('falls back to the role frontmatter effort when opts.effort is not set', async () => {
    const { launcherContent } = await buildAgentLaunchConfig({
      agentId: 'agent-pan-4253-resume-default',
      model: 'claude-opus-5-5',
      workspace,
      role: 'work',
      spawnMode: 'resume',
      resumeSessionId: 'sess-4253-default',
      harness: 'claude-code',
    });

    expect(launcherContent).toContain('--effort high');
  });
});
