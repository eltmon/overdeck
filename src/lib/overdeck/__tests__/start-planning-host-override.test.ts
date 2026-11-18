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

import { buildHostOverrideConfirmation } from '../../agents/host-override.js';
import { startPlanningForIssue } from '../planning-sessions.js';

function readJson(response: { body?: unknown }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

function deps() {
  return {
    lifecycle: { transitionTo: vi.fn(), addLabel: vi.fn() },
    eventStore: { append: vi.fn() },
    linear: { getIssue: vi.fn() },
    github: { getIssue: vi.fn(), getComments: vi.fn() },
    rally: { getIssue: vi.fn(), getChildIssues: vi.fn() },
  };
}

describe('startPlanningForIssue host override (PAN-5498)', () => {
  let overdeckHome: string;
  const previousOverdeckHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderAuthMode.mockResolvedValue(undefined);
    overdeckHome = mkdtempSync(join(tmpdir(), 'pan-start-planning-host-'));
    process.env.OVERDECK_HOME = overdeckHome;
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('refuses host: true with a wrong confirmation phrase (409) and performs no mutation', async () => {
    const d = deps();
    const response = await Effect.runPromise(
      startPlanningForIssue({ id: 'PAN-1837', body: { host: true, hostOverrideConfirmation: 'yes' }, ...d, startedBy: 'test' }),
    );

    expect(response.status).toBe(409);
    const payload = readJson(response as unknown as { body?: unknown });
    expect(payload.error).toBe('host_override_confirmation_required');
    expect(payload.confirmation).toBe(buildHostOverrideConfirmation('PAN-1837'));
    expect(d.lifecycle.transitionTo).not.toHaveBeenCalled();
    expect(d.eventStore.append).not.toHaveBeenCalled();
    expect(d.github.getIssue).not.toHaveBeenCalled();
    expect(existsSync(join(overdeckHome, 'agents', 'planning-pan-1837'))).toBe(false);
  });

  it('accepts host: true with the exact phrase and moves on to the next validation', async () => {
    const d = deps();
    const response = await Effect.runPromise(
      startPlanningForIssue({
        id: 'PAN-1837',
        body: { host: true, hostOverrideConfirmation: buildHostOverrideConfirmation('PAN-1837'), effort: 'bogus' },
        ...d,
        startedBy: 'test',
      }),
    );

    // The effort check runs right after the host check, so a 400 proves the phrase passed.
    expect(response.status).toBe(400);
    expect(readJson(response as unknown as { body?: unknown }).error).toMatch(/Invalid effort/);
  });
});
