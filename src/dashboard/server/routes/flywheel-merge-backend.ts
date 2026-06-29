import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { getMergeBackendStatus, type MergeBackendStatus } from '../../../lib/github-app.js';
import { httpHandler } from './http-handler.js';

interface MergeBackendDeps {
  getStatus?: () => Promise<MergeBackendStatus>;
}

export async function getMergeBackendPayload(deps: MergeBackendDeps = {}): Promise<MergeBackendStatus> {
  return (deps.getStatus ?? getMergeBackendStatus)();
}

export const getMergeBackendRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/merge-backend',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => jsonResponse(await getMergeBackendPayload()));
  })),
);
