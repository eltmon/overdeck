/** PAN-4651 WI-5 (D-4651-4): worker status and stop for a following machine. */
import { describe, expect, it, vi } from 'vitest';

import type { LivenessVerdict } from '../../../lib/agents/liveness.js';
import type { WorkerFacts } from '../../../lib/agents/worker/facts.js';
import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import { readJsonResponse } from '../routes/machines-work.js';
import { handleWorkerStatus, handleWorkerStop, WORKER_STATUS_REPORT_LIMIT, type WorkerFollowDeps } from '../routes/workers.js';

const FACTS: WorkerFacts = { id: 'agent-pan-9-worker-1', issueId: 'PAN-9', parentId: null, readOnly: true, cwd: '/w', branch: null, name: null, startedAt: '2026-11-01T00:00:00.000Z' };
const report = (seq: number): WorkerReport => ({ seq, at: '2026-11-01T00:00:00.000Z', status: 'done', body: `report ${seq}` });

function deps(verdict: LivenessVerdict, reports: WorkerReport[], overrides: Partial<WorkerFollowDeps> = {}): WorkerFollowDeps {
  return {
    readFacts: async (id) => (id === FACTS.id ? FACTS : null),
    isAlive: async () => verdict,
    idleAgeMs: () => 42_000,
    listReports: async () => reports,
    lastAssistantMessage: async () => 'last words',
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('worker status (D-4651-4)', () => {
  it('ac5: returns only reports newer than after, at most 20, and no last message while alive', async () => {
    const reports = Array.from({ length: 30 }, (_, index) => report(index + 1));
    const answer = readJsonResponse(await handleWorkerStatus(FACTS.id, 3, deps({ alive: true, paneAlive: true }, reports)));
    expect(answer.status).toBe(200);
    const body = answer.body as { liveness: unknown; idleAgeMs: number; reports: WorkerReport[]; lastAssistantMessage: string | null };
    expect(body.liveness).toEqual({ alive: true, confirmedDead: false });
    expect(body.idleAgeMs).toBe(42_000);
    expect(body.reports.map((r) => r.seq)).toEqual(Array.from({ length: WORKER_STATUS_REPORT_LIMIT }, (_, index) => index + 4));
    expect(body.lastAssistantMessage).toBeNull();
  });

  it('ac5: carries the last assistant message only once the worker is confirmed dead', async () => {
    const dead = readJsonResponse(await handleWorkerStatus(FACTS.id, 0, deps({ alive: false, reason: 'no-session' }, [])));
    expect(dead.body).toMatchObject({ liveness: { alive: false, confirmedDead: true }, lastAssistantMessage: 'last words' });
    const unsure = readJsonResponse(await handleWorkerStatus(FACTS.id, 0, deps({ alive: false, reason: 'runtime-indeterminate' }, [])));
    expect(unsure.body).toMatchObject({ liveness: { alive: false, confirmedDead: false }, lastAssistantMessage: null });
  });

  it('ac5: status and stop answer 404 unknown-worker for an id that is not a worker', async () => {
    const d = deps({ alive: true, paneAlive: true }, []);
    expect(readJsonResponse(await handleWorkerStatus('agent-pan-9', 0, d))).toMatchObject({ status: 404, body: { code: 'unknown-worker' } });
    expect(readJsonResponse(await handleWorkerStop('agent-pan-9', null, d))).toMatchObject({ status: 404, body: { code: 'unknown-worker' } });
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('stops a worker for the local operator', async () => {
    const d = deps({ alive: true, paneAlive: true }, []);
    expect(readJsonResponse(await handleWorkerStop(FACTS.id, { kind: 'root-session' }, d))).toEqual({ status: 200, body: { stopped: true } });
    expect(d.stop).toHaveBeenCalledWith(FACTS.id);
  });
});
