import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const {
  execMock,
  execBehaviorMock,
  existsSyncMock,
  getReviewStatusMock,
  setReviewStatusMock,
  resolveProjectFromIssueMock,
  listProjectsMock,
  restoreTrackedBeadsExportMock,
  loadWorkspaceMetadataMock,
  transitionIssueToInReviewMock,
  spawnReviewRoleForIssueMock,
} = vi.hoisted(() => {
  const execBehaviorMock = vi.fn();
  const execMock = vi.fn();
  (execMock as any)[Symbol.for('nodejs.util.promisify.custom')] = (command: string, options?: unknown) =>
    new Promise((resolve, reject) => {
      queueMicrotask(() => {
        try {
          resolve({ stdout: execBehaviorMock(command, options), stderr: '' });
        } catch (error) {
          reject(error);
        }
      });
    });

  return {
    execMock,
    execBehaviorMock,
    existsSyncMock: vi.fn(),
    getReviewStatusMock: vi.fn(),
    setReviewStatusMock: vi.fn(),
    resolveProjectFromIssueMock: vi.fn(),
    listProjectsMock: vi.fn(),
    restoreTrackedBeadsExportMock: vi.fn(),
    loadWorkspaceMetadataMock: vi.fn(),
    transitionIssueToInReviewMock: vi.fn(),
    spawnReviewRoleForIssueMock: vi.fn(),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: execMock,
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

vi.mock('../../../../lib/review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/review-status.js')>();
  return {
    ...actual,
    getReviewStatusSync: getReviewStatusMock,
    setReviewStatusSync: setReviewStatusMock,
  };
});

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: resolveProjectFromIssueMock,
    listProjectsSync: listProjectsMock,
  };
});

vi.mock('../../../../lib/beads-restore.js', () => ({
  restoreTrackedBeadsExport: restoreTrackedBeadsExportMock,
}));

vi.mock('../../../../lib/remote/workspace-metadata.js', () => ({
  loadWorkspaceMetadataSync: loadWorkspaceMetadataMock,
}));

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>();
  return {
    ...actual,
    transitionIssueToInReview: transitionIssueToInReviewMock,
  };
});

vi.mock('../../../../lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: spawnReviewRoleForIssueMock,
}));

import { workspacesRouteLayer } from '../workspaces.js';
import { EventStoreService } from '../../services/domain-services.js';

function eventStoreLayerFor(appendedEvents: Record<string, unknown>[]) {
  return Layer.succeed(EventStoreService, {
    append: (event: Record<string, unknown>) => Effect.sync(() => {
      appendedEvents.push(event);
      return appendedEvents.length;
    }),
    appendAsync: (event: Record<string, unknown>) => Effect.sync(() => {
      appendedEvents.push(event);
      return appendedEvents.length;
    }),
    readFrom: () => Effect.succeed([]),
    queryByType: () => Effect.succeed([]),
    getLatestSequence: Effect.succeed(0),
    streamEvents: Stream.empty,
  });
}

async function postRequestReview(issueId: string, options: { query?: string; body?: Record<string, unknown> } = {}) {
  const appendedEvents: Record<string, unknown>[] = [];
  const request = HttpServerRequest.fromWeb(new Request(
    `http://localhost/api/review/${issueId}/request${options.query ?? ''}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body ?? {}),
    },
  ));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(workspacesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ).pipe(Effect.provide(eventStoreLayerFor(appendedEvents))),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text), appendedEvents };
}

function passedStatus(overrides: Record<string, unknown> = {}) {
  return {
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'pending',
    readyForMerge: false,
    reviewedAtCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ...overrides,
  };
}

describe('POST /api/review/:id/request nudge and drift gate', () => {
  let currentHeadSha: string;
  let failHeadLookup: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    currentHeadSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    failHeadLookup = false;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    existsSyncMock.mockReturnValue(true);
    resolveProjectFromIssueMock.mockReturnValue({ projectName: 'panopticon', projectPath: '/tmp/panopticon' });
    listProjectsMock.mockReturnValue([{ config: { path: '/tmp/panopticon' } }]);
    loadWorkspaceMetadataMock.mockReturnValue(null);
    restoreTrackedBeadsExportMock.mockReturnValue(Effect.succeed(undefined));
    transitionIssueToInReviewMock.mockResolvedValue(undefined);
    spawnReviewRoleForIssueMock.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));
    setReviewStatusMock.mockImplementation((_issueId, update) => update);
    execBehaviorMock.mockImplementation((command: string) => {
      if (command.includes('git rev-parse HEAD')) {
        if (failHeadLookup) throw new Error('git unavailable');
        return `${currentHeadSha}\n`;
      }
      if (command.includes('git status --porcelain -uno')) return '';
      if (command.includes('git push origin')) return '';
      return '';
    });
    execMock.mockImplementation((command: string, options: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
      const cb = typeof options === 'function'
        ? options as (error: Error | null, stdout: string, stderr: string) => void
        : callback;
      queueMicrotask(() => {
        try {
          const stdout = execBehaviorMock(command, typeof options === 'function' ? undefined : options);
          cb?.(null, stdout, '');
        } catch (error) {
          cb?.(error as Error, '', '');
        }
      });
      return { pid: 123, on: vi.fn(), once: vi.fn(), kill: vi.fn() };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses without mutation when the passed review has no code drift', async () => {
    getReviewStatusMock.mockReturnValue(passedStatus());

    const result = await postRequestReview('PAN-1417');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: false,
      noCodeDrift: true,
      error: 'No code drift since review passed',
    });
    expect(result.body.hint).toContain('?force=true');
    expect(result.body.hint).toContain('?nudge=true');
    expect(setReviewStatusMock).not.toHaveBeenCalled();
    expect(result.appendedEvents).toEqual([]);
  });

  it('uses fly ssh with a timeout when checking remote workspace HEAD', async () => {
    loadWorkspaceMetadataMock.mockReturnValue({
      location: 'remote',
      vmName: 'pan-workspace-123',
      remotePath: '/remote/workspace',
    });
    getReviewStatusMock.mockReturnValue(passedStatus());

    await postRequestReview('PAN-1417');

    const headCall = execBehaviorMock.mock.calls.find(([command]) => String(command).includes('git rev-parse HEAD'));
    expect(headCall?.[0]).toContain('fly ssh console -a pan-workspace');
    expect(headCall?.[0]).toContain("cd '/remote/workspace' && git rev-parse HEAD");
    expect(headCall?.[1]).toMatchObject({ timeout: 30000 });
    expect(setReviewStatusMock).not.toHaveBeenCalled();
  });

  it('re-emits test.passed with canonical issue ID without workspace lookup when nudged after review and tests passed', async () => {
    getReviewStatusMock.mockReturnValue(passedStatus());

    const result = await postRequestReview('pan-1417', { query: '?nudge=true' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, nudged: true });
    expect(result.appendedEvents).toHaveLength(1);
    expect(result.appendedEvents[0]).toMatchObject({
      type: 'test.passed',
      payload: { issueId: 'PAN-1417' },
    });
    expect(resolveProjectFromIssueMock).not.toHaveBeenCalled();
    expect(loadWorkspaceMetadataMock).not.toHaveBeenCalled();
    expect(setReviewStatusMock).not.toHaveBeenCalled();
  });

  it('rejects body nudge without emitting or mutating when tests have not passed', async () => {
    getReviewStatusMock.mockReturnValue(passedStatus({ testStatus: 'pending' }));

    const result = await postRequestReview('PAN-1417', { body: { nudge: true } });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      success: false,
      error: 'Cannot nudge — tests have not passed',
    });
    expect(result.body.hint).toContain('?force=true');
    expect(result.appendedEvents).toEqual([]);
    expect(setReviewStatusMock).not.toHaveBeenCalled();
  });

  it('honors query force and preserves the destructive rerun reset', async () => {
    getReviewStatusMock.mockReturnValue(passedStatus());

    const result = await postRequestReview('PAN-1417', { query: '?force=true' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, rerun: true });
    expect(result.appendedEvents).toEqual([]);
    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-1417', expect.objectContaining({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      autoRequeueCount: 0,
      verificationCycleCount: 0,
      verificationStatus: 'pending',
      reviewNotes: undefined,
      testNotes: undefined,
      mergeNotes: undefined,
    }));
    expect(console.log).toHaveBeenCalledWith('[request-review] FORCE: full reset requested by operator for PAN-1417');
    expect(console.log).toHaveBeenCalledWith('[request-review] PAN-1417: forcing full review/test rerun from passed state');
  });

  it('lets body force take precedence over nudge and preserves the destructive rerun reset', async () => {
    getReviewStatusMock.mockReturnValue(passedStatus());

    const result = await postRequestReview('PAN-1417', { body: { force: true, nudge: true } });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, rerun: true });
    expect(result.appendedEvents).toEqual([]);
    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-1417', expect.objectContaining({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      autoRequeueCount: 0,
      verificationCycleCount: 0,
      verificationStatus: 'pending',
      reviewNotes: undefined,
      testNotes: undefined,
      mergeNotes: undefined,
    }));
    expect(console.log).toHaveBeenCalledWith('[request-review] FORCE: full reset requested by operator for PAN-1417');
    expect(console.log).toHaveBeenCalledWith('[request-review] PAN-1417: forcing full review/test rerun from passed state');
  });

  it('falls through to the destructive rerun path when current HEAD differs from reviewedAtCommit', async () => {
    currentHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    getReviewStatusMock.mockReturnValue(passedStatus());

    const result = await postRequestReview('PAN-1417');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, rerun: true });
    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-1417', expect.objectContaining({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
    }));
  });

  it('falls through to the destructive rerun path for legacy rows without reviewedAtCommit', async () => {
    getReviewStatusMock.mockReturnValue(passedStatus({ reviewedAtCommit: undefined }));

    const result = await postRequestReview('PAN-1417');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, rerun: true });
    expect(execBehaviorMock.mock.calls.some(([command]) => String(command).includes('git rev-parse HEAD'))).toBe(false);
    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-1417', expect.objectContaining({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
    }));
  });

  it('falls through to the destructive rerun path when HEAD lookup fails', async () => {
    failHeadLookup = true;
    getReviewStatusMock.mockReturnValue(passedStatus());

    const result = await postRequestReview('PAN-1417');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, rerun: true });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HEAD lookup failed'));
    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-1417', expect.objectContaining({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
    }));
  });
});
