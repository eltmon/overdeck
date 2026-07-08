import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RouteResult {
  status: number;
  body: {
    tieredExecution?: {
      effective: boolean;
      source: 'issue-override' | 'plan-metadata' | 'global';
      override: 'on' | 'off' | null;
    };
  };
}

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_OVERDECK_HOME = process.env.OVERDECK_HOME;
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
        title: 'Tiered execution plan response',
        status: 'running',
        metadata,
        items: [],
        edges: [],
      },
    }),
    'utf-8',
  );
}

function writeTieredExecutionOverride(issueId: string, override: 'on' | 'off'): void {
  const recordDir = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`, '.pan', 'records');
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(
    join(recordDir, `${issueId.toLowerCase()}.json`),
    JSON.stringify({
      issueId: issueId.toUpperCase(),
      schemaVersion: 1,
      tieredExecutionOverride: override,
      pipeline: {},
      closeOut: {},
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

async function requestPlan(issueId: string): Promise<RouteResult> {
  const { workspaceDataRouteLayer } = await import('../workspaces/workspace-data.js');
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/workspaces/${issueId}/plan`));
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

describe('GET /api/workspaces/:issueId/plan tieredExecution', () => {
  beforeEach(() => {
    vi.resetModules();
    tempRoot = mkdtempSync(join(tmpdir(), 'workspace-plan-tiered-'));
    projectRoot = join(tempRoot, 'project');
    mkdirSync(join(projectRoot, '.git'), { recursive: true });
    writeProjectConfig();
    process.chdir(projectRoot);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    if (ORIGINAL_OVERDECK_HOME === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = ORIGINAL_OVERDECK_HOME;
    rmSync(tempRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  it('returns source issue-override and the raw record override when the record sets one', async () => {
    const issueId = 'PAN-9001';
    writeTieredExecutionConfig(false);
    writePlan(issueId, { tiered_execution: 'on' });
    writeTieredExecutionOverride(issueId, 'off');

    const result = await requestPlan(issueId);

    expect(result.status).toBe(200);
    expect(result.body.tieredExecution).toEqual({
      effective: false,
      source: 'issue-override',
      override: 'off',
    });
  }, 15_000);

  it('returns source plan-metadata when only plan.metadata.tiered_execution is set', async () => {
    const issueId = 'PAN-9002';
    writeTieredExecutionConfig(false);
    writePlan(issueId, { tiered_execution: 'on' });

    const result = await requestPlan(issueId);

    expect(result.status).toBe(200);
    expect(result.body.tieredExecution).toEqual({
      effective: true,
      source: 'plan-metadata',
      override: null,
    });
  }, 15_000);

  it('returns source global when neither record nor plan metadata sets an override', async () => {
    const issueId = 'PAN-9003';
    writeTieredExecutionConfig(false);
    writePlan(issueId);

    const result = await requestPlan(issueId);

    expect(result.status).toBe(200);
    expect(result.body.tieredExecution).toEqual({
      effective: false,
      source: 'global',
      override: null,
    });
  }, 15_000);
});
