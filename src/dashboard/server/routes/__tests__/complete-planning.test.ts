import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  completePlanningArtifacts,
  completePlanningAutoSpawn,
  completePlanningAutoSpawnAndKill,
  completePlanningFilesToStage,
  completePlanningWorkspaceGitAddCommands,
} from '../issues.js';
import { PlanQualityLintError } from '../../../../lib/vbrief/quality-lint.js';
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
        {
          id: 'item-1',
          title: 'Promote spec',
          status: 'pending',
          narrative: { Action: 'Promote the finalized spec into the project planning directory' },
          metadata: {
            requiresInspection: false,
            files_scope: ['.pan/spec.vbrief.json'],
            files_scope_confidence: 'high',
            readiness: 'ready',
          },
          subItems: [
            {
              id: 'item-1.ac1',
              title: 'The project spec directory stores the promoted vBRIEF',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
            {
              id: 'item-1.ac2',
              title: 'The promoted vBRIEF persists proposed status',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
          ],
        },
        {
          id: 'item-2',
          title: 'Create beads',
          status: 'pending',
          narrative: { Action: 'Materialize one bead task for each finalized plan item' },
          metadata: {
            requiresInspection: false,
            files_scope: ['.beads/issues.jsonl'],
            files_scope_confidence: 'high',
            readiness: 'ready',
          },
          subItems: [
            {
              id: 'item-2.ac1',
              title: 'The bead materializer creates one task per item',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
            {
              id: 'item-2.ac2',
              title: 'Materialization errors blocks the planning promotion',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
          ],
        },
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
  it('stages workspace planning artifacts without force-adding .pan', () => {
    const issueId = 'PAN-1931';
    const { workspacePath } = makeProject(issueId);
    mkdirSync(join(workspacePath, '.pan', 'drafts'), { recursive: true });
    mkdirSync(join(workspacePath, '.pan', 'specs'), { recursive: true });
    mkdirSync(join(workspacePath, '.beads'), { recursive: true });
    writeFileSync(join(workspacePath, '.gitignore'), [
      '.pan/continue.json',
      '.pan/spec.vbrief.json',
      '',
    ].join('\n'));
    writeFileSync(join(workspacePath, '.pan', 'drafts', 'PAN-1931.md'), '# Draft\n');
    writeFileSync(join(workspacePath, '.pan', 'specs', 'PAN-1931.vbrief.json'), '{}\n');
    writeFileSync(join(workspacePath, '.pan', 'continue.json'), '{}\n');
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), '{}\n');
    writeFileSync(join(workspacePath, '.beads', 'issues.jsonl'), '{}\n');

    const commands = completePlanningWorkspaceGitAddCommands(workspacePath);
    expect(commands).toEqual([
      ['add', '.pan/'],
      ['add', '.beads/'],
    ]);
    expect(commands.flat()).not.toContain('-f');
  });

  it('includes codebase map changes in the main-side promote commit pathspec', async () => {
    const issueId = 'PAN-1150';
    const { projectPath } = makeProject(issueId);
    await mkdir(join(projectPath, '.pan', 'context', 'codebase'), { recursive: true });
    writeFileSync(join(projectPath, '.pan', 'context', 'codebase', 'conventions.md'), [
      '# Conventions',
      '',
      'Use project-local patterns.',
      '<!-- last-verified: 2026-06-12 -->',
      '',
    ].join('\n'));

    expect(completePlanningFilesToStage(projectPath, '2026-06-12-PAN-1150-plan.vbrief.json')).toEqual([
      '.pan/specs/2026-06-12-PAN-1150-plan.vbrief.json',
      '.pan/context/codebase/',
    ]);
  });

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
      createBeads: async () => ({
        success: true,
        created: ['PAN-1144: Promote spec'],
        errors: [],
        beadIds: new Map(),
      }),
    })).rejects.toThrow('created 1 beads for 2 plan items');

    expect(existsSync(join(projectPath, '.pan', 'specs')) ? readdirSync(join(projectPath, '.pan', 'specs')) : []).toEqual([]);
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

    expect(existsSync(join(projectPath, '.pan', 'specs')) ? readdirSync(join(projectPath, '.pan', 'specs')) : []).toEqual([]);
  });

  it('rejects quality lint failures before writing a proposed spec', async () => {
    const issueId = 'PAN-1149';
    const { projectPath, workspacePath } = makeProject(issueId);
    await mkdir(join(workspacePath, '.pan'), { recursive: true });
    const badDoc = makeDoc(issueId);
    badDoc.plan.items[0]!.subItems = [
      {
        id: 'task-1.ac1',
        title: 'Feature works as expected',
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
      {
        id: 'task-1.ac2',
        title: 'Given valid input then it returns success',
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
    ];
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify(badDoc, null, 2));

    await expect(completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
      createBeads: async () => {
        throw new Error('createBeads should not run');
      },
    })).rejects.toMatchObject({
      name: 'PlanQualityLintError',
      issues: expect.arrayContaining([
        expect.objectContaining({ rule: 'ac-banned-phrase' }),
      ]),
    } satisfies Partial<PlanQualityLintError>);

    expect(existsSync(join(projectPath, '.pan', 'specs')) ? readdirSync(join(projectPath, '.pan', 'specs')) : []).toEqual([]);
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

  it('kills the planning session immediately after autoSpawn succeeds', async () => {
    const events: string[] = [];
    const fetchImpl: typeof fetch = async () => {
      events.push('spawn');
      return new Response(JSON.stringify({ success: true, agentId: 'agent-pan-1148' }), { status: 200 });
    };

    await expect(completePlanningAutoSpawnAndKill({
      issueId: 'PAN-1148',
      autoSpawn: true,
      skipKill: false,
      sessionName: 'planning-pan-1148',
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl,
      killSessionImpl: async (sessionName) => { events.push(`kill:${sessionName}`); },
      scheduleKill: () => { throw new Error('kill should not be delayed'); },
    })).resolves.toEqual({
      workAgentSpawned: true,
      workAgentSession: 'agent-pan-1148',
    });
    expect(events).toEqual(['spawn', 'kill:planning-pan-1148']);
  });

  it('kills the planning session immediately after autoSpawn fails', async () => {
    const events: string[] = [];
    const fetchImpl: typeof fetch = async () => {
      events.push('spawn');
      throw new Error('network unavailable');
    };

    await expect(completePlanningAutoSpawnAndKill({
      issueId: 'PAN-1149',
      autoSpawn: true,
      skipKill: false,
      sessionName: 'planning-pan-1149',
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl,
      killSessionImpl: async (sessionName) => { events.push(`kill:${sessionName}`); },
      scheduleKill: () => { throw new Error('kill should not be delayed'); },
    })).resolves.toEqual({
      workAgentSpawned: false,
      workAgentError: 'network unavailable',
      workAgentSkipReason: 'spawn-failed',
    });
    expect(events).toEqual(['spawn', 'kill:planning-pan-1149']);
  });

  it('preserves the delayed kill when autoSpawn is false', async () => {
    const events: string[] = [];
    await expect(completePlanningAutoSpawnAndKill({
      issueId: 'PAN-1150',
      autoSpawn: false,
      skipKill: false,
      sessionName: 'planning-pan-1150',
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl: async () => { throw new Error('fetch should not be called'); },
      killSessionImpl: async (sessionName) => { events.push(`kill:${sessionName}`); },
      scheduleKill: (_callback, delayMs) => { events.push(`schedule:${delayMs}`); },
    })).resolves.toBeNull();
    expect(events).toEqual(['schedule:1500']);
  });

  it('does not kill the planning session when skipKill is true', async () => {
    const events: string[] = [];
    await expect(completePlanningAutoSpawnAndKill({
      issueId: 'PAN-1151',
      autoSpawn: true,
      skipKill: true,
      sessionName: 'planning-pan-1151',
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl: async () => new Response(JSON.stringify({ success: true, agentId: 'agent-pan-1151' }), { status: 200 }),
      killSessionImpl: async (sessionName) => { events.push(`kill:${sessionName}`); },
      scheduleKill: () => { throw new Error('kill should not be scheduled'); },
    })).resolves.toEqual({
      workAgentSpawned: true,
      workAgentSession: 'agent-pan-1151',
    });
    expect(events).toEqual([]);
  });
});
