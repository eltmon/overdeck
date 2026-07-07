import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import {
  runBootAdvancingSelfHeal,
  type BootAdvancingSelfHealDeps,
} from '../deacon.js';

function deps(overrides: Partial<BootAdvancingSelfHealDeps> = {}): BootAdvancingSelfHealDeps {
  return {
    reconcileInFlightJournals: vi.fn(async () => []),
    checkMergedAdvancingSessions: vi.fn(async () => []),
    checkIdleTerminalAdvancingSessions: vi.fn(async () => []),
    log: vi.fn(),
    ...overrides,
  };
}

describe('PAN-2341 boot advancing self-heal', () => {
  it('runs journal reconcile, merged reaper, and idle-terminal reaper in order', async () => {
    const order: string[] = [];
    const d = deps({
      reconcileInFlightJournals: vi.fn(async () => { order.push('reconcile'); return ['reconciled PAN-3001']; }),
      checkMergedAdvancingSessions: vi.fn(async () => { order.push('merged'); return ['reaped merged']; }),
      checkIdleTerminalAdvancingSessions: vi.fn(async () => { order.push('idle'); return ['reaped idle']; }),
    });

    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual([
      'reconciled PAN-3001',
      'reaped merged',
      'reaped idle',
    ]);
    expect(order).toEqual(['reconcile', 'merged', 'idle']);
  });

  it('continues later boot self-heal steps when one guarded step fails', async () => {
    const d = deps({
      reconcileInFlightJournals: vi.fn(async () => { throw new Error('readonly db'); }),
      checkMergedAdvancingSessions: vi.fn(async () => ['reaped merged']),
    });

    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual(['reaped merged']);
    expect(d.log).toHaveBeenCalledWith('startDeacon: reconcileInFlightJournals boot self-heal failed: readonly db');
  });

  it('frees the slot via the ordered reconcile then idle reaper actions', async () => {
    const d = deps({
      reconcileInFlightJournals: vi.fn(async () => ['Reconciled journaled advancing verdict for PAN-3001']),
      checkIdleTerminalAdvancingSessions: vi.fn(async () => [
        'Reaped idle terminal advancing session agent-pan-3001-review (verdict recorded, idle >=10m, row stopped)',
      ]),
    });

    await expect(runBootAdvancingSelfHeal(d)).resolves.toEqual([
      'Reconciled journaled advancing verdict for PAN-3001',
      'Reaped idle terminal advancing session agent-pan-3001-review (verdict recorded, idle >=10m, row stopped)',
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

  it('startDeacon calls boot self-heal after liveness reconcile and before startup patrol', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const deaconSource = readFileSync(join(testDir, '..', 'deacon.ts'), 'utf-8');

    const livenessIndex = deaconSource.indexOf('await reconcileAgentLiveness()');
    const bootIndex = deaconSource.indexOf('await runBootAdvancingSelfHeal()');
    const startupPatrolIndex = deaconSource.indexOf("runScheduledPatrol('startup')");

    expect(livenessIndex).toBeGreaterThan(-1);
    expect(bootIndex).toBeGreaterThan(livenessIndex);
    expect(startupPatrolIndex).toBeGreaterThan(bootIndex);
  });
});
