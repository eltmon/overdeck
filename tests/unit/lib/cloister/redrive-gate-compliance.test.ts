import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { decideAutonomousRedrive } from '../../../../src/lib/cloister/redrive-gate.js';
import { setCachedMemoryVerdictForTests } from '../../../../src/lib/cloister/memory-verdict-cache.js';

afterEach(() => setCachedMemoryVerdictForTests(null));

describe('PAN-2543 re-drive gate compliance', () => {
  it('defers when the unified resume policy blocks', () => {
    expect(decideAutonomousRedrive({ paused: true })).toEqual({
      decision: 'defer',
      reason: 'agent is paused',
    });
    expect(decideAutonomousRedrive({ stoppedByUser: true })).toEqual({
      decision: 'defer',
      reason: 'agent was stopped by the operator',
      needsYou: true,
    });
  });

  it('uses the cached memory verdict and never polls live pressure', () => {
    setCachedMemoryVerdictForTests({
      band: 'hard',
      availableBytes: 0,
      thresholds: { warningBytes: 1, criticalBytes: 1 },
    });
    expect(decideAutonomousRedrive({})).toEqual({
      decision: 'defer',
      reason: 'memory pressure is hard',
    });

    setCachedMemoryVerdictForTests({
      band: 'ok',
      availableBytes: 2,
      thresholds: { warningBytes: 1, criticalBytes: 0 },
    });
    expect(decideAutonomousRedrive({})).toEqual({
      decision: 'proceed',
      gateDecision: { decision: 'proceed' },
    });
  });

  it('admits completed-handoff rework through both gates', () => {
    expect(decideAutonomousRedrive(
      { stoppedByUser: true },
      { hasCompletedHandoff: true, owesRework: true },
    )).toEqual({
      decision: 'proceed',
      gateDecision: { decision: 'proceed', clearStoppedByUser: true },
    });
  });

  it('enumerates every PAN-2543 autonomous re-drive entry point through the shared gate', () => {
    const entryPoints = [
      ['src/lib/cloister/deacon.ts', 'decideAgentAutonomousRedrive'],
      ['src/lib/cloister/swarm-failed-slot.ts', 'decideAutonomousRedrive'],
    ] as const;
    for (const [path, predicate] of entryPoints) expect(readFileSync(path, 'utf8'), path).toContain(predicate);
  });
});
