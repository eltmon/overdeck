/**
 * POST /api/specialists/done — inspect verdict surface (PAN-1791
 * supervisor-verdict-surface).
 *
 * The tiered-execution standing supervisor posts its per-commit ack /
 * blocking finding to THIS existing surface (no new endpoint), so the
 * behavior the supervisor relies on is locked here:
 *
 * ac1 — a passed inspect verdict persists inspectStatus and saves the bead
 *       checkpoint via onInspectComplete.
 * ac2 — a failed inspect verdict records the blocking finding on the
 *       inspect-status surface and does NOT change tracker status (inspect
 *       is exempt from the failed → transitionIssueToInProgress rule).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const {
  existsSyncMock,
  setReviewStatusMock,
  getReviewStatusMock,
  loadReviewStatusesMock,
  resolveProjectFromIssueMock,
  onInspectCompleteMock,
  transitionIssueToInProgressMock,
  saveAgentRuntimeStateMock,
  messageAgentMock,
  killSessionMock,
  updateRunMetadataMock,
  updateSpecialistHandoffStatusMock,
  queryBeadByIdMock,
  syncBeadStatusToVBriefMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  setReviewStatusMock: vi.fn(),
  getReviewStatusMock: vi.fn(),
  loadReviewStatusesMock: vi.fn(),
  resolveProjectFromIssueMock: vi.fn(),
  onInspectCompleteMock: vi.fn(),
  transitionIssueToInProgressMock: vi.fn(),
  saveAgentRuntimeStateMock: vi.fn(),
  messageAgentMock: vi.fn(),
  killSessionMock: vi.fn(),
  updateRunMetadataMock: vi.fn(),
  updateSpecialistHandoffStatusMock: vi.fn(),
  queryBeadByIdMock: vi.fn(),
  syncBeadStatusToVBriefMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      const result = existsSyncMock(path);
      return result === undefined ? actual.existsSync(path) : result;
    },
  };
});

vi.mock('../../../../lib/review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/review-status.js')>();
  return {
    ...actual,
    setReviewStatusSync: setReviewStatusMock,
    getReviewStatusSync: getReviewStatusMock,
    loadReviewStatuses: loadReviewStatusesMock,
  };
});

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: resolveProjectFromIssueMock,
  };
});

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>();
  return {
    ...actual,
    saveAgentRuntimeState: saveAgentRuntimeStateMock,
    transitionIssueToInProgress: transitionIssueToInProgressMock,
    messageAgent: messageAgentMock,
  };
});

vi.mock('../../../../lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tmux.js')>();
  return {
    ...actual,
    killSession: killSessionMock,
    sessionExists: () => Effect.succeed(false),
  };
});

vi.mock('../../../../lib/cloister/reap-terminal-sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/cloister/reap-terminal-sessions.js')>();
  return {
    ...actual,
    KEEP_SPECIALIST_SESSIONS_ALIVE: true,
  };
});

vi.mock('../../../../lib/cloister/specialists.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/cloister/specialists.js')>();
  return {
    ...actual,
    updateRunMetadata: updateRunMetadataMock,
  };
});

vi.mock('../../../../lib/cloister/specialist-handoff-logger.js', () => ({
  updateSpecialistHandoffStatus: updateSpecialistHandoffStatusMock,
}));

vi.mock('../../../../lib/cloister/inspect-agent.js', () => ({
  onInspectComplete: onInspectCompleteMock,
  spawnInspectAgent: vi.fn(),
  buildInspectPrompt: vi.fn(),
}));

vi.mock('../../../../lib/beads-query.js', () => ({
  queryBeadById: queryBeadByIdMock,
}));

vi.mock('../../../../lib/vbrief/beads.js', () => ({
  syncBeadStatusToVBrief: syncBeadStatusToVBriefMock,
}));

import { specialistsRouteLayer } from '../specialists.js';
import { EventStoreService } from '../../services/domain-services.js';

const PROJECT_PATH = '/tmp/overdeck-specialists-test';
const WORKSPACE_PATH = `${PROJECT_PATH}/workspaces/feature-pan-9999`;

function eventStoreLayer(appendedEvents: Record<string, unknown>[]) {
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
  } as never);
}

async function postDone(body: Record<string, unknown>) {
  const appendedEvents: Record<string, unknown>[] = [];
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/specialists/done', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(specialistsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ).pipe(Effect.provide(eventStoreLayer(appendedEvents))),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text), appendedEvents };
}

describe('POST /api/specialists/done — inspect verdict surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    existsSyncMock.mockReturnValue(true);
    setReviewStatusMock.mockImplementation((_issueId: string, update: Record<string, unknown>) => update);
    getReviewStatusMock.mockReturnValue(undefined);
    loadReviewStatusesMock.mockReturnValue({});
    resolveProjectFromIssueMock.mockReturnValue({
      projectKey: 'overdeck',
      projectName: 'overdeck',
      projectPath: PROJECT_PATH,
    });
    onInspectCompleteMock.mockReturnValue(Effect.succeed(undefined));
    transitionIssueToInProgressMock.mockResolvedValue(undefined);
    updateSpecialistHandoffStatusMock.mockReturnValue(Effect.succeed(false));
    queryBeadByIdMock.mockReturnValue(Effect.succeed(null));
    syncBeadStatusToVBriefMock.mockReturnValue(Effect.succeed(null));
  });

  it('passed verdict persists inspectStatus and saves the checkpoint via onInspectComplete (ac1)', async () => {
    const { status, body } = await postDone({
      specialist: 'inspect',
      issueId: 'pan-9999',
      status: 'passed',
      notes: 'Bead pan-9999-3 ack: diff satisfies all acceptance criteria',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-9999', {
      inspectStatus: 'passed',
      inspectNotes: 'Bead pan-9999-3 ack: diff satisfies all acceptance criteria',
    });
    // Checkpoint path: the existing onInspectComplete surface, with the bead
    // id extracted from the "Bead <beadId>" notes prefix.
    expect(onInspectCompleteMock).toHaveBeenCalledWith(
      'overdeck',
      'PAN-9999',
      'pan-9999-3',
      'passed',
      WORKSPACE_PATH,
    );
  });

  it('failed verdict records the blocking finding without changing tracker status (ac2)', async () => {
    const { status, body } = await postDone({
      specialist: 'inspect',
      issueId: 'pan-9999',
      status: 'failed',
      notes: 'Bead pan-9999-3 BLOCKED: widget.ts:12 renders outside the frobnicator panel (ac1 unmet)',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // The blocking finding lands on the inspect-status surface…
    expect(setReviewStatusMock).toHaveBeenCalledWith('PAN-9999', {
      inspectStatus: 'failed',
      inspectNotes: 'Bead pan-9999-3 BLOCKED: widget.ts:12 renders outside the frobnicator panel (ac1 unmet)',
    });
    // …and does NOT touch the tracker: inspect is exempt from the
    // failed → transitionIssueToInProgress rule, and no checkpoint is saved.
    expect(transitionIssueToInProgressMock).not.toHaveBeenCalled();
    expect(onInspectCompleteMock).not.toHaveBeenCalled();
  });

  it('non-inspect specialist failure still transitions the tracker (the inspect exemption is deliberate)', async () => {
    const { status } = await postDone({
      specialist: 'test',
      issueId: 'pan-9999',
      status: 'failed',
      notes: 'unit tests failed',
    });

    expect(status).toBe(200);
    expect(transitionIssueToInProgressMock).toHaveBeenCalledWith('PAN-9999', WORKSPACE_PATH);
  });
});
