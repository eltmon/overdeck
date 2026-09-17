/**
 * Routes for the project-creation job lifecycle (PAN-3836 WI-2).
 *
 * These live apart from `projects.ts` for two reasons. The practical one is the
 * file-size ratchet — `projects.ts` is already a god file and may not grow. The
 * better one is that these five surfaces are one feature with one owner: they
 * all talk to `project-create-jobs.ts` and the shared creation core, and none of
 * them touch the rest of the project registry.
 *
 * Two contracts matter more than the shapes:
 *
 *   - **404 on a job poll means "unknown to this runtime", not "failed".** Jobs
 *     live in memory, so a restart erases them; answering "failed" would invite
 *     a retry that could clone a second copy into a directory the first clone
 *     may still be writing.
 *   - **Reconciliation is read-only.** It reports what canonical state can
 *     prove and nothing more. A matching project key alone is never success.
 *
 * Auth is explicit on every handler: the mutation guard (auth + origin + CSRF)
 * on the POSTs, the read guard on the poll — the API port binds 0.0.0.0 and a
 * job payload carries a filesystem path and git's stderr tail.
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getProjectSync } from '../../../lib/projects.js';
import { resolveProjectCreateRecovery } from '../../../lib/projects/create-recovery.js';
import { finishProjectSetup } from '../../../lib/projects/create-perform.js';
import {
  ProjectCreateFailureError,
  sanitizeCreationFailure,
} from '../../../lib/projects/create-errors.js';
import {
  getProjectCreateJob,
  requestProjectCreateJobCancel,
  getProjectCreateOperation,
} from './project-create-jobs.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import {
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
} from './dashboard-auth.js';
import { readProjectJsonBody } from './projects.js';

// ─── Route: GET /api/projects/create-jobs/:jobId ────────────────────────────
// PAN-3836: poll background job status during clone operations.
// Returns 404 if job not found (TTL expired or invalid ID), or 200 with job object.

const getProjectCreateJobRoute = HttpRouter.add(
  'GET',
  '/api/projects/create-jobs/:jobId',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const jobId = params['jobId'] ?? '';

    if (!jobId) {
      return jsonResponse({ error: 'jobId is required' }, { status: 400 });
    }

    const job = getProjectCreateJob(jobId);
    if (!job) {
      return jsonResponse({ error: 'Unknown job' }, { status: 404 });
    }

    return jsonResponse(job);
  })),
);

// ─── Route: POST /api/projects/create-jobs/:jobId/cancel ────────────────────
// PAN-3836 (D-19): ask a running clone to stop. Answers `cancelling`, never
// `cancelled` — the job is cancelled once its child closes and cleanup settles,
// which the client observes by polling.

const postProjectCreateJobCancelRoute = HttpRouter.add(
  'POST',
  '/api/projects/create-jobs/:jobId/cancel',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const jobId = params['jobId'] ?? '';
    if (!jobId) return jsonResponse({ error: 'jobId is required' }, { status: 400 });

    const outcome = requestProjectCreateJobCancel(jobId);
    switch (outcome.status) {
      case 'unknown-job':
        return jsonResponse({ error: 'Unknown job' }, { status: 404 });
      case 'cancelling':
        return jsonResponse({ status: 'cancelling', job: outcome.job }, { status: 202 });
      case 'cannot-cancel-setup':
        // The clone finished and config is being written; aborting now would
        // strand a half-registered project.
        return jsonResponse(
          { error: 'cannot-cancel-setup', job: outcome.job },
          { status: 409 },
        );
      case 'terminal':
        return jsonResponse({ status: outcome.job.status, job: outcome.job });
    }
  })),
);

// ─── Route: POST /api/projects/create-jobs/reconcile ─────────────────────────
// PAN-3836 (FR-17): read-only. Answers "what actually happened" from canonical
// state when the client lost contact or this runtime has no such job. It never
// registers, clones or repairs, and a matching key alone is never success.

const postProjectCreateReconcileRoute = HttpRouter.add(
  'POST',
  '/api/projects/create-jobs/reconcile',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const body = (yield* readProjectJsonBody) as {
      operationId?: unknown;
      jobId?: unknown;
      key?: unknown;
      expectedPath?: unknown;
      mode?: unknown;
      expectedRepoSlug?: unknown;
    };

    const mode = body.mode;
    if (mode !== 'clone' && mode !== 'existing' && mode !== 'new') {
      return jsonResponse({ error: "mode must be 'clone', 'existing', or 'new'" }, { status: 400 });
    }
    if (typeof body.key !== 'string' || typeof body.expectedPath !== 'string') {
      return jsonResponse({ error: 'key and expectedPath are required' }, { status: 400 });
    }

    // A job this runtime still owns is better evidence than anything on disk.
    if (typeof body.jobId === 'string') {
      const job = getProjectCreateJob(body.jobId);
      if (job) return jsonResponse({ status: 'job', job });
    }
    if (typeof body.operationId === 'string') {
      const operation = getProjectCreateOperation(body.operationId);
      if (operation?.settled?.result) {
        return jsonResponse({ status: 'completed', ...operation.settled.result });
      }
    }

    const outcome = yield* Effect.promise(() =>
      resolveProjectCreateRecovery({
        key: body.key as string,
        expectedPath: body.expectedPath as string,
        mode,
        expectedRepoSlug: typeof body.expectedRepoSlug === 'string' ? body.expectedRepoSlug : null,
      }),
    );
    return jsonResponse(outcome);
  })),
);

// ─── Route: POST /api/projects/:projectKey/finish-setup ─────────────────────
// PAN-3836 (FR-16): idempotent repair for a registered project whose setup did
// not finish. Never clones and never registers a new project.

const postProjectFinishSetupRoute = HttpRouter.add(
  'POST',
  '/api/projects/:projectKey/finish-setup',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    if (!key) return jsonResponse({ error: 'projectKey is required' }, { status: 400 });

    const body = (yield* readProjectJsonBody) as { expectedPath?: unknown };
    const project = getProjectSync(key);
    if (!project) return jsonResponse({ error: `Unknown project '${key}'` }, { status: 404 });

    // The browser's expectedPath is a claim to check, not an instruction: the
    // canonical registration decides where repair happens.
    const expectedPath =
      typeof body.expectedPath === 'string' && body.expectedPath ? body.expectedPath : project.path;

    const outcome = yield* Effect.promise(() =>
      finishProjectSetup({ key, expectedPath })
        .then((result) => ({ ok: true as const, result }))
        .catch((err: unknown) => ({
          ok: false as const,
          failure:
            err instanceof ProjectCreateFailureError ? err.failure : sanitizeCreationFailure(err),
        })),
    );

    if (!outcome.ok) {
      const status = outcome.failure.code === 'destination-conflict' ? 409 : 500;
      return jsonResponse(
        { error: outcome.failure.message, failure: outcome.failure },
        { status },
      );
    }
    return jsonResponse(outcome.result);
  })),
);
export const projectCreateJobRoutesLayer = Layer.mergeAll(
  getProjectCreateJobRoute,
  postProjectCreateJobCancelRoute,
  postProjectCreateReconcileRoute,
  postProjectFinishSetupRoute,
);
