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
}));

vi.mock('../../../../src/lib/projects/create.js', () => ({
  resolveProjectCreateIntent: routeMocks.resolveProjectCreateIntent,
  performProjectCreate: routeMocks.performProjectCreate,
}));

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
    proposedIssuePrefix: 'TP',
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

    it('AC2.3: returns 200 with running job status', async () => {
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
      expect(body).toHaveProperty('status', 'running');
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

      // Step 2: GET /api/projects/create-jobs/:jobId → 200 running with progress
      const runningRes = await requestProjectsRoute(`/api/projects/create-jobs/${jobId}`);
      expect(runningRes.status).toBe(200);
      expect(runningRes.body).toMatchObject({
        status: 'running',
        phase: 'cloning',
        percent: 50,
      });

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
});
