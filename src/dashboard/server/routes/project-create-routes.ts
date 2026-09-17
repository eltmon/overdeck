/**
 * Routes for project creation and its job lifecycle (PAN-3836 WI-2).
 *
 * These live apart from `projects.ts` for two reasons. The practical one is the
 * file-size ratchet — `projects.ts` is already a god file and may not grow. The
 * better one is that these surfaces are one feature with one owner: they all
 * talk to `project-create-jobs.ts` and the shared creation core, and none of
 * them touch the rest of the project registry. `POST /api/projects` belongs
 * here for the same reason — it is the write door those job routes report on,
 * and splitting it from them is what let its reservation go unwired.
 *
 * Three contracts matter more than the shapes:
 *
 *   - **The reservation is taken after the intent resolves, and every exit past
 *     it settles.** The fingerprint and destination are only known once the
 *     intent is resolved, and a path left reserved is a path no later attempt
 *     can ever use, because `settleProjectCreateOperation` is the only thing
 *     that releases it.
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

import { randomUUID } from 'node:crypto';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getProjectSync } from '../../../lib/projects.js';
import { resolveProjectCreateRecovery } from '../../../lib/projects/create-recovery.js';
import { finishProjectSetup, performProjectCreate } from '../../../lib/projects/create-perform.js';
import {
  ProjectCreateFailureError,
  sanitizeCreationFailure,
} from '../../../lib/projects/create-errors.js';
import {
  getProjectCreateJob,
  requestProjectCreateJobCancel,
  getProjectCreateOperation,
  reserveProjectCreateOperation,
  settleProjectCreateOperation,
  startProjectCreateJob,
} from './project-create-jobs.js';
import { DuplicateProjectError } from '../../../lib/project-registration.js';
import {
  resolveProjectCreateIntent,
  type ProjectCreateInput,
} from '../../../lib/projects/create.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import {
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
} from './dashboard-auth.js';
import { readProjectJsonBody } from './project-body.js';

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
      // The client lost its job id along with the POST response, but the
      // operation id survived in its stored observation. That is enough to hand
      // the live job back instead of falling through to disk inspection, which
      // would see a half-written clone and call it a conflict.
      if (operation?.jobId) {
        const job = getProjectCreateJob(operation.jobId);
        if (job) return jsonResponse({ status: 'job', job });
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
// ─── Route: POST /api/projects ───────────────────────────────────────────────
// PAN-1970: register a project in mode='existing' or create one in mode='new'.

const postProjectsRoute = HttpRouter.add(
  'POST',
  '/api/projects',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const body = (yield* readProjectJsonBody) as {
      mode?: unknown;
      url?: unknown;
      path?: unknown;
      parentDir?: unknown;
      name?: unknown;
      issuePrefix?: unknown;
      operationId?: unknown;
    };

    // Validate mode
    const mode = body.mode;
    if (mode !== 'clone' && mode !== 'existing' && mode !== 'new') {
      return jsonResponse({ error: "mode must be 'clone', 'existing', or 'new'" }, { status: 400 });
    }

    // A client that sends no operation id still gets target exclusion; it simply
    // cannot attach a retry, because it has nothing to correlate with.
    const operationId = typeof body.operationId === 'string' && body.operationId
      ? body.operationId
      : randomUUID();

    const input: ProjectCreateInput = {
      mode,
      url: typeof body.url === 'string' ? body.url : undefined,
      path: typeof body.path === 'string' ? body.path : undefined,
      parentDir: typeof body.parentDir === 'string' ? body.parentDir : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      issuePrefix: typeof body.issuePrefix === 'string' ? body.issuePrefix : undefined,
      homeBoundary: true,
      refreshRemote: true,
    };

    // Resolve intent first to check for findings
    const intent = yield* Effect.promise(() => resolveProjectCreateIntent(input));

    // If there are findings, return 422 with them. Deliberately before the
    // reservation: a rejected request claims nothing, so nothing needs releasing.
    if (intent.findings.length > 0) {
      return jsonResponse({ findings: intent.findings }, { status: 422 });
    }

    // Reserve *after* resolve, despite PRD §7's "before async fresh validation"
    // wording: the reservation keys on the resolved destination and fingerprint,
    // so reserving earlier would claim an empty target. What §7 actually protects
    // — no write escaping the guard — holds, because every write is below here.
    const reservation = reserveProjectCreateOperation({ operationId, intent });
    if (reservation.status === 'conflict' || reservation.status === 'target-busy') {
      return jsonResponse({ error: reservation.reason, code: reservation.status }, { status: 409 });
    }
    if (reservation.status === 'joined') {
      // Same id, same input: attach to the attempt already in flight or settled
      // rather than starting a second one.
      const existing = reservation.operation;
      if (existing.settled?.result) {
        const done = existing.settled.result;
        return jsonResponse({ key: done.key, name: done.name, path: done.path, operationId });
      }
      if (existing.settled?.failure) {
        return jsonResponse(
          { error: existing.settled.failure.message, failure: existing.settled.failure },
          { status: 500 },
        );
      }
      if (existing.jobId && getProjectCreateJob(existing.jobId)) {
        return jsonResponse({ jobId: existing.jobId, operationId }, { status: 202 });
      }
      // Reserved but not yet started (two requests racing the same tick): the
      // caller polls reconcile rather than getting a second job.
      return jsonResponse({ operationId, status: 'preparing' }, { status: 202 });
    }

    // For clone mode, start a background job and return 202
    if (intent.mode === 'clone') {
      const jobId = startProjectCreateJob(intent, { operationId });
      return jsonResponse({ jobId, operationId }, { status: 202 });
    }

    // For existing/new modes, perform the create and return the result
    const created = yield* Effect.promise(() =>
      performProjectCreate(intent)
        .then((result) => ({ ok: true as const, result }))
        .catch((err: unknown) => {
          if (err instanceof DuplicateProjectError) {
            return { ok: false as const, status: 409, error: `project key '${err.key}' is already registered`, key: err.key, existingPath: err.existingPath };
          }
          // 409 means "already registered"; a permission error or a failed git init
          // is a server-side failure, and the UI renders the two differently.
          return { ok: false as const, status: 500, error: err instanceof Error ? err.message : String(err) };
        }),
    );

    if (!created.ok) {
      // Settle on the failure path too. settleProjectCreateOperation is the only
      // caller of releaseTarget, so returning without it pins this destination as
      // target-busy for the life of the process.
      settleProjectCreateOperation(operationId, {
        failure: created.key
          ? { code: 'destination-conflict', message: created.error, retrySafe: false }
          : { code: 'internal-error', message: created.error, retrySafe: true },
      });
      return jsonResponse(
        { error: created.error, ...(created.key ? { key: created.key, existingPath: created.existingPath } : {}) },
        { status: created.status },
      );
    }

    settleProjectCreateOperation(operationId, { result: created.result });
    return jsonResponse({
      key: created.result.key,
      name: created.result.name,
      path: created.result.path,
      operationId,
    });
  })),
);


export const projectCreateJobRoutesLayer = Layer.mergeAll(
  getProjectCreateJobRoute,
  postProjectCreateJobCancelRoute,
  postProjectCreateReconcileRoute,
  postProjectFinishSetupRoute,
  postProjectsRoute,
);
