/**
 * Tests for project-create routes (PAN-3836 WI-3).
 *
 * Tests POST /api/projects/resolve (dry-run validation),
 * GET /api/projects/create-jobs/:jobId (job status polling),
 * and POST /api/projects (create/start).
 *
 * Uses the same HttpServerRequest.fromWeb() pattern as workspace-registry tests.
 * Mocks resolveProjectCreateIntent and performProjectCreate; uses real job store
 * to exercise the full flow from 202→polling→404 after TTL.
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedProjectIntent, ProjectCreateResult } from '../../../../src/lib/projects/create.js';

const routeMocks = vi.hoisted(() => ({
  resolveProjectCreateIntent: vi.fn(),
  performProjectCreate: vi.fn(),
  rejectUnsafeDashboardMutationRequest: vi.fn(),
  rejectUnauthorizedDashboardRequest: vi.fn(),
  finishProjectSetup: vi.fn(),
  resolveProjectCreateRecovery: vi.fn(),
  getProjectSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects/create.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/projects/create.js')>(
    '../../../../src/lib/projects/create.js',
  );
  return { ...actual, resolveProjectCreateIntent: routeMocks.resolveProjectCreateIntent };
});

vi.mock('../../../../src/lib/projects/create-perform.js', () => ({
  performProjectCreate: routeMocks.performProjectCreate,
  finishProjectSetup: routeMocks.finishProjectSetup,
}));

vi.mock('../../../../src/lib/projects/create-recovery.js', () => ({
  resolveProjectCreateRecovery: routeMocks.resolveProjectCreateRecovery,
}));

vi.mock('../../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/projects.js')>(
    '../../../../src/lib/projects.js',
  );
  return { ...actual, getProjectSync: routeMocks.getProjectSync };
});

vi.mock('../../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: routeMocks.rejectUnsafeDashboardMutationRequest,
  rejectUnauthorizedDashboardRequest: routeMocks.rejectUnauthorizedDashboardRequest,
}));

import { projectsRouteLayer } from '../../../../src/dashboard/server/routes/projects.js';
import { __resetProjectCreateJobsForTests, JOB_TTL_MS } from '../../../../src/dashboard/server/routes/project-create-jobs.js';
import { DuplicateProjectError } from '../../../../src/lib/project-registration.js';

function makeResolvedIntent(mode: 'clone' | 'existing' | 'new', overrides: Partial<ResolvedProjectIntent> = {}): ResolvedProjectIntent {
  return {
    mode,
    key: 'test-proj',
    name: 'Test Project',
    path: '/home/user/Projects/test-proj',
    cloneUrl: mode === 'clone' ? 'https://github.com/o/r' : null,
    provider: mode === 'clone' ? 'github' : null,
    repoSlug: mode === 'clone' ? 'o/r' : null,
    defaultBranch: mode === 'clone' ? 'main' : null,
    remoteChecked: mode === 'clone',
    isGitRepository: true,
    gitRoot: null,
    parentDir: '/home/user/Projects',
    homeDir: '/home/user',
    proposedIssuePrefix: 'TP',
    registeredKeyAtPath: null,
    wouldClone: mode === 'clone',
    wouldGitInit: mode === 'new',
    willCreateMainWorkspace: true,
    findings: [],
    ...overrides,
  };
}

async function requestProjectsRoute(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(projectsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) {
    if (typeof mock === 'function' && mock.mockReset) {
      mock.mockReset();
    }
  }
  __resetProjectCreateJobsForTests();
  routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(null);
  routeMocks.rejectUnauthorizedDashboardRequest.mockReturnValue(null);
  routeMocks.finishProjectSetup.mockReset();
  routeMocks.resolveProjectCreateRecovery.mockReset();
  routeMocks.getProjectSync.mockReset();
  routeMocks.getProjectSync.mockReturnValue({ name: 'Test Project', path: '/home/user/Projects/test-proj' });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('project-create routes', () => {
  // ─── POST /api/projects/resolve ──────────────────────────────────────────

  describe('POST /api/projects/resolve', () => {
    it('AC1.1: returns 400 if mode is not clone/existing/new', async () => {
      const { status, body } = await requestProjectsRoute('/api/projects/resolve', {
        method: 'POST',
        body: JSON.stringify({ mode: 'invalid' }),
      });

      expect(status).toBe(400);
      expect(body).toHaveProperty('error');
    });

    it('AC1.2: returns 400 if request body is empty', async () => {
      const { status, body } = await requestProjectsRoute('/api/projects/resolve', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      expect(status).toBe(400);
      expect(body).toHaveProperty('error');
    });

    it('AC1.3: returns 200 with resolved intent for valid clone mode', async () => {
      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);

      const { status, body } = await requestProjectsRoute('/api/projects/resolve', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        mode: 'clone',
        key: 'test-proj',
        wouldClone: true,
      });
    });

    it('AC1.4: returns 200 with findings when validation fails', async () => {
      const intent = makeResolvedIntent('clone', {
        findings: [
          {
            field: 'url',
            code: 'url-invalid',
            message: 'Invalid URL',
          },
        ],
      });
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);

      const { status, body } = await requestProjectsRoute('/api/projects/resolve', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'not-a-url' }),
      });

      expect(status).toBe(200);
      expect(body).toHaveProperty('findings');
      expect((body as any).findings).toHaveLength(1);
    });

    it('AC1.5: enforces homeBoundary and reads the probe memo instead of refreshing', async () => {
      const intent = makeResolvedIntent('existing');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);

      await requestProjectsRoute('/api/projects/resolve', {
        method: 'POST',
        body: JSON.stringify({ mode: 'existing', path: '/home/user/proj' }),
      });

      const input = routeMocks.resolveProjectCreateIntent.mock.calls[0][0];
      expect(input).toEqual(expect.objectContaining({ homeBoundary: true }));
      // This route runs once per settled keystroke; forcing a refresh here would
      // spawn a `git ls-remote` per character typed.
      expect(input.refreshRemote).toBeFalsy();
    });
  });

  // ─── GET /api/projects/create-jobs/:jobId ───────────────────────────────

  describe('GET /api/projects/create-jobs/:jobId', () => {
    it('rejects an unauthenticated poll before it can read a job', async () => {
      // The job payload carries a filesystem path and up to 20 lines of git stderr.
      routeMocks.rejectUnauthorizedDashboardRequest.mockReturnValue(
        new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      );

      const { status } = await requestProjectsRoute('/api/projects/create-jobs/any-id');

      expect(status).toBe(401);
    });

    it('AC2.1: returns 404 when job does not exist', async () => {
      const { status, body } = await requestProjectsRoute('/api/projects/create-jobs/nonexistent-id');

      expect(status).toBe(404);
      expect(body).toHaveProperty('error', 'Unknown job');
    });

    it('AC2.2: returns 404 if jobId is empty (route not found)', async () => {
      await expect(requestProjectsRoute('/api/projects/create-jobs/')).rejects.toThrow(/RouteNotFound/);
    });

    it('AC2.3: returns 200 with the job\'s current lifecycle status', async () => {
      // Create a job via the clone path
      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockImplementation(
        (_, hooks) => {
          hooks.onProgress?.({ phase: 'cloning', percent: 50 });
          return new Promise(() => {}); // never resolves
        },
      );

      const createRes = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });

      const jobId = (createRes.body as any).jobId;
      expect(jobId).toBeDefined();

      const { status, body } = await requestProjectsRoute(`/api/projects/create-jobs/${jobId}`);

      expect(status).toBe(200);
      // The lifecycle is preparing -> cloning -> registering, not one 'running'.
      expect(['preparing', 'cloning', 'registering']).toContain((body as { status: string }).status);
      expect(body).toHaveProperty('phase', 'cloning');
      expect(body).toHaveProperty('percent', 50);
    });

    it('AC2.4: returns 200 with done job after completion', async () => {
      const result: ProjectCreateResult = {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };

      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockResolvedValue(result);

      const createRes = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });

      const jobId = (createRes.body as any).jobId;

      // Advance timers to let the promise settle
      await vi.advanceTimersByTimeAsync(100);

      const { status, body } = await requestProjectsRoute(`/api/projects/create-jobs/${jobId}`);

      expect(status).toBe(200);
      expect(body).toHaveProperty('status', 'done');
      expect(body).toHaveProperty('result.key', 'test-proj');
    });

    it('AC2.5: returns 404 after job TTL expires', async () => {
      const result: ProjectCreateResult = {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };

      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockResolvedValue(result);

      const createRes = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });

      const jobId = (createRes.body as any).jobId;

      // Let job complete
      await vi.advanceTimersByTimeAsync(100);
      expect((await requestProjectsRoute(`/api/projects/create-jobs/${jobId}`)).status).toBe(200);

      // Advance past TTL
      vi.advanceTimersByTime(JOB_TTL_MS + 1);

      const { status } = await requestProjectsRoute(`/api/projects/create-jobs/${jobId}`);
      expect(status).toBe(404);
    });
  });

  // ─── POST /api/projects ──────────────────────────────────────────────────

  describe('POST /api/projects', () => {
    it('AC3.1: returns 400 if mode is invalid', async () => {
      const { status, body } = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'invalid' }),
      });

      expect(status).toBe(400);
      expect(body).toHaveProperty('error');
    });

    it('AC3.2: returns 422 if findings are present', async () => {
      const intent = makeResolvedIntent('clone', {
        findings: [
          {
            field: 'url',
            code: 'url-invalid',
            message: 'Invalid URL',
          },
        ],
      });
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);

      const { status, body } = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'not-a-url' }),
      });

      expect(status).toBe(422);
      expect(body).toHaveProperty('findings');
      expect((body as any).findings).toHaveLength(1);
    });

    it('AC3.3: returns 202 with jobId for clone mode', async () => {
      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockImplementation(() => new Promise(() => {}));

      const { status, body } = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });

      expect(status).toBe(202);
      expect(body).toHaveProperty('jobId');
      expect(typeof (body as any).jobId).toBe('string');
    });

    it('AC3.4: returns 200 with result for existing mode', async () => {
      const intent = makeResolvedIntent('existing');
      const result: ProjectCreateResult = {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };

      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockResolvedValue(result);

      const { status, body } = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'existing', path: '/home/user/proj' }),
      });

      expect(status).toBe(200);
      expect(body).toHaveProperty('key', 'test-proj');
      expect(body).toHaveProperty('name', 'Test Project');
      expect(body).toHaveProperty('path');
    });

    it('AC3.5: returns 200 with result for new mode', async () => {
      const intent = makeResolvedIntent('new');
      const result: ProjectCreateResult = {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };

      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockResolvedValue(result);

      const { status, body } = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'new', name: 'Test Project', parentDir: '/home/user' }),
      });

      expect(status).toBe(200);
      expect(body).toHaveProperty('key', 'test-proj');
    });

    it('AC3.6: returns 409 on DuplicateProjectError', async () => {
      const intent = makeResolvedIntent('existing');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockRejectedValue(
        new DuplicateProjectError('test-proj', '/existing/path'),
      );

      const { status, body } = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'existing', path: '/home/user/proj' }),
      });

      expect(status).toBe(409);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('key', 'test-proj');
      expect(body).toHaveProperty('existingPath', '/existing/path');
    });

    it('AC3.7: returns 500 on a genuine create failure, reserving 409 for duplicates', async () => {
      const intent = makeResolvedIntent('existing');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockRejectedValue(new Error('Filesystem error'));

      const { status, body } = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'existing', path: '/home/user/proj' }),
      });

      expect(status).toBe(500);
      expect(body).toHaveProperty('error');
      expect((body as any).error).toMatch(/Filesystem error/);
    });

    it('AC3.8: includes all input fields in resolveProjectCreateIntent call', async () => {
      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);

      await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'clone',
          url: 'o/r',
          issuePrefix: 'OR',
        }),
      });

      expect(routeMocks.resolveProjectCreateIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'clone',
          url: 'o/r',
          issuePrefix: 'OR',
          homeBoundary: true,
          refreshRemote: true,
        }),
      );
    });

    it('AC3.9: end-to-end clone flow: 202 → poll running → poll done', async () => {
      const intent = makeResolvedIntent('clone');
      const result: ProjectCreateResult = {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };

      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      let finish: (() => void) | undefined;
      let jobPromise: Promise<ProjectCreateResult> | undefined;
      routeMocks.performProjectCreate.mockImplementation((_, hooks) => {
        // Simulate progress callback
        hooks.onProgress?.({ phase: 'cloning', percent: 50 });
        // Return deferred promise that resolves when test calls finish()
        jobPromise = new Promise<ProjectCreateResult>((res) => {
          finish = () => res(result);
        });
        return jobPromise;
      });

      // Step 1: POST /api/projects → 202 with jobId
      const createRes = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });

      expect(createRes.status).toBe(202);
      const jobId = (createRes.body as any).jobId;

      // Step 2: GET /api/projects/create-jobs/:jobId → 200 with live progress.
      // The status is a lifecycle phase now (preparing/cloning/registering),
      // not a single 'running'.
      const runningRes = await requestProjectsRoute(`/api/projects/create-jobs/${jobId}`);
      expect(runningRes.status).toBe(200);
      expect(runningRes.body).toMatchObject({ phase: 'cloning', percent: 50 });
      expect(['preparing', 'cloning']).toContain((runningRes.body as { status: string }).status);

      // Step 3: Finish the deferred promise and await the job-store .then() callback
      if (!finish) throw new Error('finish was not set by mock');
      finish();
      // The job-store registers a .then() callback on the promise. Await it directly
      // (no fake timers — the real microtask queue will settle it).
      if (jobPromise) {
        try {
          await jobPromise;
        } catch {
          // ignore errors from the job itself
        }
      }

      // Step 4: Poll again → 200 done
      const doneRes = await requestProjectsRoute(`/api/projects/create-jobs/${jobId}`);

      expect(doneRes.status).toBe(200);
      expect(doneRes.body).toMatchObject({
        status: 'done',
        result: { key: 'test-proj' },
      });
    });
  });

  // ─── AC-2: the operation-and-target guard (WI-2) ───────────────────────────
  //
  // The guard only earns its keep if the route calls it. These tests fail if
  // POST /api/projects goes back to ignoring `operationId`, which is exactly
  // how the dedup layer became dead code once before.

  describe('POST /api/projects operation deduplication', () => {
    it('AC2.1: a repeat of the same operation id with the same input joins the first job', async () => {
      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockImplementation(() => new Promise(() => {}));

      const body = JSON.stringify({ mode: 'clone', url: 'o/r', operationId: 'op-same' });
      const first = await requestProjectsRoute('/api/projects', { method: 'POST', body });
      const second = await requestProjectsRoute('/api/projects', { method: 'POST', body });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect((second.body as any).jobId).toBe((first.body as any).jobId);
      expect((first.body as any).operationId).toBe('op-same');
      // One clone, not two: this is the whole point of the retry story.
      expect(routeMocks.performProjectCreate).toHaveBeenCalledTimes(1);
    });

    it('AC2.2: the same operation id with different input is a conflict, not a silent overwrite', async () => {
      routeMocks.performProjectCreate.mockImplementation(() => new Promise(() => {}));
      routeMocks.resolveProjectCreateIntent.mockResolvedValueOnce(makeResolvedIntent('clone'));

      const first = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r', operationId: 'op-drift' }),
      });
      expect(first.status).toBe(202);

      routeMocks.resolveProjectCreateIntent.mockResolvedValueOnce(
        makeResolvedIntent('clone', { path: '/home/user/Projects/other', key: 'other' }),
      );
      const second = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/other', operationId: 'op-drift' }),
      });

      expect(second.status).toBe(409);
      expect((second.body as any).code).toBe('conflict');
      expect(routeMocks.performProjectCreate).toHaveBeenCalledTimes(1);
    });

    it('AC2.3: two different operations aimed at one directory cannot both run', async () => {
      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockImplementation(() => new Promise(() => {}));

      const first = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r', operationId: 'op-a' }),
      });
      const second = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r', operationId: 'op-b' }),
      });

      expect(first.status).toBe(202);
      expect(second.status).toBe(409);
      expect((second.body as any).code).toBe('target-busy');
      expect((second.body as any).error).toMatch(/\/home\/user\/Projects\/test-proj/);
      // The second tab must not have started a clone into a directory the first
      // one is still writing into.
      expect(routeMocks.performProjectCreate).toHaveBeenCalledTimes(1);
    });

    it('AC2.4: a settled operation replays its result instead of creating twice', async () => {
      const intent = makeResolvedIntent('existing');
      const result: ProjectCreateResult = {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
        seededContextLayer: false,
        hooksInstalled: 0,
      };
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockResolvedValue(result);

      const body = JSON.stringify({ mode: 'existing', path: '/home/user/proj', operationId: 'op-done' });
      const first = await requestProjectsRoute('/api/projects', { method: 'POST', body });
      const second = await requestProjectsRoute('/api/projects', { method: 'POST', body });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ key: 'test-proj', operationId: 'op-done' });
      expect(routeMocks.performProjectCreate).toHaveBeenCalledTimes(1);
    });

    it('AC2.5: a failed synchronous create releases the destination', async () => {
      const intent = makeResolvedIntent('existing');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockRejectedValueOnce(new Error('Filesystem error'));

      const failed = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'existing', path: '/home/user/proj', operationId: 'op-fail' }),
      });
      expect(failed.status).toBe(500);

      // Without a settle on the failure path the destination would stay pinned
      // as target-busy for the life of the process, and no later attempt at this
      // directory could ever succeed.
      routeMocks.performProjectCreate.mockResolvedValueOnce({
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
        seededContextLayer: false,
        hooksInstalled: 0,
      });
      const retried = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'existing', path: '/home/user/proj', operationId: 'op-retry' }),
      });

      expect(retried.status).toBe(200);
      expect(retried.body).toMatchObject({ key: 'test-proj' });
    });

    it('AC2.6: a request with no operation id still excludes a concurrent one at the same target', async () => {
      const intent = makeResolvedIntent('clone');
      routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
      routeMocks.performProjectCreate.mockImplementation(() => new Promise(() => {}));

      const first = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });
      const second = await requestProjectsRoute('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ mode: 'clone', url: 'o/r' }),
      });

      expect(first.status).toBe(202);
      expect((first.body as any).operationId).toEqual(expect.any(String));
      expect(second.status).toBe(409);
      expect((second.body as any).code).toBe('target-busy');
    });
  });
});

// ─── New surfaces from WI-2 ──────────────────────────────────────────────────

describe('POST /api/projects/create-jobs/:jobId/cancel', () => {
  it('requires CSRF-guarded auth before touching a job', async () => {
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );

    const { status } = await requestProjectsRoute('/api/projects/create-jobs/abc/cancel', {
      method: 'POST',
      body: '{}',
    });

    expect(status).toBe(403);
  });

  it('returns 404 for a job this runtime does not know', async () => {
    const { status, body } = await requestProjectsRoute('/api/projects/create-jobs/nope/cancel', {
      method: 'POST',
      body: '{}',
    });

    expect(status).toBe(404);
    expect(body).toHaveProperty('error', 'Unknown job');
  });
});

describe('POST /api/projects/create-jobs/reconcile', () => {
  it('rejects a body without key and expectedPath', async () => {
    const { status } = await requestProjectsRoute('/api/projects/create-jobs/reconcile', {
      method: 'POST',
      body: JSON.stringify({ mode: 'clone' }),
    });

    expect(status).toBe(400);
  });

  it('hands back the live job when only the operation id survived', async () => {
    const intent = makeResolvedIntent('clone');
    routeMocks.resolveProjectCreateIntent.mockResolvedValue(intent);
    routeMocks.performProjectCreate.mockImplementation(() => new Promise(() => {}));
    routeMocks.resolveProjectCreateRecovery.mockResolvedValue({ status: 'conflict', reason: 'half-written' });

    const created = await requestProjectsRoute('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ mode: 'clone', url: 'o/r', operationId: 'op-lost' }),
    });
    expect(created.status).toBe(202);

    // The client lost the POST response, so it has no jobId — only the
    // operationId it stored before submitting. Falling through to disk would
    // inspect a directory the clone is still writing into and call it a
    // conflict, stranding the operator on a dead end.
    const { status, body } = await requestProjectsRoute('/api/projects/create-jobs/reconcile', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'clone',
        key: 'test-proj',
        expectedPath: '/home/user/Projects/test-proj',
        operationId: 'op-lost',
      }),
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'job', job: { id: (created.body as any).jobId } });
    expect(routeMocks.resolveProjectCreateRecovery).not.toHaveBeenCalled();
  });

  it('passes the expected identity through to the read-only resolver', async () => {
    routeMocks.resolveProjectCreateRecovery.mockResolvedValue({ status: 'unknown', reason: 'nothing' });

    const { status, body } = await requestProjectsRoute('/api/projects/create-jobs/reconcile', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'clone',
        key: 'widget',
        expectedPath: '/home/user/Projects/widget',
        expectedRepoSlug: 'acme/widget',
      }),
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'unknown' });
    expect(routeMocks.resolveProjectCreateRecovery).toHaveBeenCalledWith({
      key: 'widget',
      expectedPath: '/home/user/Projects/widget',
      mode: 'clone',
      expectedRepoSlug: 'acme/widget',
    });
    // Reconciliation is read-only: it must never reach a write door.
    expect(routeMocks.performProjectCreate).not.toHaveBeenCalled();
    expect(routeMocks.finishProjectSetup).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/:projectKey/finish-setup', () => {
  it('returns 404 for an unregistered key', async () => {
    routeMocks.getProjectSync.mockReturnValue(undefined);

    const { status } = await requestProjectsRoute('/api/projects/ghost/finish-setup', {
      method: 'POST',
      body: '{}',
    });

    expect(status).toBe(404);
  });

  it('repairs through the shared helper without cloning again', async () => {
    routeMocks.finishProjectSetup.mockResolvedValue({
      key: 'test-proj',
      name: 'Test Project',
      path: '/home/user/Projects/test-proj',
      mainWorkspaceId: 'ws-1',
      seededContextLayer: false,
      hooksInstalled: 1,
    });

    const { status, body } = await requestProjectsRoute('/api/projects/test-proj/finish-setup', {
      method: 'POST',
      body: '{}',
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ key: 'test-proj', mainWorkspaceId: 'ws-1' });
    expect(routeMocks.performProjectCreate).not.toHaveBeenCalled();
  });

  it('returns 409 when the repair target does not match the registration', async () => {
    const { ProjectCreateFailureError } = await import(
      '../../../../src/lib/projects/create-errors.js'
    );
    routeMocks.finishProjectSetup.mockRejectedValue(
      new ProjectCreateFailureError({
        code: 'destination-conflict',
        message: 'registered elsewhere',
        retrySafe: false,
      }),
    );

    const { status, body } = await requestProjectsRoute('/api/projects/test-proj/finish-setup', {
      method: 'POST',
      body: JSON.stringify({ expectedPath: '/somewhere/else' }),
    });

    expect(status).toBe(409);
    expect((body as { failure?: { code?: string } }).failure?.code).toBe('destination-conflict');
  });

  it('returns 500 for an unexpected repair failure', async () => {
    routeMocks.finishProjectSetup.mockRejectedValue(new Error('disk exploded'));

    const { status } = await requestProjectsRoute('/api/projects/test-proj/finish-setup', {
      method: 'POST',
      body: '{}',
    });

    expect(status).toBe(500);
  });
});
