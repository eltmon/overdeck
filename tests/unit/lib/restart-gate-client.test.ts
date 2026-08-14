/**
 * Restart-gate client (PAN-3729).
 *
 * Every test here drives the poll loop with fake timers and a mocked fetch —
 * no real HTTP, no real delays (repo rule: a 5s poll interval multiplied by a
 * dozen cases is an OOM waiting to happen, not a test).
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RESTART_GATE_POLL_INTERVAL_MS,
  approveRestartGate,
  claimRestartGate,
  readRestartGate,
  registerRestartGateRequest,
  restartGateRequesterId,
  restartGateWaitLines,
  waitForRestartApproval,
  type RestartGateRequest,
} from '../../../src/lib/restart-gate-client.js';

const DASHBOARD_URL = 'http://127.0.0.1:3011';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function request(overrides: Partial<RestartGateRequest> = {}): RestartGateRequest {
  return {
    requesterId: 'reload:1234',
    kind: 'reload',
    reason: 'pan reload — put the freshly built dashboard live',
    ...overrides,
  };
}

/**
 * A gate server just real enough to exercise the contract: requests upsert and
 * report status, approve opens one epoch, claim is granted exactly once, and a
 * completed restart marks that epoch's requesters satisfied.
 */
function createGate() {
  const state = {
    pending: new Set<string>(),
    approved: false,
    claimedBy: null as string | null,
    restarted: false,
  };

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as { requesterId?: string } : {};

    if (url.endsWith('/api/restart-gate/requests')) {
      const requesterId = String(body.requesterId);
      if (state.restarted && state.pending.has(requesterId)) {
        return jsonResponse(200, { status: 'satisfied', mayClaim: false, pendingCount: 0 });
      }
      state.pending.add(requesterId);
      if (state.claimedBy && state.claimedBy !== requesterId) {
        return jsonResponse(200, { status: 'claimed', mayClaim: false, pendingCount: state.pending.size });
      }
      return jsonResponse(200, {
        status: state.approved ? 'approved' : 'pending',
        mayClaim: state.approved && state.claimedBy === null,
        pendingCount: state.pending.size,
      });
    }

    if (url.endsWith('/api/restart-gate/claim')) {
      const requesterId = String(body.requesterId);
      if (state.claimedBy === null) state.claimedBy = requesterId;
      return jsonResponse(200, {
        granted: state.claimedBy === requesterId,
        status: 'claimed',
      });
    }

    if (url.endsWith('/api/restart-gate/approve')) {
      state.approved = true;
      return jsonResponse(200, { approved: true, pendingCount: state.pending.size });
    }

    if (url.endsWith('/api/health')) return jsonResponse(200, { ok: true });

    throw new Error(`unexpected request to ${url}`);
  });

  return { state, fetchImpl };
}

/** Run the poll loop forward by whole poll intervals. */
async function tickPolls(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await vi.advanceTimersByTimeAsync(RESTART_GATE_POLL_INTERVAL_MS);
  }
}

describe('restart-gate client (PAN-3729)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('blocks while pending, then claims once the operator approves', async () => {
    const gate = createGate();
    const log = vi.fn();

    const outcome = waitForRestartApproval(request(), {
      dashboardUrl: DASHBOARD_URL,
      fetchImpl: gate.fetchImpl,
      log,
    });

    await tickPolls(3);
    expect(gate.state.claimedBy).toBeNull();

    gate.state.approved = true;
    await tickPolls(1);

    await expect(outcome).resolves.toEqual({
      proceed: true,
      reason: 'claimed',
      detail: 'operator approved and this requester holds the claim',
    });
    expect(gate.state.claimedBy).toBe('reload:1234');
  });

  it('coalesces two requesters: one claims and restarts, the other is satisfied without restarting (AC-4)', async () => {
    const gate = createGate();

    const first = waitForRestartApproval(request({ requesterId: 'reload:1' }), {
      dashboardUrl: DASHBOARD_URL,
      fetchImpl: gate.fetchImpl,
      log: vi.fn(),
    });
    await tickPolls(1);

    const second = waitForRestartApproval(request({ requesterId: 'deploy:PAN-3729:2', kind: 'deploy' }), {
      dashboardUrl: DASHBOARD_URL,
      fetchImpl: gate.fetchImpl,
      log: vi.fn(),
    });
    await tickPolls(1);
    expect(gate.state.pending.size).toBe(2);

    // One operator approval covers both pending requests.
    gate.state.approved = true;
    await tickPolls(2);

    await expect(first).resolves.toMatchObject({ proceed: true, reason: 'claimed' });
    expect(gate.state.claimedBy).toBe('reload:1');

    // The claimant restarted; the new server reports that epoch satisfied.
    gate.state.restarted = true;
    await tickPolls(1);

    await expect(second).resolves.toEqual({
      proceed: false,
      reason: 'satisfied',
      detail: 'another approved requester already restarted the dashboard',
    });
  });

  it('proceeds ungated against a server whose gate endpoints 404, without waiting (AC-5)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: 'not found' }));
    const log = vi.fn();

    const outcome = await waitForRestartApproval(request(), {
      dashboardUrl: DASHBOARD_URL,
      fetchImpl,
      log,
    });

    expect(outcome.proceed).toBe(true);
    expect(outcome.reason).toBe('ungated');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(' ')).toContain('no restart gate');
  });

  it('proceeds ungated after 60s of continuous health-endpoint failure, not before', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3011');
    });

    let settled = false;
    const outcome = waitForRestartApproval(request(), {
      dashboardUrl: DASHBOARD_URL,
      fetchImpl,
      log: vi.fn(),
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(55_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await outcome;
    expect(result).toMatchObject({ proceed: true, reason: 'ungated' });
    expect(result.detail).toContain('health endpoint');
  });

  it('keeps waiting when the gate errors but the dashboard is healthy', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/health')) return jsonResponse(200, { ok: true });
      return jsonResponse(500, { error: 'gate blew up' });
    });

    let settled = false;
    void waitForRestartApproval(request(), {
      dashboardUrl: DASHBOARD_URL,
      fetchImpl,
      log: vi.fn(),
    }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
  });

  it('names both unblock paths in a message that stands on its own', () => {
    const lines = restartGateWaitLines(request(), 2).join('\n');
    expect(lines).toContain('Waiting for operator approval before restarting the dashboard.');
    expect(lines).toContain('"Restart now"');
    expect(lines).toContain('pan restart --now');
    expect(lines).toContain('One other restart request is waiting too');
    expect(lines).toContain('no timeout');
  });

  it('returns null from every one-shot call when the gate is absent (the --now bypass path)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: 'not found' }));
    const options = { dashboardUrl: DASHBOARD_URL, fetchImpl };

    await expect(registerRestartGateRequest(request(), options)).resolves.toBeNull();
    await expect(approveRestartGate(options)).resolves.toBeNull();
    await expect(claimRestartGate('restart:9', options)).resolves.toBeNull();
    await expect(readRestartGate(options)).resolves.toBeNull();
  });

  it('registers, approves and claims in one pass for the --now bypass', async () => {
    const gate = createGate();
    const options = { dashboardUrl: DASHBOARD_URL, fetchImpl: gate.fetchImpl };
    const requesterId = restartGateRequesterId('restart', undefined, 4242);

    expect(requesterId).toBe('restart:4242');
    await expect(registerRestartGateRequest({ requesterId, kind: 'restart', reason: 'pan restart --now (dashboard)' }, options))
      .resolves.toMatchObject({ status: 'pending', pendingCount: 1 });
    await expect(approveRestartGate(options)).resolves.toEqual({ approved: true, pendingCount: 1 });
    await expect(claimRestartGate(requesterId, options)).resolves.toBe(true);
    expect(gate.state.claimedBy).toBe(requesterId);
  });

  it('reads the gate for display', async () => {
    const snapshot = {
      status: 'pending',
      pending: [{ requesterId: 'deploy:PAN-3729:7', kind: 'deploy', reason: 'post-merge deploy', requestedAt: '2026-08-14T00:00:00.000Z' }],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, snapshot));

    await expect(readRestartGate({ dashboardUrl: DASHBOARD_URL, fetchImpl })).resolves.toEqual(snapshot);
  });
});
