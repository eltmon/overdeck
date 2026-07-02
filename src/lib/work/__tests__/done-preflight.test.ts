import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPreflightChecks } from '../done-preflight.js';
import { runTestRequirementCheck } from '../test-requirement-gate.js';

vi.mock('../test-requirement-gate.js', () => ({
  runTestRequirementCheck: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: unknown) => {
    const cb = callback as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
    cb(null, { stdout: '[]' }, '');
    return undefined as unknown as ReturnType<typeof execFile>;
  }),
}));

describe('runPreflightChecks', () => {
  it('forwards testWaived to runTestRequirementCheck (AC1)', async () => {
    vi.mocked(runTestRequirementCheck).mockReturnValue(
      Effect.succeed([]),
    );

    await Effect.runPromise(runPreflightChecks('/workspace', 'PAN-1501', 'waived reason'));
    expect(runTestRequirementCheck).toHaveBeenCalledWith('/workspace', 'PAN-1501', 'waived reason');
  });

  it('appends test-requirement failure lines after the AC-status check (AC2)', async () => {
    vi.mocked(runTestRequirementCheck).mockReturnValue(
      Effect.succeed(['  Test gate failure']),
    );

    const failures = await Effect.runPromise(runPreflightChecks('/workspace', 'PAN-1501'));
    expect(failures).toContain('  Test gate failure');
  });
});

describe('open-beads check follows .beads/redirect (PAN-2195)', () => {
  const makeBead = (status: string): string =>
    JSON.stringify({ id: 'b1', title: 'pan-9999: x', labels: ['pan-9999'], status }) + '\n';

  it('reads the redirected live ledger, not the stale workspace-local snapshot', async () => {
    vi.mocked(runTestRequirementCheck).mockReturnValue(Effect.succeed([]));
    const base = mkdtempSync(join(tmpdir(), 'preflight-redirect-'));
    try {
      // Live (main) ledger: the bead is CLOSED.
      mkdirSync(join(base, '.beads'), { recursive: true });
      writeFileSync(join(base, '.beads', 'issues.jsonl'), makeBead('closed'));
      // Workspace two levels deep with a redirect + a STALE local snapshot (bead OPEN).
      const ws = join(base, 'workspaces', 'feature-pan-9999');
      mkdirSync(join(ws, '.beads'), { recursive: true });
      writeFileSync(join(ws, '.beads', 'redirect'), '../../.beads');
      writeFileSync(join(ws, '.beads', 'issues.jsonl'), makeBead('open'));

      const failures = await Effect.runPromise(runPreflightChecks(ws, 'PAN-9999'));
      expect(failures.some((f) => f.includes('Open beads'))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reports the local open bead when there is no redirect (contrast)', async () => {
    vi.mocked(runTestRequirementCheck).mockReturnValue(Effect.succeed([]));
    const base = mkdtempSync(join(tmpdir(), 'preflight-noredir-'));
    try {
      const ws = join(base, 'workspaces', 'feature-pan-9999');
      mkdirSync(join(ws, '.beads'), { recursive: true });
      writeFileSync(join(ws, '.beads', 'issues.jsonl'), makeBead('open'));

      const failures = await Effect.runPromise(runPreflightChecks(ws, 'PAN-9999'));
      expect(failures.some((f) => f.includes('Open beads'))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
