import { describe, it, expect } from 'vitest';
import { decideFlywheelRemediation } from '../../../../src/lib/cloister/stuck-remediation.js';
import type { StuckRemediationState } from '../../../../src/lib/cloister/stuck-remediation-state.js';

// PAN-2160: the flywheel orchestrator must be relaunched (capped) when it dies
// or wedges, never parked. decideFlywheelRemediation is the pure decision the
// deacon executes; these tests lock its cap/window/active-run behavior.

const NOW = 1_700_000_000_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const state = (over: Partial<StuckRemediationState>): StuckRemediationState => ({
  lastStage: 0,
  lastStageAt: iso(NOW),
  firstStuckAt: iso(NOW),
  ...over,
});

describe('decideFlywheelRemediation (PAN-2160)', () => {
  it('noop when the operator has stopped the flywheel (no active run)', () => {
    expect(decideFlywheelRemediation({ hasActiveRun: false, prev: null, now: NOW })).toEqual({
      kind: 'noop',
    });
    // Even with prior respawn state, an absent active run is the operator's stop signal.
    expect(
      decideFlywheelRemediation({
        hasActiveRun: false,
        prev: state({ respawnCount: 1, lastRespawnAt: iso(NOW - 60_000) }),
        now: NOW,
      }),
    ).toEqual({ kind: 'noop' });
  });

  it('relaunches on first recovery (no prior respawns)', () => {
    expect(decideFlywheelRemediation({ hasActiveRun: true, prev: null, now: NOW })).toEqual({
      kind: 'relaunch',
      respawnCount: 1,
    });
  });

  it('keeps relaunching while under the cap, within the window', () => {
    const prev = state({ respawnCount: 1, lastRespawnAt: iso(NOW - 60_000) });
    expect(decideFlywheelRemediation({ hasActiveRun: true, prev, now: NOW })).toEqual({
      kind: 'relaunch',
      respawnCount: 2,
    });
  });

  it('escalates to paused+troubled once the cap is hit within the window', () => {
    const prev = state({ respawnCount: 3, lastRespawnAt: iso(NOW - 60_000) });
    expect(decideFlywheelRemediation({ hasActiveRun: true, prev, now: NOW })).toEqual({
      kind: 'escalate',
      respawnCount: 3,
    });
  });

  it('resets the respawn count once the 30min window has elapsed (relaunch, not escalate)', () => {
    const prev = state({ respawnCount: 3, lastRespawnAt: iso(NOW - 31 * 60_000) });
    expect(decideFlywheelRemediation({ hasActiveRun: true, prev, now: NOW })).toEqual({
      kind: 'relaunch',
      respawnCount: 1,
    });
  });
});
