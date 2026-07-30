import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  getProviderAuthMode: vi.fn(),
}));

vi.mock('../../agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents.js')>();
  return {
    ...actual,
    getProviderAuthMode: mocks.getProviderAuthMode,
  };
});

import { startPlanningForIssue } from '../planning-sessions.js';

function readJson(response: { body?: unknown }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

describe('startPlanningForIssue harness-gate ordering (PAN-1837 review fix)', () => {
  let overdeckHome: string;
  const previousOverdeckHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderAuthMode.mockResolvedValue(undefined);
    // A regression that reintroduces validate-after-mutation would write a
    // real preliminary agent-state file — isolate that write into a tmpdir
    // instead of the real ~/.overdeck so a regressed test can't taint it.
    overdeckHome = mkdtempSync(join(tmpdir(), 'pan-start-planning-gate-'));
    process.env.OVERDECK_HOME = overdeckHome;
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('returns 400 with the policy reason and performs no mutation when the explicit harness/model pair is denied', async () => {
    const lifecycle = { transitionTo: vi.fn(), addLabel: vi.fn() };
    const eventStore = { append: vi.fn() };
    const linear = { getIssue: vi.fn() };
    const github = { getIssue: vi.fn(), getComments: vi.fn() };
    const rally = { getIssue: vi.fn(), getChildIssues: vi.fn() };

    const response = await Effect.runPromise(
      startPlanningForIssue({
        id: 'PAN-1837',
        body: { harness: 'kimi-code', model: 'claude-sonnet-5' },
        eventStore,
        linear,
        github,
        rally,
        lifecycle,
        startedBy: 'test',
      }),
    );

    expect(response.status).toBe(400);
    const payload = readJson(response as unknown as { body?: unknown });
    expect(payload.error).toMatch(/Kimi Code harness runs Kimi \(Moonshot\) models only/);

    // The whole point of this test: a rejected planning selection must not
    // fetch the issue, transition its lifecycle state, emit any event, or
    // write a preliminary planning agent-state file — all of that used to
    // happen BEFORE this validation ran.
    expect(lifecycle.transitionTo).not.toHaveBeenCalled();
    expect(lifecycle.addLabel).not.toHaveBeenCalled();
    expect(eventStore.append).not.toHaveBeenCalled();
    expect(linear.getIssue).not.toHaveBeenCalled();
    expect(github.getIssue).not.toHaveBeenCalled();
    expect(rally.getIssue).not.toHaveBeenCalled();
    expect(existsSync(join(overdeckHome, 'agents', 'planning-pan-1837', 'state.json'))).toBe(false);
  });
});
