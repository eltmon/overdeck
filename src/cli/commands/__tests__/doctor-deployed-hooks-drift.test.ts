import { describe, expect, it } from 'vitest';

import { checkDeployedHooksDrift } from '../doctor-hooks-drift.js';

type PlanItem = { name: string; status: 'new' | 'updated' | 'current' };

const current = (name: string): PlanItem => ({ name, status: 'current' });
const updated = (name: string): PlanItem => ({ name, status: 'updated' });

describe('checkDeployedHooksDrift (PAN-3327)', () => {
  it('passes when every deployed hook matches the sync source tree', () => {
    const result = checkDeployedHooksDrift([current('stop-hook'), current('heartbeat-hook')]);

    expect(result.status).toBe('ok');
    expect(result.message).toContain('2 hooks match');
    expect(result.fix).toBeUndefined();
  });

  it('warns and names the drifted hooks so a silent no-op sync is visible', () => {
    const result = checkDeployedHooksDrift([
      updated('work-agent-stop-hook'),
      current('heartbeat-hook'),
    ]);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('1/2 deployed hooks differ');
    expect(result.message).toContain('work-agent-stop-hook');
    expect(result.fix).toBeDefined();
  });

  it('truncates a long drift list rather than printing every hook', () => {
    const plan = Array.from({ length: 8 }, (_, index) => updated(`hook-${index}`));

    const result = checkDeployedHooksDrift(plan);

    expect(result.message).toContain('8/8 deployed hooks differ');
    expect(result.message).toContain('+3 more');
    expect(result.message).not.toContain('hook-7');
  });

  it('warns when there are no hook sources to compare against', () => {
    const result = checkDeployedHooksDrift([]);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('No hook sources found');
  });
});
