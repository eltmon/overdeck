import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
}));

// Swarm policy defaults to OFF (1ebb3234da); enumeration tests assert
// eligibility lines, so pin the policy to enabled (doneness-test pattern).
vi.mock(import('../../../../src/lib/swarm-policy.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveSwarmPolicy: () => ({ mode: 'auto', maxSlots: 3, autoAdvance: true, source: { mode: 'global', maxSlots: 'global', autoAdvance: 'global' } }),
  resolveAutomaticSwarmPolicy: () => ({ policy: { mode: 'auto', maxSlots: 3, autoAdvance: true, source: { mode: 'global', maxSlots: 'global', autoAdvance: 'global' } }, enabled: true }),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
  findProjectByPathSync: (projectPath: string) =>
    mocks.listProjectsSync().find(({ config }: { config: { path: string } }) => config.path === projectPath)?.config ?? null,
  // PAN-2372 WI-2: workspace-door record path now resolves the owning project;
  // these tests fixture records at the workspace .pan/records/ path, so treat
  // issues as unregistered and use the workspace-door fallback.
  resolveProjectFromIssueSync: () => null,
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-swarm-enumerate-'));
  mocks.listProjectsSync.mockReset();
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function writeSpec(projectPath: string, issueId: string, doc: XBriefDocument): void {
  const specsDir = join(projectPath, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, `2026-07-01-${issueId}-test.xbrief.json`), JSON.stringify({
    ...doc,
    status: 'active',
  }, null, 2));
}

function makeDoc(issueId: string, itemCount: number): XBriefDocument {
  const now = '2026-07-01T00:00:00.000Z';
  return {
    xBRIEFInfo: {
      version: '0.6',
      created: now,
      author: 'test',
      description: `Plan for ${issueId}`,
    },
    plan: {
      id: issueId.toLowerCase(),
      title: `Plan for ${issueId}`,
      status: 'active',
      created: now,
      updated: now,
      items: Array.from({ length: itemCount }, (_, index) => ({
        id: `wi-${index + 1}`,
        title: `Work item ${index + 1}`,
        status: 'pending',
        metadata: {
          readiness: 'ready',
          files_scope: [`src/example-${index + 1}.ts`],
          files_scope_confidence: 'high',
          verify_commands: ['npm run typecheck'],
          expected_outputs: ['typecheck completes without errors'],
        },
      })),
      edges: [],
    },
  };
}

describe('coordinateSwarmSlots enumerate-swarms', () => {
  it('preserves feature workspace listing for existing cleanup callers by default', async () => {
    const { listFeatureWorkspaces } = await import('../../../../src/lib/cloister/deacon-workspaces.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-099'), { recursive: true });
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-099-slot-1'), { recursive: true });
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    expect(listFeatureWorkspaces().map(workspace => workspace.issueId).sort()).toEqual([
      'PAN-099',
      'PAN-099-SLOT-1',
    ]);
    expect(listFeatureWorkspaces({ includeSlotWorkspaces: false }).map(workspace => workspace.issueId)).toEqual([
      'PAN-099',
    ]);
  });

  it('does not automatically dispatch an eligible workspace through the legacy coordinator', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-100'), { recursive: true });
    writeSpec(projectPath, 'PAN-100', makeDoc('PAN-100', 2));
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).not.toContain('[swarm] considered PAN-100: swarm eligible');
  });

  it('excludes single-item and non-swarm feature workspaces, and ignores slot workspaces', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-101'), { recursive: true });
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-102-slot-1'), { recursive: true });
    writeSpec(projectPath, 'PAN-101', makeDoc('PAN-101', 1));
    writeSpec(projectPath, 'PAN-102-SLOT-1', makeDoc('PAN-102-SLOT-1', 2));
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    await expect(coordinateSwarmSlots()).resolves.toEqual([]);
  });

  it('returns an empty action list when no feature workspaces exist', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(projectPath, { recursive: true });
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    await expect(coordinateSwarmSlots()).resolves.toEqual([]);
  });

  it('wires runPatrol between failed-merge retry and stale merge reconciliation', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/cloister/deacon.ts'), 'utf-8');
    const failedMergeIndex = source.indexOf('const failedMergeRetryActions = await checkFailedMergeRetry();');
    const strikeLandingIndex = source.indexOf('for (const a of await patrolStrikeLandings())');
    const swarmIndex = source.indexOf('const swarmActions = await swarmJanitorPass();');
    const staleMergeIndex = source.indexOf('const staleMergeActions = await reconcileStaleMergeStatus();');

    expect(failedMergeIndex).toBeGreaterThanOrEqual(0);
    expect(source).toContain("import { patrolStrikeLandings } from './deacon-strike-landing.js';");
    expect(source).not.toContain("import('./deacon-strike-landing.js')");
    expect(strikeLandingIndex).toBeGreaterThan(failedMergeIndex);
    expect(swarmIndex).toBeGreaterThan(strikeLandingIndex);
    expect(staleMergeIndex).toBeGreaterThan(swarmIndex);
    expect(source).toContain("export { coordinateSwarmSlots } from './deacon-swarm.js';");
  });

  it('routes slot done-resolution patrols to the foreman instead of issue-level pan done', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/cloister/deacon.ts'), 'utf-8');
    const slotGuardIndex = source.indexOf("console.log(`[deacon] Slot ${agent.id} (${issueId}) reported done: notifying its foreman`);");
    const slotCoordinationIndex = source.indexOf("await messageAgent(`agent-${issueId.toLowerCase()}`, `[swarm-event]", slotGuardIndex);
    const panDoneIndex = source.indexOf("await execFileAsync(bin, ['work', 'done', issueId", slotGuardIndex);

    expect(slotGuardIndex).toBeGreaterThanOrEqual(0);
    expect(slotCoordinationIndex).toBeGreaterThan(slotGuardIndex);
    expect(panDoneIndex).toBeGreaterThan(slotCoordinationIndex);
  });
});
