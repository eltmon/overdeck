import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';
import { applyStatusOverrides } from '../../../../src/lib/vbrief/io.js';
import { getDispatchableItems } from '../../../../src/lib/vbrief/dag.js';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
  findProjectByPathSync: () => null,
  getProjectSwarmHotspots: () => [],
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-swarm-doneness-'));
  mocks.listProjectsSync.mockReset();
  mocks.getReviewStatusSync.mockReset();
  mocks.getReviewStatusSync.mockReturnValue(null);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function makeDoc(issueId: string, itemCount: number): VBriefDocument {
  const now = '2026-07-02T00:00:00.000Z';
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

function writeSpec(projectPath: string, issueId: string, doc: VBriefDocument): void {
  const specsDir = join(projectPath, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, `2026-07-02-${issueId}-test.vbrief.json`), JSON.stringify({
    ...doc,
    status: 'active',
  }, null, 2));
}

describe('swarm item done-ness survives slot gc (statusOverrides overlay)', () => {
  it('pure mechanism: a completed override removes the item from dispatchable set', () => {
    const doc = makeDoc('PAN-900', 3);
    const merged = applyStatusOverrides(doc, { 'wi-1': 'completed' });

    const dispatchable = getDispatchableItems(merged, new Set()).map(item => item.id);
    expect(dispatchable).toEqual(['wi-2', 'wi-3']);
    // The overlay must not mutate the source document.
    expect(doc.plan.items[0].status).toBe('pending');
  });

  function writeRecordOverrides(projectPath: string, issueLower: string, overrides: Record<string, string>): void {
    const recordsDir = join(projectPath, 'workspaces', `feature-${issueLower}`, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, `${issueLower}.json`), JSON.stringify({
      issueId: issueLower.toUpperCase(),
      schemaVersion: 1,
      statusOverrides: overrides,
    }, null, 2));
  }

  it('coordinator skips an issue whose only remaining items are override-completed', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-900'), { recursive: true });
    writeSpec(projectPath, 'PAN-900', makeDoc('PAN-900', 2));
    writeRecordOverrides(projectPath, 'pan-900', { 'wi-1': 'completed', 'wi-2': 'completed' });
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).not.toContain('[swarm] considered PAN-900: swarm eligible');
  });

  it('coordinator still considers an issue with remaining dispatchable items', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-901'), { recursive: true });
    writeSpec(projectPath, 'PAN-901', makeDoc('PAN-901', 3));
    writeRecordOverrides(projectPath, 'pan-901', { 'wi-1': 'completed' });
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-901: swarm eligible');
  });
});

describe('swarm endgame: merge/cleanup still runs when dispatch is no longer eligible', () => {
  it('gcs a merged slot for an all-completed plan instead of skipping the pass', async () => {
    const { execFileSync } = await import('node:child_process');
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-902');
    mkdirSync(workspacePath, { recursive: true });
    writeSpec(projectPath, 'PAN-902', makeDoc('PAN-902', 2));
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    // Real git repo so reconcile sees a merged slot branch (tip == HEAD).
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, stdio: 'ignore' });
    git('init', '-b', 'feature/pan-902');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('commit', '--allow-empty', '-m', 'base');
    git('branch', 'feature/pan-902-slot-1');

    const recordsDir = join(workspacePath, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, 'pan-902.json'), JSON.stringify({
      issueId: 'PAN-902',
      schemaVersion: 1,
      statusOverrides: { 'wi-1': 'completed', 'wi-2': 'completed' },
      swarm: {
        slotAssignments: [
          { slotIndex: 1, itemId: 'wi-1', agentId: 'agent-pan-902-slot-1', branch: 'feature/pan-902-slot-1', assignedAt: '2026-07-02T00:00:00.000Z' },
        ],
      },
    }, null, 2));

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-902: endgame (merge/cleanup only)');
    expect(actions).toContain('[swarm] gc slot 1 (item wi-1) for PAN-902');
    expect(actions).not.toContain('[swarm] considered PAN-902: swarm eligible');
  });
});
