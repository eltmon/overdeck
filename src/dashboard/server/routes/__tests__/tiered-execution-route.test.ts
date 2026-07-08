import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  spawnPanCommand: vi.fn(),
}));

vi.mock('../workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workspaces.js')>();
  return {
    ...actual,
    spawnPanCommand: routeMocks.spawnPanCommand,
  };
});

interface RouteResult {
  status: number;
  body: {
    error?: string;
    tieredExecution?: {
      effective: boolean;
      source: 'issue-override' | 'plan-metadata' | 'global';
      override: 'on' | 'off' | null;
    };
  };
}

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_OVERDECK_HOME = process.env.OVERDECK_HOME;
const ORIGINAL_API_PORT = process.env.API_PORT;
let tempRoot: string;
let projectRoot: string;

function writeProjectConfig(): void {
  const overdeckHome = join(tempRoot, 'overdeck-home');
  mkdirSync(overdeckHome, { recursive: true });
  process.env.OVERDECK_HOME = overdeckHome;
  writeFileSync(
    join(overdeckHome, 'projects.yaml'),
    [
      'projects:',
      '  overdeck-test:',
      '    name: Overdeck Test',
      `    path: ${JSON.stringify(projectRoot)}`,
      '    issue_prefix: PAN',
      '',
    ].join('\n'),
    'utf-8',
  );
}

function writePlan(issueId: string, metadata: Record<string, unknown> = {}): void {
  const workspacePath = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
  mkdirSync(join(workspacePath, '.pan'), { recursive: true });
  writeFileSync(
    join(workspacePath, '.pan', 'spec.vbrief.json'),
    JSON.stringify({
      vBRIEFInfo: { version: '0.6', created: '2026-07-05T00:00:00.000Z' },
      plan: {
        id: issueId.toLowerCase(),
        title: 'Tiered execution write route',
        status: 'running',
        metadata,
        items: [],
        edges: [],
      },
    }),
    'utf-8',
  );
}

function writeTieredExecutionConfig(enabled: boolean): void {
  writeFileSync(
    join(projectRoot, '.pan.yaml'),
    [
      'tiered_execution:',
      `  enabled: ${enabled ? 'true' : 'false'}`,
      '',
    ].join('\n'),
    'utf-8',
  );
}

async function requestTieredExecution(
  issueId: string,
  body: unknown,
  headers: Record<string, string> = { origin: 'http://localhost:3011' },
): Promise<RouteResult> {
  const { workspaceDataRouteLayer } = await import('../workspaces/workspace-data.js');
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/workspaces/${issueId}/tiered-execution`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(workspaceDataRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('PATCH /api/workspaces/:issueId/tiered-execution', () => {
  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'workspace-tiered-route-'));
    projectRoot = join(tempRoot, 'project');
    mkdirSync(join(projectRoot, '.git'), { recursive: true });
  });

  beforeEach(() => {
    vi.resetModules();
    routeMocks.spawnPanCommand.mockReset();
    process.env.API_PORT = '3011';
    writeProjectConfig();
    process.chdir(projectRoot);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    if (ORIGINAL_OVERDECK_HOME === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = ORIGINAL_OVERDECK_HOME;
    if (ORIGINAL_API_PORT === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = ORIGINAL_API_PORT;
    vi.resetModules();
  });

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists a valid override via the record write door and survives a fresh read', async () => {
    const issueId = 'PAN-9101';
    writeTieredExecutionConfig(false);
    writePlan(issueId);

    const result = await requestTieredExecution(issueId, { override: 'on' });

    expect(result.status).toBe(200);
    expect(result.body.tieredExecution).toEqual({
      effective: true,
      source: 'issue-override',
      override: 'on',
    });

    const { readIssueRecordSync, resolveProjectForIssue } = await import('../../../../lib/pan-dir/record.js');
    const project = resolveProjectForIssue(issueId);
    expect(project).not.toBeNull();
    expect(readIssueRecordSync(project!, issueId)?.tieredExecutionOverride).toBe('on');
    expect(routeMocks.spawnPanCommand).not.toHaveBeenCalled();
  }, 15_000);

  it('rejects invalid override values without mutating the existing record', async () => {
    const issueId = 'PAN-9102';
    writeTieredExecutionConfig(false);
    writePlan(issueId);
    const setupResult = await requestTieredExecution(issueId, { override: 'off' });
    expect(setupResult.status).toBe(200);

    const result = await requestTieredExecution(issueId, { override: 'maybe' });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid tiered-execution override' });

    const { readIssueRecordSync, resolveProjectForIssue } = await import('../../../../lib/pan-dir/record.js');
    const project = resolveProjectForIssue(issueId);
    expect(readIssueRecordSync(project!, issueId)?.tieredExecutionOverride).toBe('off');
    expect(routeMocks.spawnPanCommand).not.toHaveBeenCalled();
  }, 15_000);

  it('clears the record override when override is null', async () => {
    const issueId = 'PAN-9103';
    writeTieredExecutionConfig(false);
    writePlan(issueId, { tiered_execution: 'on' });
    const setupResult = await requestTieredExecution(issueId, { override: 'off' });
    expect(setupResult.status).toBe(200);

    const result = await requestTieredExecution(issueId, { override: null });

    expect(result.status).toBe(200);
    expect(result.body.tieredExecution).toEqual({
      effective: true,
      source: 'plan-metadata',
      override: null,
    });

    const { readIssueRecordSync, resolveProjectForIssue } = await import('../../../../lib/pan-dir/record.js');
    const project = resolveProjectForIssue(issueId);
    expect(readIssueRecordSync(project!, issueId)?.tieredExecutionOverride).toBeUndefined();
    expect(routeMocks.spawnPanCommand).not.toHaveBeenCalled();
  }, 15_000);

  it('rejects requests without a trusted mutation origin', async () => {
    const issueId = 'PAN-9104';
    writeTieredExecutionConfig(false);
    writePlan(issueId);

    const result = await requestTieredExecution(issueId, { override: 'on' }, {});

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Missing origin' });
    expect(routeMocks.spawnPanCommand).not.toHaveBeenCalled();
  }, 15_000);
});
