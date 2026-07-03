import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import * as planFinalizeModule from '../plan-finalize.js';
import { evaluatePlanFinalizeQualityGate, planFinalizeCommand, promotePlanning, stampPlanForFinalization } from '../plan-finalize.js';
import type { VBriefDocument } from '../../../lib/vbrief/types.js';
import * as beadsModule from '../../../lib/vbrief/beads.js';

vi.mock('../../../lib/vbrief/beads.js', async (importOriginal) => {
  const actual = await importOriginal<typeof beadsModule>();
  return {
    ...actual,
    createBeadsFromVBrief: vi.fn(),
  };
});

let TEST_DIR: string;
let OLD_DASHBOARD_URL: string | undefined;
let OLD_OVERDECK_DASHBOARD_URL: string | undefined;

function makePlanDoc(overrides: Partial<VBriefDocument['plan']> = {}): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
    plan: {
      id: 'pan-946',
      title: 'Adopt deft vBRIEF Lifecycle Model',
      status: 'draft',
      sequence: 3,
      created: '2026-05-03T00:00:00Z',
      items: [{
        id: 'task-1',
        title: 'Task one',
        status: 'pending',
        narrative: { Action: 'Implement the change with exact files and verification steps' },
        metadata: {
          requiresInspection: false,
          files_scope: ['src/task-one.ts'],
          files_scope_confidence: 'high',
          readiness: 'sequential',
        },
        subItems: [
          {
            id: 'task-1.ac1',
            title: 'Given valid input then it returns success',
            status: 'pending',
            metadata: { kind: 'acceptance_criterion' },
          },
          {
            id: 'task-1.ac2',
            title: 'The command rejects invalid input with a clear error',
            status: 'pending',
            metadata: { kind: 'acceptance_criterion' },
          },
        ],
      }],
      edges: [],
      ...overrides,
    },
  };
}

function writePlan(path: string, doc: VBriefDocument): void {
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf-8');
}

function readDoc(path: string): VBriefDocument {
  return JSON.parse(readFileSync(path, 'utf-8')) as VBriefDocument;
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'plan-finalize-'));
  OLD_DASHBOARD_URL = process.env.DASHBOARD_URL;
  OLD_OVERDECK_DASHBOARD_URL = process.env.OVERDECK_DASHBOARD_URL;
  // OVERDECK_DASHBOARD_URL now wins over DASHBOARD_URL — clear it for determinism.
  delete process.env.OVERDECK_DASHBOARD_URL;
  process.env.DASHBOARD_URL = 'http://dashboard.test';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (OLD_DASHBOARD_URL === undefined) delete process.env.DASHBOARD_URL;
  else process.env.DASHBOARD_URL = OLD_DASHBOARD_URL;
  if (OLD_OVERDECK_DASHBOARD_URL === undefined) delete process.env.OVERDECK_DASHBOARD_URL;
  else process.env.OVERDECK_DASHBOARD_URL = OLD_OVERDECK_DASHBOARD_URL;
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('promotePlanning', () => {
  it('posts complete-planning without autoSpawn by default', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      message: 'Planning complete and pushed to git - ready for execution',
      workAgentSpawned: false,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(promotePlanning('PAN-1509')).resolves.toEqual({
      success: true,
      message: 'Planning complete and pushed to git - ready for execution',
      error: null,
      workAgentSpawned: false,
      workAgentMessage: null,
      workAgentError: null,
      workAgentSkipReason: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://dashboard.test/api/issues/PAN-1509/complete-planning');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({});
    expect(String(url)).not.toContain('/api/agents');
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 90_000);
  });

  it('posts complete-planning with autoSpawn when requested and no separate agents request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      message: 'Planning complete and work agent spawn requested',
      workAgentSpawned: true,
      workAgentSession: 'agent-pan-1509',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(promotePlanning('PAN-1509', true)).resolves.toEqual({
      success: true,
      message: 'Planning complete and work agent spawn requested',
      error: null,
      workAgentSpawned: true,
      workAgentMessage: 'Session: agent-pan-1509',
      workAgentError: null,
      workAgentSkipReason: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://dashboard.test/api/issues/PAN-1509/complete-planning');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ autoSpawn: true });
    expect(String(url)).not.toContain('/api/agents');
  });

  it('surfaces autoSpawn skip reasons from complete-planning', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      message: 'Planning complete and pushed to git - ready for execution',
      workAgentSpawned: false,
      workAgentError: 'Workspace docker stack for PAN-1509 is not healthy: api unhealthy',
      workAgentSkipReason: 'stack-unhealthy',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(promotePlanning('PAN-1509', true)).resolves.toMatchObject({
      success: true,
      workAgentSpawned: false,
      workAgentMessage: 'Skip reason: stack-unhealthy',
      workAgentError: 'Workspace docker stack for PAN-1509 is not healthy: api unhealthy',
      workAgentSkipReason: 'stack-unhealthy',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits noPrd from the complete-planning body by default', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await promotePlanning('PAN-1509');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({});
  });

  it('posts noPrd: true when opts.noPrd is set (PAN-2234)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await promotePlanning('PAN-1509', false, { noPrd: true });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ noPrd: true });
  });

  it('combines noPrd with autoSpawn in the body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await promotePlanning('PAN-1509', true, { noPrd: true });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ autoSpawn: true, noPrd: true });
  });
});

describe('evaluatePlanFinalizeQualityGate', () => {
  it('rejects plans with banned AC phrasing', () => {
    const doc = makePlanDoc({
      items: [{
        id: 'task-1',
        title: 'Task one',
        status: 'pending',
        narrative: { Action: 'Implement the change with exact files and verification steps' },
        metadata: {
          requiresInspection: false,
          files_scope: ['src/task-one.ts'],
          files_scope_confidence: 'high',
          readiness: 'sequential',
        },
        subItems: [
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
        ],
      }],
    });

    const result = evaluatePlanFinalizeQualityGate(doc);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'ac-banned-phrase', message: expect.stringContaining('works as expected') }),
    ]));
  });

  it('skips quality lint when --no-quality-lint is set', () => {
    const doc = makePlanDoc({
      items: [{
        id: 'task-1',
        title: 'Task one',
        status: 'pending',
        narrative: { Action: 'thin' },
        metadata: { requiresInspection: false },
        subItems: [],
      }],
    });

    expect(evaluatePlanFinalizeQualityGate(doc, { qualityLint: false })).toEqual({
      ok: true,
      skipped: true,
      issues: [],
    });
  });
});

describe('stampPlanForFinalization', () => {
  it('sets plan.status to "proposed"', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ status: 'draft' }));
    stampPlanForFinalization(path, 'PAN-946');
    expect(readDoc(path).plan.status).toBe('proposed');
  });

  it('generates and stamps a canonical filename derived from title + issueId', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ title: 'Adopt deft vBRIEF Lifecycle' }));
    const filename = stampPlanForFinalization(path, 'PAN-946');
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-PAN-946-adopt-deft-vbrief-lifecycle\.vbrief\.json$/);
    const after = readDoc(path);
    expect(after.plan.metadata?.canonicalFilename).toBe(filename);
  });

  it('falls back to plan.id when title is empty', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ title: '', id: 'pan-946' }));
    const filename = stampPlanForFinalization(path, 'PAN-946');
    expect(filename).toMatch(/PAN-946-pan-946\.vbrief\.json$/);
  });

  it('falls back to issueId when title and id are both empty', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ title: '', id: '' }));
    const filename = stampPlanForFinalization(path, 'PAN-946');
    // slugify('PAN-946') -> 'pan-946'
    expect(filename).toMatch(/PAN-946-pan-946\.vbrief\.json$/);
  });

  it('preserves an existing canonicalFilename (idempotent date)', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    const existing = '2026-04-01-PAN-946-original-slug.vbrief.json';
    writePlan(
      path,
      makePlanDoc({
        metadata: { canonicalFilename: existing },
        title: 'A New Title That Should Not Change The Filename',
      }),
    );
    const filename = stampPlanForFinalization(path, 'PAN-946');
    expect(filename).toBe(existing);
    expect(readDoc(path).plan.metadata?.canonicalFilename).toBe(existing);
  });

  it('increments plan.sequence and refreshes timestamps', async () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ sequence: 5 }));
    await new Promise((r) => setTimeout(r, 5));
    stampPlanForFinalization(path, 'PAN-946');
    const after = readDoc(path);
    expect(after.plan.sequence).toBe(6);
    expect(after.plan.updated).toBeTruthy();
    expect(after.plan.updated).not.toBe('2026-05-03T00:00:00Z');
    expect(after.vBRIEFInfo.updated).toBeTruthy();
  });

  it('writes atomically (no .tmp left behind)', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc());
    stampPlanForFinalization(path, 'PAN-946');
    expect(existsSync(path + '.tmp')).toBe(false);
  });

  it('preserves other metadata fields when stamping canonicalFilename', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(
      path,
      makePlanDoc({
        metadata: { someOtherField: 'kept', anotherKey: 42 },
      }),
    );
    stampPlanForFinalization(path, 'PAN-946');
    const after = readDoc(path);
    expect(after.plan.metadata?.someOtherField).toBe('kept');
    expect(after.plan.metadata?.anotherKey).toBe(42);
    expect(after.plan.metadata?.canonicalFilename).toMatch(/^\d{4}-\d{2}-\d{2}-PAN-946-/);
  });

  it('initializes sequence to 1 when previously missing', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).sequence;
    writePlan(path, doc);
    stampPlanForFinalization(path, 'PAN-946');
    expect(readDoc(path).plan.sequence).toBe(1);
  });
});

describe('planFinalizeCommand', () => {
  function makeWorkspace(issueId: string): string {
    const workspacePath = join(TEST_DIR, `feature-${issueId.toLowerCase()}`);
    const panDir = join(workspacePath, '.pan');
    mkdirSync(panDir, { recursive: true });
    writeFileSync(join(panDir, 'spec.vbrief.json'), JSON.stringify(makePlanDoc({ status: 'draft', id: issueId.toLowerCase() }), null, 2), 'utf-8');
    return workspacePath;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit:${code}`);
    });
  });

  it('does not stamp plan.status=proposed when beads creation fails (AC1)', async () => {
    const workspacePath = makeWorkspace('PAN-946');
    const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

    vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
      Effect.succeed({ success: false, created: [], errors: ['bd timed out'], beadIds: new Map() }),
    );

    await expect(planFinalizeCommand({ workspace: workspacePath, promote: false, qualityLint: false, prd: false }))
      .rejects.toThrow('process.exit:2');

    expect(readDoc(planPath).plan.status).toBe('draft');
  });

  it('stamps plan.status=proposed after beads creation succeeds (AC2)', async () => {
    const workspacePath = makeWorkspace('PAN-947');
    const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

    vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
      Effect.succeed({ success: true, created: ['PAN-947: Task one'], errors: [], beadIds: new Map() }),
    );

    await planFinalizeCommand({ workspace: workspacePath, promote: false, qualityLint: false, prd: false });

    const after = readDoc(planPath);
    expect(after.plan.status).toBe('proposed');
    expect(after.plan.metadata?.canonicalFilename).toMatch(/^\d{4}-\d{2}-\d{2}-PAN-947-/);
  });

  it('exits nonzero when beads succeed but promotion fails', async () => {
    const workspacePath = makeWorkspace('PAN-949');
    const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: 'complete-planning timed out after 90s',
    }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
      Effect.succeed({ success: true, created: ['PAN-949: Task one'], errors: [], beadIds: new Map() }),
    );

    await expect(planFinalizeCommand({ workspace: workspacePath, qualityLint: false, prd: false }))
      .rejects.toThrow('process.exit:1');

    const after = readDoc(planPath);
    expect(after.plan.status).toBe('proposed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs a clean finalize on retry after a prior beads failure (AC3)', async () => {
    const workspacePath = makeWorkspace('PAN-948');
    const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

    // First run fails.
    vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
      Effect.succeed({ success: false, created: [], errors: ['bd timed out'], beadIds: new Map() }),
    );
    await expect(planFinalizeCommand({ workspace: workspacePath, promote: false, qualityLint: false, prd: false }))
      .rejects.toThrow('process.exit:2');
    expect(readDoc(planPath).plan.status).toBe('draft');

    // Second run succeeds and stamps cleanly.
    vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
      Effect.succeed({ success: true, created: ['PAN-948: Task one'], errors: [], beadIds: new Map() }),
    );
    await planFinalizeCommand({ workspace: workspacePath, promote: false, qualityLint: false, prd: false });
    expect(readDoc(planPath).plan.status).toBe('proposed');
  });

  describe('PRD-first gate (PAN-2234)', () => {
    it('exits 4 before creating beads when no PRD draft exists anywhere', async () => {
      const workspacePath = makeWorkspace('PAN-2234');
      const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

      vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
        Effect.succeed({ success: true, created: ['PAN-2234: Task one'], errors: [], beadIds: new Map() }),
      );

      await expect(planFinalizeCommand({ workspace: workspacePath, promote: false, qualityLint: false }))
        .rejects.toThrow('process.exit:4');

      // Gate fires before beads creation — beads must not have run.
      expect(beadsModule.createBeadsFromVBrief).not.toHaveBeenCalled();
      // And the plan is untouched.
      expect(readDoc(planPath).plan.status).toBe('draft');
    });

    it('stamps plan.status=proposed with --no-prd even with no draft present', async () => {
      const workspacePath = makeWorkspace('PAN-2235');
      const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

      vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
        Effect.succeed({ success: true, created: ['PAN-2235: Task one'], errors: [], beadIds: new Map() }),
      );

      await planFinalizeCommand({ workspace: workspacePath, promote: false, qualityLint: false, prd: false });

      expect(readDoc(planPath).plan.status).toBe('proposed');
    });

    it('proceeds past the gate when a qualifying PRD draft is in the workspace', async () => {
      const issueId = 'PAN-2236';
      const workspacePath = makeWorkspace(issueId);
      const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');
      // Write a >=20-line PRD draft in the workspace drafts dir.
      mkdirSync(join(workspacePath, '.pan', 'drafts'), { recursive: true });
      writeFileSync(
        join(workspacePath, '.pan', 'drafts', `${issueId}.md`),
        Array.from({ length: 20 }, (_, i) => `PRD line ${i + 1}`).join('\n'),
        'utf-8',
      );

      vi.mocked(beadsModule.createBeadsFromVBrief).mockReturnValue(
        Effect.succeed({ success: true, created: [`${issueId}: Task one`], errors: [], beadIds: new Map() }),
      );

      // No prd:false — the gate must pass on its own.
      await planFinalizeCommand({ workspace: workspacePath, promote: false, qualityLint: false });

      expect(readDoc(planPath).plan.status).toBe('proposed');
    });
  });
});
