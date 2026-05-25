import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completePlanningArtifacts, completePlanningAutoSpawn } from '../issues.js';
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

  it('does not write a proposed spec when bead materialization does not match the plan item count', async () => {
    const issueId = 'PAN-1144';
    const { projectPath, workspacePath } = makeProject(issueId);
    await mkdir(join(workspacePath, '.pan'), { recursive: true });
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify(makeDoc(issueId), null, 2));

    await expect(completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
      createBeads: async () => {
        expect(existsSync(join(projectPath, '.pan', 'specs'))).toBe(false);
        return {
          success: true,
          created: ['PAN-1144: Promote spec'],
          errors: [],
          beadIds: new Map(),
        };
      },
    })).rejects.toThrow('created 1 beads for 2 plan items');

    expect(existsSync(join(projectPath, '.pan', 'specs'))).toBe(false);
  });

  it('does not write a proposed spec when bead materialization reports failure', async () => {
    const issueId = 'PAN-1145';
    const { projectPath, workspacePath } = makeProject(issueId);
    await mkdir(join(workspacePath, '.pan'), { recursive: true });
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify(makeDoc(issueId), null, 2));

    await expect(completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
      createBeads: async () => ({
        success: false,
        created: ['PAN-1145: Promote spec', 'PAN-1145: Create beads'],
        errors: ['bd daemon unavailable'],
        beadIds: new Map(),
      }),
    })).rejects.toThrow('bd daemon unavailable');

    expect(existsSync(join(projectPath, '.pan', 'specs'))).toBe(false);
  });

  it('does not auto-spawn when autoSpawn is omitted', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('fetch should not be called');
    };

    await expect(completePlanningAutoSpawn({
      issueId: 'PAN-1146',
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl,
    })).resolves.toBeNull();
  });

  it('auto-spawns a work agent through the existing agents endpoint', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:3011/api/agents');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ origin: 'http://127.0.0.1:3011' });
      expect(JSON.parse(String(init?.body))).toEqual({ issueId: 'PAN-1146', role: 'work' });
      return new Response(JSON.stringify({ success: true, agentId: 'agent-pan-1146' }), { status: 200 });
    };

    await expect(completePlanningAutoSpawn({
      issueId: 'PAN-1146',
      autoSpawn: true,
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl,
    })).resolves.toEqual({
      workAgentSpawned: true,
      workAgentSession: 'agent-pan-1146',
    });
  });

  it('maps stack-health spawn rejection to a non-fatal autoSpawn skip', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      success: false,
      blocked: true,
      skipped: true,
      error: 'Workspace docker stack for PAN-1147 is not healthy: api unhealthy',
      stackHealth: { healthy: false, reasons: ['api unhealthy'] },
    }), { status: 422 });

    await expect(completePlanningAutoSpawn({
      issueId: 'PAN-1147',
      autoSpawn: true,
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl,
    })).resolves.toEqual({
      workAgentSpawned: false,
      workAgentError: 'Workspace docker stack for PAN-1147 is not healthy: api unhealthy',
      workAgentSkipReason: 'stack-unhealthy',
    });
  });
});
