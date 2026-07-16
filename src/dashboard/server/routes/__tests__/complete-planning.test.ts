import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  beginCompletePlanningLease,
  completePlanningArtifacts,
  completePlanningAutoSpawn,
  completePlanningAutoSpawnAndKill,
  completePlanningFilesToStage,
  completePlanningWorkspaceGitAddCommands,
} from '../../../../lib/overdeck/planning-promotion.js';
import { applyStatusOverrides } from '../../../../lib/vbrief/io.js';
import { lintPlanQuality, PlanQualityLintError } from '../../../../lib/vbrief/quality-lint.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';

let projectRoot: string | null = null;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

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
        docsJustification: 'Promotion-mechanics fixture; documentation coverage is exercised in the quality-lint suite',
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
          title: 'Create tasks',
          status: 'pending',
          narrative: { Action: 'Materialize one task task for each finalized plan item' },
          metadata: {
            requiresInspection: false,
            files_scope: ['.tasks/issues.jsonl'],
            files_scope_confidence: 'high',
            readiness: 'ready',
          },
          subItems: [
            {
              id: 'item-2.ac1',
              title: 'The task materializer creates one task per item',
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

function makeFileSizeRatchetDoc(issueId: string, intermediateCommand: string): VBriefDocument {
  const doc = makeDoc(issueId);
  doc.plan.title = 'Extract specialist spawn seam';
  doc.plan.items = [
    {
      id: 'wi-1-spawn',
      title: 'Extract specialist spawn seam',
      status: 'pending',
      narrative: {
        Action: 'Extract specialist spawn helpers from the monolith into a focused source module',
      },
      metadata: {
        requiresInspection: true,
        foundationFor: ['wi-7-reconcile'],
        files_scope: [
          'src/lib/cloister/specialists.ts',
          'src/lib/cloister/specialists-spawn.ts',
        ],
        files_scope_confidence: 'high',
        readiness: 'sequential',
        verify_commands: [intermediateCommand],
      },
      subItems: [
        {
          id: 'wi-1-spawn.ac1',
          title: `${intermediateCommand} passes from the committed extraction tree`,
          status: 'pending',
          metadata: { kind: 'acceptance_criterion' },
        },
        {
          id: 'wi-1-spawn.ac2',
          title: 'The extracted module preserves specialist spawn behavior',
          status: 'pending',
          metadata: { kind: 'acceptance_criterion' },
        },
      ],
    },
    {
      id: 'wi-7-reconcile',
      title: 'Reconcile the file-size ratchet',
      status: 'pending',
      narrative: {
        Action: 'Lower scripts/file-size-baseline.txt for src/lib/cloister/specialists.ts after all extractions finish',
      },
      metadata: {
        requiresInspection: false,
        files_scope: [
          'scripts/file-size-baseline.txt',
          'src/lib/cloister/specialists.ts',
        ],
        files_scope_confidence: 'high',
        readiness: 'sequential',
        verify_commands: ['npm run lint'],
      },
      subItems: [
        {
          id: 'wi-7-reconcile.ac1',
          title: 'scripts/file-size-baseline.txt records the lowered specialists.ts line count',
          status: 'pending',
          metadata: { kind: 'acceptance_criterion' },
        },
        {
          id: 'wi-7-reconcile.ac2',
          title: 'npm run lint passes after the final baseline reconciliation',
          status: 'pending',
          metadata: { kind: 'acceptance_criterion' },
        },
      ],
    },
  ];
  doc.plan.edges = [{ from: 'wi-1-spawn', to: 'wi-7-reconcile', type: 'blocks' }];
  return doc;
}

afterEach(() => {
  if (projectRoot) {
    rmSync(projectRoot, { recursive: true, force: true });
    projectRoot = null;
  }
});

describe('completePlanningArtifacts', () => {
  it('serializes concurrent complete-planning attempts for the same issue', async () => {
    const first = beginCompletePlanningLease('PAN-2247');
    const second = beginCompletePlanningLease('pan-2247', true);

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(first.autoSpawnRequested()).toBe(true);

    first.release();
    await flush();

    const third = beginCompletePlanningLease('PAN-2247');
    expect(third.started).toBe(true);
    third.release();
    await flush();
  });

  it('stages workspace planning artifacts without force-adding .pan', () => {
    const issueId = 'PAN-1931';
    const { workspacePath } = makeProject(issueId);
    mkdirSync(join(workspacePath, '.pan', 'drafts'), { recursive: true });
    mkdirSync(join(workspacePath, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(workspacePath, '.gitignore'), [
      '.pan/continue.json',
      '.pan/spec.vbrief.json',
      '',
    ].join('\n'));
    writeFileSync(join(workspacePath, '.pan', 'drafts', 'PAN-1931.md'), '# Draft\n');
    writeFileSync(join(workspacePath, '.pan', 'specs', 'PAN-1931.vbrief.json'), '{}\n');
    writeFileSync(join(workspacePath, '.pan', 'continue.json'), '{}\n');
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), '{}\n');

    const commands = completePlanningWorkspaceGitAddCommands(workspacePath);
    expect(commands).toEqual([
      ['add', '.pan/'],
      ['add', '.gitignore'],
    ]);
    expect(commands.flat()).not.toContain('-f');
  });

  it('does not stage workspace state paths after state migration', () => {
    const { workspacePath } = makeProject('PAN-2541');
    mkdirSync(join(workspacePath, '.pan'), { recursive: true });
    mkdirSync(join(workspacePath, '.tasks'), { recursive: true });
    writeFileSync(join(workspacePath, '.gitignore'), '.overdeck/\n');
    expect(completePlanningWorkspaceGitAddCommands(workspacePath, true)).toEqual([
      ['add', '.gitignore'],
    ]);
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

  it('promotes a first-run workspace draft and reports one vBRIEF task per plan item', async () => {
    const issueId = 'PAN-1143';
    const { projectPath, workspacePath } = makeProject(issueId);
    await mkdir(join(workspacePath, '.pan'), { recursive: true });
    writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify(makeDoc(issueId), null, 2));

    const result = await completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
    });

    const specFiles = readdirSync(join(projectPath, '.pan', 'specs'));
    expect(specFiles).toEqual([result.proposed.filename]);
    expect(result.proposed.filename).toMatch(/^\d{4}-\d{2}-\d{2}-PAN-1143-first-run-promotion\.vbrief\.json$/);
    expect(result.proposed.path).toBe(join(projectPath, '.pan', 'specs', result.proposed.filename));
    expect(result.taskCount).toBe(2);

    const promoted = JSON.parse(readFileSync(result.proposed.path, 'utf-8'));
    expect(promoted.status).toBe('proposed');
    expect(promoted.plan.status).toBe('proposed');
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
    })).rejects.toMatchObject({
      name: 'PlanQualityLintError',
      issues: expect.arrayContaining([
        expect.objectContaining({ rule: 'ac-banned-phrase' }),
      ]),
    } satisfies Partial<PlanQualityLintError>);

    expect(existsSync(join(projectPath, '.pan', 'specs')) ? readdirSync(join(projectPath, '.pan', 'specs')) : []).toEqual([]);
  });

  it('re-finalizes an active ratchet-blocked plan without losing stable item progress', async () => {
    const issueId = 'PAN-2232';
    const { projectPath, workspacePath } = makeProject(issueId);
    const specsDir = join(projectPath, '.pan', 'specs');
    const recordsDir = join(projectPath, '.pan', 'records');
    const workspacePanDir = join(workspacePath, '.pan');
    await Promise.all([
      mkdir(specsDir, { recursive: true }),
      mkdir(recordsDir, { recursive: true }),
      mkdir(workspacePanDir, { recursive: true }),
    ]);

    const canonicalFilename = '2026-07-16-PAN-2232-extract-specialist-spawn-seam.vbrief.json';
    const canonicalPath = join(specsDir, canonicalFilename);
    const blockedDoc = makeFileSizeRatchetDoc(issueId, 'npm run lint');
    writeFileSync(canonicalPath, JSON.stringify({
      ...blockedDoc,
      status: 'active',
      plan: { ...blockedDoc.plan, status: 'active' },
    }, null, 2));

    const statusOverrides = {
      'wi-1-spawn': 'running',
      'wi-1-spawn.ac1': 'completed',
    };
    const recordPath = join(recordsDir, 'pan-2232.json');
    writeFileSync(recordPath, JSON.stringify({ issueId, statusOverrides }, null, 2));
    const recordBefore = readFileSync(recordPath, 'utf-8');

    expect(lintPlanQuality(blockedDoc)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'wi-1-spawn',
        rule: 'deferred-file-size-ratchet',
      }),
    ]));

    const repairedDoc = makeFileSizeRatchetDoc(issueId, 'npm run typecheck');
    expect(lintPlanQuality(repairedDoc).map(issue => issue.rule))
      .not.toContain('deferred-file-size-ratchet');
    writeFileSync(
      join(workspacePanDir, 'spec.vbrief.json'),
      JSON.stringify(repairedDoc, null, 2),
    );

    const result = await completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
    });

    expect(result.proposed).toEqual({ path: canonicalPath, filename: canonicalFilename });
    expect(readdirSync(specsDir)).toEqual([canonicalFilename]);
    const promoted = JSON.parse(readFileSync(canonicalPath, 'utf-8')) as VBriefDocument & { status: string };
    expect(promoted.status).toBe('proposed');
    expect(promoted.plan.items[0]?.metadata?.verify_commands).toEqual(['npm run typecheck']);
    expect(readFileSync(recordPath, 'utf-8')).toBe(recordBefore);

    const effective = applyStatusOverrides(promoted, statusOverrides);
    expect(effective.plan.items[0]?.status).toBe('running');
    expect(effective.plan.items[0]?.subItems?.[0]?.status).toBe('completed');
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

  it('rebuilds the stack and starts work when the initial auto-spawn finds no healthy stack', async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(String(input));
      if (String(input).endsWith('/api/agents')) {
        return new Response(JSON.stringify({
          success: false,
          blocked: true,
          skipped: true,
          error: 'Workspace docker stack for PAN-1147 is not healthy: no containers found',
          stackHealth: { healthy: false, reasons: ['no containers found'] },
        }), { status: 422 });
      }
      return new Response(JSON.stringify({ success: true, activityId: 'activity-rebuild' }), { status: 200 });
    };

    await expect(completePlanningAutoSpawn({
      issueId: 'PAN-1147',
      autoSpawn: true,
      dashboardOrigin: 'http://127.0.0.1:3011',
      fetchImpl,
    })).resolves.toEqual({
      workAgentSpawned: true,
      workAgentSession: 'agent-pan-1147',
    });
    expect(requests).toEqual([
      'http://127.0.0.1:3011/api/agents',
      'http://127.0.0.1:3011/api/workspaces/PAN-1147/rebuild-and-start',
    ]);
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
