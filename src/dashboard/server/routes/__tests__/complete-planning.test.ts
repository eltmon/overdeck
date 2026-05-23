import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completePlanningArtifacts } from '../issues.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';

let projectRoot: string | null = null;

function makeProject(issueId: string): { projectPath: string; workspacePath: string } {
  projectRoot = mkdtempSync(join(tmpdir(), 'complete-planning-'));
  const workspacePath = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
  return { projectPath: projectRoot, workspacePath };
}

function makeDoc(issueId: string): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-16T00:00:00.000Z' },
    plan: {
      id: issueId,
      title: 'First run promotion',
      status: 'draft',
      metadata: {
        canonicalFilename: '../../outside.vbrief.json',
      } as Record<string, unknown>,
      items: [
        { id: 'item-1', title: 'Promote spec', status: 'pending' },
        { id: 'item-2', title: 'Create beads', status: 'pending' },
      ],
      edges: [],
    },
  };
}

afterEach(() => {
  if (projectRoot) {
    rmSync(projectRoot, { recursive: true, force: true });
    projectRoot = null;
  }
});

describe('completePlanningArtifacts', () => {
  it('promotes a first-run workspace draft and materializes one bead per plan item', async () => {
    const issueId = 'PAN-1143';
    const { projectPath, workspacePath } = makeProject(issueId);
    await mkdir(join(workspacePath, '.pan'), { recursive: true });
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify(makeDoc(issueId), null, 2));

    const result = await completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
      createBeads: async (path) => {
        expect(path).toBe(workspacePath);
        return {
          success: true,
          created: ['PAN-1143: Promote spec', 'PAN-1143: Create beads'],
          errors: [],
          beadIds: new Map(),
        };
      },
    });

    const specFiles = readdirSync(join(projectPath, '.pan', 'specs'));
    expect(specFiles).toEqual([result.proposed.filename]);
    expect(result.proposed.filename).toMatch(/^\d{4}-\d{2}-\d{2}-PAN-1143-first-run-promotion\.vbrief\.json$/);
    expect(result.proposed.path).toBe(join(projectPath, '.pan', 'specs', result.proposed.filename));
    expect(result.beadCount).toBe(2);

    const promoted = JSON.parse(readFileSync(result.proposed.path, 'utf-8'));
    expect(promoted.status).toBe('proposed');
    expect(promoted.plan.status).toBe('proposed');
  });

  it('fails when bead materialization does not match the plan item count', async () => {
    const issueId = 'PAN-1144';
    const { projectPath, workspacePath } = makeProject(issueId);
    await mkdir(join(workspacePath, '.pan'), { recursive: true });
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify(makeDoc(issueId), null, 2));

    await expect(completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
      createBeads: async () => ({
        success: true,
        created: ['PAN-1144: Promote spec'],
        errors: [],
        beadIds: new Map(),
      }),
    })).rejects.toThrow('created 1 beads for 2 plan items');
  });
});
