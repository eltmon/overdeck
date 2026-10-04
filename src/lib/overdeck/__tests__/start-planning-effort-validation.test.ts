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

describe('startPlanningForIssue effort validation', () => {
  let overdeckHome: string;
  const previousOverdeckHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderAuthMode.mockResolvedValue(undefined);
    overdeckHome = mkdtempSync(join(tmpdir(), 'pan-start-planning-effort-'));
    process.env.OVERDECK_HOME = overdeckHome;
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('returns 400 with the allowed levels and performs no mutation for an invalid effort', async () => {
    const lifecycle = { transitionTo: vi.fn(), addLabel: vi.fn() };
    const eventStore = { append: vi.fn() };
    const linear = { getIssue: vi.fn() };
    const github = { getIssue: vi.fn(), getComments: vi.fn() };
    const rally = { getIssue: vi.fn(), getChildIssues: vi.fn() };

    const response = await Effect.runPromise(
      startPlanningForIssue({
        id: 'PAN-1837',
        body: { effort: 'bogus' },
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
    expect(payload.error).toMatch(/low, medium, high, xhigh, max/);

    expect(lifecycle.transitionTo).not.toHaveBeenCalled();
    expect(lifecycle.addLabel).not.toHaveBeenCalled();
    expect(eventStore.append).not.toHaveBeenCalled();
    expect(linear.getIssue).not.toHaveBeenCalled();
    expect(github.getIssue).not.toHaveBeenCalled();
    expect(rally.getIssue).not.toHaveBeenCalled();
    expect(existsSync(join(overdeckHome, 'agents', 'planning-pan-1837', 'state.json'))).toBe(false);
  });

  it('passes a valid effort through to the existing harness-gate check', async () => {
    const lifecycle = { transitionTo: vi.fn(), addLabel: vi.fn() };
    const eventStore = { append: vi.fn() };
    const linear = { getIssue: vi.fn() };
    const github = { getIssue: vi.fn(), getComments: vi.fn() };
    const rally = { getIssue: vi.fn(), getChildIssues: vi.fn() };

    const response = await Effect.runPromise(
      startPlanningForIssue({
        id: 'PAN-1837',
        body: { effort: 'max', harness: 'kimi-code', model: 'claude-sonnet-5' },
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
  });
});
