/**
 * Tests for the project-create job and operation runtime (PAN-3836 WI-2).
 *
 * What is actually defended here: a second click, a retried POST after a lost
 * response, and two tabs aimed at the same folder must not each start a clone;
 * a cancel must not report success before the child has closed; and a deadline
 * must never fire on a job that has moved on to writing configuration, because
 * "cancelled and retry-safe" would be a lie at that point.
 *
 * Every timer case drives fake timers — no real 30-minute waits.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  ResolvedProjectIntent,
  ProjectCreateResult,
} from '../../../../src/lib/projects/create.js';

vi.mock('../../../../src/lib/projects/create-perform.js', () => ({
  performProjectCreate: vi.fn(),
}));

import {
  startProjectCreateJob,
  getProjectCreateJob,
  requestProjectCreateJobCancel,
  reserveProjectCreateOperation,
  settleProjectCreateOperation,
  getProjectCreateOperation,
  __resetProjectCreateJobsForTests,
  JOB_TTL_MS,
  CLONE_DEADLINE_MS,
} from '../../../../src/dashboard/server/routes/project-create-jobs.js';
import { performProjectCreate } from '../../../../src/lib/projects/create-perform.js';
import { ProjectCreateFailureError } from '../../../../src/lib/projects/create-errors.js';

function makeIntent(overrides: Partial<ResolvedProjectIntent> = {}): ResolvedProjectIntent {
  return {
    mode: 'clone',
    key: 'widget',
    name: 'widget',
    path: '/home/user/Projects/widget',
    parentDir: '/home/user/Projects',
    homeDir: '/home/user',
    cloneUrl: 'https://github.com/acme/widget.git',
    provider: 'github',
    repoSlug: 'acme/widget',
    defaultBranch: 'main',
    remoteChecked: true,
    isGitRepository: true,
    gitRoot: null,
    proposedIssuePrefix: 'WIDGET',
    wouldClone: true,
    wouldGitInit: false,
    willCreateMainWorkspace: true,
    registeredKeyAtPath: null,
    findings: [],
    ...overrides,
  };
}

const result: ProjectCreateResult = {
  key: 'widget',
  name: 'widget',
  path: '/home/user/Projects/widget',
  mainWorkspaceId: 'ws-1',
  seededContextLayer: true,
  hooksInstalled: 1,
};

/** A perform the test drives: it never settles until released. */
function heldPerform(): {
  release: (value?: ProjectCreateResult) => void;
  fail: (err: unknown) => void;
  progress: (phase: string, percent: number | null) => void;
  signal: () => AbortSignal | undefined;
} {
  let resolveFn!: (v: ProjectCreateResult) => void;
  let rejectFn!: (e: unknown) => void;
  let onProgress: ((p: { phase: string; percent: number | null }) => void) | undefined;
  let capturedSignal: AbortSignal | undefined;

  vi.mocked(performProjectCreate).mockImplementation((_intent, hooks) => {
    onProgress = hooks?.onProgress;
    capturedSignal = hooks?.signal;
    return new Promise<ProjectCreateResult>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
  });

  return {
    release: (value = result) => resolveFn(value),
    fail: (err) => rejectFn(err),
    progress: (phase, percent) => onProgress?.({ phase, percent }),
    signal: () => capturedSignal,
  };
}

beforeEach(() => {
  __resetProjectCreateJobsForTests();
  vi.mocked(performProjectCreate).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  __resetProjectCreateJobsForTests();
});

describe('operation reservation', () => {
  it('coalesces repeated submission before validation completes', () => {
    const intent = makeIntent();
    const first = reserveProjectCreateOperation({ operationId: 'op-1', intent });
    const second = reserveProjectCreateOperation({ operationId: 'op-1', intent });

    expect(first.status).toBe('reserved');
    // A retried POST after a lost response must attach, not start a second clone.
    expect(second.status).toBe('joined');
  });

  it('rejects changed input for the same operation id', () => {
    reserveProjectCreateOperation({ operationId: 'op-1', intent: makeIntent() });
    const changed = reserveProjectCreateOperation({
      operationId: 'op-1',
      intent: makeIntent({ name: 'something-else', path: '/home/user/Projects/other' }),
    });

    expect(changed.status).toBe('conflict');
  });

  it('serializes the same target across operation ids', () => {
    reserveProjectCreateOperation({ operationId: 'op-1', intent: makeIntent() });
    // Two tabs, two ids, one directory: both would clone into it.
    const other = reserveProjectCreateOperation({ operationId: 'op-2', intent: makeIntent() });

    expect(other.status).toBe('target-busy');
  });

  it('frees the target once the operation settles', () => {
    reserveProjectCreateOperation({ operationId: 'op-1', intent: makeIntent() });
    settleProjectCreateOperation('op-1', { result });

    const retry = reserveProjectCreateOperation({ operationId: 'op-2', intent: makeIntent() });
    expect(retry.status).toBe('reserved');
  });

  it('remembers a synchronous outcome so a repeated POST does not register twice', () => {
    reserveProjectCreateOperation({ operationId: 'op-1', intent: makeIntent() });
    settleProjectCreateOperation('op-1', { result });

    expect(getProjectCreateOperation('op-1')?.settled?.result).toEqual(result);
  });
});

describe('job lifecycle', () => {
  it('starts in preparing and reports phases as the clone progresses', async () => {
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });

    expect(getProjectCreateJob(id)?.status).toBe('preparing');

    held.progress('Receiving objects', 42);
    expect(getProjectCreateJob(id)).toMatchObject({
      status: 'cloning',
      phase: 'Receiving objects',
      percent: 42,
    });

    held.release();
    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('done'));
    expect(getProjectCreateJob(id)?.result).toEqual(result);
  });

  it('carries a structured failure and a legacy error string together', async () => {
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });

    held.fail(
      new ProjectCreateFailureError({
        code: 'authentication-required',
        message: 'This server could not authenticate to the repository.',
        retrySafe: true,
      }),
    );

    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('failed'));
    const job = getProjectCreateJob(id)!;
    expect(job.failure?.code).toBe('authentication-required');
    // Older clients read `error`; it must not drift from the structured failure.
    expect(job.error).toBe(job.failure?.message);
  });

  it('never leaks a raw stack through an unexpected throw', async () => {
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });

    held.fail(new Error('kaboom'));

    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('failed'));
    expect(JSON.stringify(getProjectCreateJob(id))).not.toContain('at Object');
  });
});

describe('cancellation', () => {
  it('aborts the child and settles cleanup before reporting cancelled', async () => {
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });
    held.progress('Receiving objects', 10);

    const outcome = requestProjectCreateJobCancel(id);

    expect(outcome.status).toBe('cancelling');
    expect(held.signal()?.aborted).toBe(true);
    // Still not cancelled: the child may be mid-write, and claiming otherwise
    // would let the UI offer a retry into a directory still being touched.
    expect(getProjectCreateJob(id)?.status).toBe('cancelling');

    held.fail(
      new ProjectCreateFailureError({ code: 'cancelled', message: 'cancelled', retrySafe: true }),
    );
    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('cancelled'));
  });

  it('is idempotent', async () => {
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });

    expect(requestProjectCreateJobCancel(id).status).toBe('cancelling');
    expect(requestProjectCreateJobCancel(id).status).toBe('cancelling');

    held.fail(
      new ProjectCreateFailureError({ code: 'cancelled', message: 'cancelled', retrySafe: true }),
    );
    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('cancelled'));
  });

  it('does not cancel after registration starts', () => {
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });

    held.progress('registering', null);
    const outcome = requestProjectCreateJobCancel(id);

    // The clone is already on disk and config is being written; aborting now
    // would strand a half-registered project.
    expect(outcome.status).toBe('cannot-cancel-setup');
    expect(held.signal()?.aborted).toBe(false);
  });

  it('returns the terminal result rather than cancelling a finished job', async () => {
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });
    held.release();
    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('done'));

    expect(requestProjectCreateJobCancel(id).status).toBe('terminal');
  });

  it('reports an unknown job rather than inventing one', () => {
    expect(requestProjectCreateJobCancel('no-such-job').status).toBe('unknown-job');
  });
});

describe('deadlines and retention', () => {
  it('times out a hung clone without leaving a running job', async () => {
    vi.useFakeTimers();
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });
    held.progress('Receiving objects', 1);

    vi.advanceTimersByTime(CLONE_DEADLINE_MS);
    expect(held.signal()?.aborted).toBe(true);

    held.fail(
      new ProjectCreateFailureError({ code: 'timed-out', message: 'timed out', retrySafe: true }),
    );
    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('failed'));
  });

  it('retires the deadline once registration begins', () => {
    vi.useFakeTimers();
    const held = heldPerform();
    startProjectCreateJob(makeIntent(), { operationId: 'op-1' });

    held.progress('registering', null);
    vi.advanceTimersByTime(CLONE_DEADLINE_MS * 2);

    // A deadline firing here would label a still-writing registration as
    // cancelled and retry-safe, and it is neither.
    expect(held.signal()?.aborted).toBe(false);
  });

  it('prunes a settled job after its retention window', async () => {
    vi.useFakeTimers();
    const held = heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });
    held.release();
    await vi.waitFor(() => expect(getProjectCreateJob(id)?.status).toBe('done'));

    vi.advanceTimersByTime(JOB_TTL_MS + 1);
    expect(getProjectCreateJob(id)).toBeUndefined();
  });

  it('never prunes a job that is still running', () => {
    vi.useFakeTimers();
    heldPerform();
    const id = startProjectCreateJob(makeIntent(), { operationId: 'op-1' });

    vi.advanceTimersByTime(JOB_TTL_MS + 1);
    // Eviction is not a substitute for cancellation.
    expect(getProjectCreateJob(id)).toBeDefined();
  });
});
