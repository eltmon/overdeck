/**
 * PAN-5062 WI-5: the launcher exports the opted-in workspace .env, unless
 * spawnMode is 'remote' (a remote workspace never gets a local .env read).
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const workspaceEnvLauncherLinesMock = vi.hoisted(() => vi.fn());

vi.mock('../workspace-env.js', () => ({
  workspaceEnvLauncherLines: workspaceEnvLauncherLinesMock,
}));

import { generateLauncherScript, type LauncherConfig } from '../launcher-generator.js';

let tempHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-launcher-workspace-env-test-'));
  prevHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspaceEnvLauncherLinesMock.mockReset();
  workspaceEnvLauncherLinesMock.mockReturnValue(["export DBT_SCHEMA='dev_pan_1'"]);
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

const DEFAULT_CONFIG: LauncherConfig = {
  role: 'work',
  workingDir: '/workspace/project',
  overdeckEnv: { agentId: 'agent-pan-5062' },
};

describe('generateLauncherScript workspace .env export (PAN-5062)', () => {
  it('includes the workspaceEnvLauncherLines export after SKIP_DOCS_INDEX and before OVERDECK_AGENT_ID', () => {
    const script = generateLauncherScript(DEFAULT_CONFIG);
    const lines = script.split('\n');
    const skipDocsIndex = lines.findIndex(l => l === 'export SKIP_DOCS_INDEX=1');
    const dbtSchema = lines.findIndex(l => l === "export DBT_SCHEMA='dev_pan_1'");
    const agentId = lines.findIndex(l => l.startsWith('export OVERDECK_AGENT_ID='));

    expect(skipDocsIndex).toBeGreaterThanOrEqual(0);
    expect(dbtSchema).toBeGreaterThan(skipDocsIndex);
    expect(agentId).toBeGreaterThan(dbtSchema);
  });

  it('omits the workspace .env export and never calls workspaceEnvLauncherLines when spawnMode is remote', () => {
    const script = generateLauncherScript({ ...DEFAULT_CONFIG, spawnMode: 'remote' });

    expect(script).not.toContain("export DBT_SCHEMA='dev_pan_1'");
    expect(workspaceEnvLauncherLinesMock).not.toHaveBeenCalled();
  });
});
