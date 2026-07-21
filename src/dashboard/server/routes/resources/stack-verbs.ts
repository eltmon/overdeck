import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { httpHandler } from '../http-handler.js';
import { dockerActionErrorPayload } from './containers.js';
import { getCurrentDockerStats } from './shared.js';
import { getResourceStacks, type ResourceStack } from './stacks.js';

const execFileAsync = promisify(execFile);

type DockerStackVerbExec = typeof execFileAsync;
type StackVerb = 'start' | 'stop' | 'pause';

export interface StackVerbResult {
  containerId: string;
  ok: boolean;
  output?: string;
  error?: string;
}

let dockerStackVerbExec: DockerStackVerbExec = execFileAsync;

export function setDockerStackVerbExecForTests(execImpl: DockerStackVerbExec): void {
  dockerStackVerbExec = execImpl;
}

export function resetDockerStackVerbExecForTests(): void {
  dockerStackVerbExec = execFileAsync;
}

export const postStartStackRoute = HttpRouter.add(
  'POST',
  '/api/resources/stacks/:issueId/start',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    return yield* dockerStackVerbEffect(params['issueId'] ?? '', 'start');
  })),
);

export const postStopStackRoute = HttpRouter.add(
  'POST',
  '/api/resources/stacks/:issueId/stop',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    return yield* dockerStackVerbEffect(params['issueId'] ?? '', 'stop');
  })),
);

export const postPauseStackRoute = HttpRouter.add(
  'POST',
  '/api/resources/stacks/:issueId/pause',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    return yield* dockerStackVerbEffect(params['issueId'] ?? '', 'pause');
  })),
);

export function dockerStackVerbEffect(
  issue: string,
  verb: StackVerb,
): Effect.Effect<ReturnType<typeof jsonResponse>, never, EventStoreService> {
  return Effect.gen(function* () {
    const issueId = issue.trim().toUpperCase();
    const stack = findStack(issueId);
    if (!stack) {
      return jsonResponse({ ok: false, error: `Stack not found for ${issueId || issue}` }, { status: 404 });
    }

    const results: StackVerbResult[] = [];
    for (const service of stack.services) {
      if (!isDockerIdentifier(service.id)) {
        results.push({
          containerId: service.id,
          ok: false,
          error: 'Invalid container ID',
        });
        continue;
      }
      const args = argsFor(service.id, service.status, verb);
      const timeout = verb === 'stop' ? 35000 : 30000;
      const result = yield* Effect.tryPromise({
        try: () => dockerStackVerbExec('docker', args, { encoding: 'utf-8', timeout }),
        catch: (error) => error,
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed({
            containerId: service.id,
            ok: false,
            error: dockerActionErrorPayload(error).error,
          }),
          onSuccess: ({ stdout }) => Effect.succeed({
            containerId: service.id,
            ok: true,
            output: stdout.trim(),
          }),
        }),
      );
      results.push(result);
    }

    const containers = getCurrentDockerStats();
    const eventStore = yield* EventStoreService;
    yield* eventStore.append({
      type: 'resources.updated',
      timestamp: new Date().toISOString(),
      payload: { resources: { containers } },
    });

    return jsonResponse({
      ok: results.every((result) => result.ok),
      issueId,
      action: verb,
      results,
      containers,
    });
  });
}

function argsFor(containerId: string, status: string | undefined, verb: StackVerb): string[] {
  if (verb === 'stop') return ['stop', '--time', '30', containerId];
  if (verb === 'pause') return ['pause', containerId];
  if (status === 'paused') return ['unpause', containerId];
  return ['start', containerId];
}

function isDockerIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
}

function findStack(issueId: string): ResourceStack | undefined {
  return getResourceStacks(getCurrentDockerStats() as Parameters<typeof getResourceStacks>[0])
    .find((stack) => stack.issueId?.toUpperCase() === issueId);
}
