import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-swarm-enumerate-'));
  mocks.listProjectsSync.mockReset();
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function writeSpec(projectPath: string, issueId: string, doc: VBriefDocument): void {
  const specsDir = join(projectPath, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, `2026-07-01-${issueId}-test.vbrief.json`), JSON.stringify({
    ...doc,
    status: 'active',
  }, null, 2));
}

function makeDoc(issueId: string, itemCount: number): VBriefDocument {
  const now = '2026-07-01T00:00:00.000Z';
  return {
    vBRIEFInfo: {
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
          readiness: itemCount > 1 ? 'ready' : 'sequential',
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
  it('enumerates feature workspaces whose main-side vBRIEF is swarm eligible', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-100'), { recursive: true });
    writeSpec(projectPath, 'PAN-100', makeDoc('PAN-100', 2));
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-100: swarm eligible');
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
    const swarmIndex = source.indexOf('const swarmActions = await coordinateSwarmSlots();');
    const staleMergeIndex = source.indexOf('const staleMergeActions = await reconcileStaleMergeStatus();');

    expect(failedMergeIndex).toBeGreaterThanOrEqual(0);
    expect(swarmIndex).toBeGreaterThan(failedMergeIndex);
    expect(staleMergeIndex).toBeGreaterThan(swarmIndex);
    expect(source).toContain("export { coordinateSwarmSlots } from './deacon-swarm.js';");
  });
});
