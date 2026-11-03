/**
 * Deft pipeline routes (PAN-4849 WI-2, FR-13, FR-17).
 *
 * - `GET /api/issues/:id/deft` — the issue's Directive state, read from its
 *   worktree by `readDeftIssueState` (fs only).
 * - `GET /api/deft/issues` — one `DeftIssueSummary` per Deft issue, for the
 *   board, the tree row and the pipeline strip.
 * - `POST /api/issues/:id/pipeline` — Run on Deft / Back to Overdeck. It
 *   shells `pan skills deft use|back <ID>` (the one write door, PAN-4820
 *   AD-2) with async `spawn`, answers 202 at once, and records the outcome
 *   in the activity feed when the child exits.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DeftIssueSummary } from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { buildChildEnvWithoutTmux } from '../../../lib/child-env.js';
import { isDeftPipelineIssue } from '../../../lib/deft/issue-pipeline.js';
import { readDeftIssueState, summarizeDeftIssueState } from '../../../lib/deft/state-reader.js';
import { parseIssueId } from '../../../lib/issue-id.js';
import { getIssueWorkspacePath } from '../../../lib/overdeck/issue-projects.js';
import { PAN_DIRNAME } from '../../../lib/pan-dir/types.js';
import { listProjectsAsync } from '../../../lib/projects.js';
import { planHomeFor, readIssueFile } from '../../../lib/skill-overrides/issue-file.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

const SUMMARY_CONCURRENCY = 4;
const STDERR_TAIL_LINES = 5;

export type DeftPipelineSpawner = (args: string[], env: Record<string, string>) => ChildProcess;

const defaultSpawner: DeftPipelineSpawner = (args, env) =>
  nodeSpawn('pan', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });

let spawner: DeftPipelineSpawner = defaultSpawner;
const runningSwitches = new Set<string>();

/** Replace the `pan` spawner; pass null to restore the real one. */
export function setDeftPipelineSpawnerForTests(fn: DeftPipelineSpawner | null): void {
  spawner = fn ?? defaultSpawner;
}

function zeroSummary(issueId: string): DeftIssueSummary {
  return { issueId, scopeCounts: {}, specDriftUnresolved: 0, installDrift: 0, handoffState: null, openEscalations: 0 };
}

/** Upper-case issue ids whose skill-override file holds `pipeline: deft`, across every project. */
async function listDeftIssueIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const project of await listProjectsAsync()) {
    const dir = join(planHomeFor(project.config), PAN_DIRNAME, 'skill-overrides');
    let names: string[];
    try {
      names = (await readdir(dir)).filter(name => name.endsWith('.yaml')).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        if ((await readIssueFile(join(dir, name))).pipeline === 'deft') ids.add(name.slice(0, -'.yaml'.length).toUpperCase());
      } catch {
        // An unreadable override file is not a Deft issue.
      }
    }
  }
  return [...ids].sort();
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const getDeftIssueRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/deft',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueId(id)) return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    const issueId = id.toUpperCase();
    return yield* Effect.promise(async () => {
      if (!(await isDeftPipelineIssue(issueId))) {
        return jsonResponse({ error: `${issueId} does not run on Deft` }, { status: 404 });
      }
      const worktree = getIssueWorkspacePath(issueId);
      if (!worktree) return jsonResponse({ error: 'no workspace' }, { status: 404 });
      return jsonResponse(await readDeftIssueState(worktree, issueId));
    });
  }),
);

const getDeftIssuesRoute = HttpRouter.add(
  'GET',
  '/api/deft/issues',
  Effect.promise(async () => {
    const issues = await mapWithConcurrency(await listDeftIssueIds(), SUMMARY_CONCURRENCY, async issueId => {
      const worktree = getIssueWorkspacePath(issueId);
      return worktree ? summarizeDeftIssueState(await readDeftIssueState(worktree, issueId)) : zeroSummary(issueId);
    });
    return jsonResponse({ issues });
  }),
);

function startPipelineSwitch(issueId: string, pipeline: 'deft' | 'overdeck', start: boolean): void {
  const args = ['skills', 'deft', pipeline === 'deft' ? 'use' : 'back', issueId];
  if (pipeline === 'deft' && start) args.push('--start');
  runningSwitches.add(issueId);
  const env = buildChildEnvWithoutTmux(process.env, { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` });
  let stderr = '';
  let finished = false;
  const finish = (ok: boolean): void => {
    if (finished) return;
    finished = true;
    runningSwitches.delete(issueId);
    const tail = stderr.trim().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
    emitActivityEntry({
      source: 'dashboard',
      level: ok ? 'info' : 'error',
      message: ok ? `Switched ${issueId} to ${pipeline}` : `Pipeline switch for ${issueId} failed: ${tail}`,
      issueId,
    });
  };
  let child: ChildProcess;
  try {
    child = spawner(args, env);
  } catch (error) {
    stderr = (error as Error).message;
    finish(false);
    return;
  }
  child.stdout?.resume();
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  child.on('error', error => {
    stderr += `${error.message}\n`;
    finish(false);
  });
  child.on('exit', code => finish(code === 0));
  child.unref?.();
}

const postPipelineRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/pipeline',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueId(id)) return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    const issueId = id.toUpperCase();

    const text = yield* request.text;
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return jsonResponse({ error: 'body must be a JSON object' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    }
    const pipeline = body['pipeline'];
    if (pipeline !== 'deft' && pipeline !== 'overdeck') {
      return jsonResponse({ error: "pipeline must be 'deft' or 'overdeck'" }, { status: 400 });
    }
    if (body['start'] !== undefined && typeof body['start'] !== 'boolean') {
      return jsonResponse({ error: 'start must be a boolean' }, { status: 400 });
    }
    if (runningSwitches.has(issueId)) {
      return jsonResponse({ error: `a pipeline switch for ${issueId} is already running` }, { status: 409 });
    }
    startPipelineSwitch(issueId, pipeline, body['start'] === true);
    return jsonResponse({ accepted: true, issueId, pipeline }, { status: 202 });
  }),
);

export const deftRouteLayer = Layer.mergeAll(getDeftIssueRoute, getDeftIssuesRoute, postPipelineRoute);
