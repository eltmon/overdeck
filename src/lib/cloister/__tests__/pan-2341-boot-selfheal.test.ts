import { describe, expect, it, vi } from 'vitest';
import {
  runBootAdvancingSelfHeal,
  type BootAdvancingSelfHealDeps,
} from '../advancing-selfheal.js';

function deps(overrides: Partial<BootAdvancingSelfHealDeps> = {}): BootAdvancingSelfHealDeps {
  return {
    reconcileInFlightJournals: vi.fn(async () => []),
    checkMergedAdvancingSessions: vi.fn(async () => []),
    log: vi.fn(),
    ...overrides,
  };
}

describe('PAN-2341 boot advancing self-heal', () => {
  it('runs journal reconcile then the merged reaper in order (PAN-2579: no idle-terminal reap — warm sessions persist)', async () => {
    const order: string[] = [];
    const d = deps({
      reconcileInFlightJournals: vi.fn(async () => { order.push('reconcile'); return ['reconciled PAN-3001']; }),
      checkMergedAdvancingSessions: vi.fn(async () => { order.push('merged'); return ['reaped merged']; }),
    });

    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual([
      'reconciled PAN-3001',
      'reaped merged',
    ]);
    expect(order).toEqual(['reconcile', 'merged']);
  });

  it('continues later boot self-heal steps when one guarded step fails', async () => {
    const d = deps({
      reconcileInFlightJournals: vi.fn(async () => { throw new Error('readonly db'); }),
      checkMergedAdvancingSessions: vi.fn(async () => ['reaped merged']),
    });

    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual(['reaped merged']);
    expect(d.log).toHaveBeenCalledWith('startDeacon: reconcileInFlightJournals boot self-heal failed: readonly db');
  });

  it('frees the slot via the journal reconcile action alone (warm sessions are excluded from the ceiling, not reaped)', async () => {
    const d = deps({
      reconcileInFlightJournals: vi.fn(async () => ['Reconciled journaled advancing verdict for PAN-3001']),
    });

    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual([
      'Reconciled journaled advancing verdict for PAN-3001',
    ]);
  });

  it('is idempotent when invoked twice after the first run reaps all candidates', async () => {
    let alreadyReaped = false;
    const d = deps({
      checkMergedAdvancingSessions: vi.fn(async () => {
        if (alreadyReaped) return [];
        alreadyReaped = true;
        return ['Reaped merged advancing session agent-pan-3001-review (issue merged, row stopped)'];
      }),
    });

    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual([
      'Reaped merged advancing session agent-pan-3001-review (issue merged, row stopped)',
    ]);
    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual([]);
  });
});
