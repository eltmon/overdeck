/**
 * PAN-4438 — `pan review waive-test-removal <id> --reason "…"` refuses any
 * agent caller and otherwise delegates straight to `grantTestSkipWaiver`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWaiveTestRemoval, type WaiveTestRemovalDeps } from '../../../../src/cli/commands/review-waive-test-removal.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('runWaiveTestRemoval (PAN-4438)', () => {
  it('refuses an agent caller and never calls grant', async () => {
    const grant = vi.fn();
    const deps: WaiveTestRemovalDeps = {
      caller: () => ({ kind: 'agent', id: 'agent-pan-4438-work' }),
      grant,
    };

    await runWaiveTestRemoval('pan-4438', { reason: 'ok' }, deps);

    expect(grant).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('operator-only'));
  });

  it('calls grant with the conv- caller id for an operator conversation', async () => {
    const grant = vi.fn(async () => ({
      ok: true as const,
      waiver: { sha: 'abc123', reason: 'ok', at: '2026-09-30T00:00:00.000Z', by: 'conv-99' },
      workspacePath: '/tmp/ws',
    }));
    const deps: WaiveTestRemovalDeps = {
      caller: () => ({ kind: 'operator', id: 'conv-99' }),
      grant,
    };

    await runWaiveTestRemoval('pan-4438', { reason: 'ok' }, deps);

    expect(grant).toHaveBeenCalledWith({ issueId: 'PAN-4438', reason: 'ok', by: 'conv-99' });
  });

  it('calls grant with by: operator for a plain shell', async () => {
    const grant = vi.fn(async () => ({
      ok: true as const,
      waiver: { sha: 'abc123', reason: 'ok', at: '2026-09-30T00:00:00.000Z', by: 'operator' },
      workspacePath: '/tmp/ws',
    }));
    const deps: WaiveTestRemovalDeps = {
      caller: () => ({ kind: 'operator', id: null }),
      grant,
    };

    await runWaiveTestRemoval('pan-4438', { reason: 'ok' }, deps);

    expect(grant).toHaveBeenCalledWith({ issueId: 'PAN-4438', reason: 'ok', by: 'operator' });
  });

  it('prints the refusal message and sets exit code 1 when grant refuses', async () => {
    const deps: WaiveTestRemovalDeps = {
      caller: () => ({ kind: 'operator', id: null }),
      grant: vi.fn(async () => ({ ok: false as const, code: 'no-workspace' as const, message: 'No workspace found for PAN-4438.' })),
    };

    await runWaiveTestRemoval('pan-4438', { reason: 'ok' }, deps);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No workspace found for PAN-4438.'));
  });

  it('prints the full anchor and the re-run hint on success', async () => {
    const deps: WaiveTestRemovalDeps = {
      caller: () => ({ kind: 'operator', id: null }),
      grant: vi.fn(async () => ({
        ok: true as const,
        waiver: { sha: 'abc123def456', reason: 'operator approved', at: '2026-09-30T00:00:00.000Z', by: 'operator' },
        workspacePath: '/tmp/ws',
      })),
    };

    await runWaiveTestRemoval('pan-4438', { reason: 'operator approved' }, deps);

    expect(process.exitCode).not.toBe(1);
    const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
    expect(logged).toContain('abc123def456');
    expect(logged).toContain('pan review request PAN-4438');
  });
});
