import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-swarm-hold-'));
  mocks.listProjectsSync.mockReset();
  mocks.getReviewStatusSync.mockReset();
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

function setupWorkspace(issueLower: string, issueUpper: string): string {
  const projectPath = join(tempRoot, 'project');
  mkdirSync(join(projectPath, 'workspaces', `feature-${issueLower}`), { recursive: true });
  writeSpec(projectPath, issueUpper, makeDoc(issueUpper, 2));
  mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);
  return projectPath;
}

describe('coordinateSwarmSlots per-issue operator hold (PAN-2214)', () => {
  it('skips a deacon-ignored issue before any reconcile/dispatch work', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-100', 'PAN-100');
    mocks.getReviewStatusSync.mockReturnValue({ deaconIgnored: true });

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] skipped PAN-100: deacon-ignored — operator hold');
    expect(actions).not.toContain('[swarm] considered PAN-100: swarm eligible');
  });

  it('skips a stuck issue the same way', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-101', 'PAN-101');
    mocks.getReviewStatusSync.mockReturnValue({ stuck: true });

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] skipped PAN-101: stuck — operator hold');
    expect(actions).not.toContain('[swarm] considered PAN-101: swarm eligible');
  });

  it('honors the hold even when coordination is filtered to that issue (reactive path)', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-102', 'PAN-102');
    mocks.getReviewStatusSync.mockReturnValue({ deaconIgnored: true });

    const actions = await coordinateSwarmSlots({ issueId: 'PAN-102' });

    expect(actions).toContain('[swarm] skipped PAN-102: deacon-ignored — operator hold');
  });

  it('coordinates normally when no hold is set', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-103', 'PAN-103');
    mocks.getReviewStatusSync.mockReturnValue(null);

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-103: swarm eligible');
  });

  it('a hold read failure fails open (coordination proceeds)', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-104', 'PAN-104');
    mocks.getReviewStatusSync.mockImplementation(() => {
      throw new Error('journal unreadable');
    });

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-104: swarm eligible');
  });
});
