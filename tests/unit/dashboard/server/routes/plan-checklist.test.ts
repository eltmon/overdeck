import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INTERNAL_TOKEN_HEADER } from '../../../../../src/lib/internal-token.js';

const routeMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
}));

vi.mock('../../../../../src/lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/agents.js')>();
  return { ...actual, getAgentState: routeMocks.getAgentState };
});

import { postAgentPlanChecklistRoute } from '../../../../../src/dashboard/server/routes/agents/runtime-events.js';

let projectPath: string;
let workspace: string;

async function writePlan(status: 'pending' | 'completed'): Promise<void> {
  const planDir = join(workspace, '.overdeck');
  await mkdir(planDir, { recursive: true });
  await writeFile(join(planDir, 'spec.vbrief.json'), JSON.stringify({
    xBRIEFInfo: {
      version: '0.8',
      created: '2026-08-01T00:00:00.000Z',
      author: 'overdeck/test',
      description: 'Plan checklist route fixture',
    },
    plan: {
      id: 'pan-3451',
      title: 'Plan checklist route fixture',
      status: 'running',
      uid: '20c18fe7-f0fe-4d1e-a7dd-bfc2234496a7',
      author: 'agent:test',
      sequence: 1,
      created: '2026-08-01T00:00:00.000Z',
      updated: '2026-08-01T00:00:00.000Z',
      items: [{
        id: 'check-extension-evidence',
        title: 'Check extension completion evidence',
        status,
        created: '2026-08-01T00:00:00.000Z',
      }],
      edges: [],
    },
  }));
}

async function postPlanChecklist(options: { token?: string; agentId?: string } = {}): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const headers = options.token === undefined
    ? {}
    : { [INTERNAL_TOKEN_HEADER]: options.token };
  const request = HttpServerRequest.fromWeb(new Request(
    `http://localhost/api/agents/${options.agentId ?? 'agent-pan-3451'}/plan-checklist`,
    { method: 'POST', headers },
  ));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(postAgentPlanChecklistRoute), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
  ));
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'pan-3451-plan-checklist-'));
  workspace = join(projectPath, 'workspaces', 'feature-pan-3451');
  await mkdir(workspace, { recursive: true });
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  routeMocks.getAgentState.mockReset();
  routeMocks.getAgentState.mockReturnValue(Effect.succeed({
    id: 'agent-pan-3451',
    issueId: 'PAN-3451',
    workspace,
    role: 'work',
    model: 'test-model',
    status: 'running',
    startedAt: '2026-08-01T00:00:00.000Z',
  }));
});

afterEach(async () => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  await rm(projectPath, { recursive: true, force: true });
});

describe('POST /api/agents/:id/plan-checklist', () => {
  it('returns complete when every plan item is terminal', async () => {
    await writePlan('completed');

    const result = await postPlanChecklist({ token: 'test-token' });

    expect(result).toEqual({
      status: 200,
      body: { success: true, complete: true, incomplete: [] },
    });
  });

  it('returns the pending item when the plan is incomplete', async () => {
    await writePlan('pending');

    const result = await postPlanChecklist({ token: 'test-token' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, complete: false });
    expect(result.body['incomplete']).toEqual(expect.arrayContaining([
      expect.stringContaining('check-extension-evidence'),
    ]));
  });

  it('rejects a request without the internal token', async () => {
    await writePlan('completed');

    const result = await postPlanChecklist();

    expect(result).toEqual({
      status: 403,
      body: { success: false, error: 'forbidden' },
    });
  });

  it('returns 422 when the agent has no resolvable workspace', async () => {
    routeMocks.getAgentState.mockReturnValue(Effect.succeed(null));

    const result = await postPlanChecklist({ token: 'test-token', agentId: 'missing-agent' });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ success: false });
  });
});
