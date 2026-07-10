import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldRunRecoveryJanitor } from '../../../../src/lib/cloister/patrol-cadence.js';

describe('PAN-2543 deterministic recovery cadence', () => {
  it('uses fixed cycle modulo for all three recovery janitors', () => {
    const source = readFileSync('src/lib/cloister/deacon.ts', 'utf8');
    expect(source).not.toMatch(/Math\.random\(\).*cleanup/);
    expect(source).toContain("shouldRunRecoveryJanitor('agent-state', state.patrolCycle)");
    expect(source).toContain("shouldRunRecoveryJanitor('feedback', state.patrolCycle)");
    expect(source).toContain("shouldRunRecoveryJanitor('orphan-reviewer', state.patrolCycle)");
    expect(Array.from({ length: 60 }, (_, index) => index + 1).filter(cycle => shouldRunRecoveryJanitor('feedback', cycle))).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(Array.from({ length: 60 }, (_, index) => index + 1).filter(cycle => shouldRunRecoveryJanitor('agent-state', cycle))).toEqual([60]);
  });
});
