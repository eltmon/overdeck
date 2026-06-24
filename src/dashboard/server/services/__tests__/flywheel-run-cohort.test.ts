import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRunCohort, loadRunCohort, isCohortDrained } from '../flywheel-run-state.js';

// PAN-2006 WI-7: Run cohort drain-to-quiescence primitives.
describe('flywheel run cohort', () => {
  let home: string;
  const opts = () => ({ overdeckHome: home });

  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'pan-cohort-')); });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); });

  it('save → load round-trips the cohort issue ids', () => {
    saveRunCohort('RUN-7', ['PAN-1', 'PAN-2', 'PAN-3'], opts());
    expect(loadRunCohort('RUN-7', opts())).toEqual(['PAN-1', 'PAN-2', 'PAN-3']);
  });

  it('loadRunCohort returns null when no snapshot exists', () => {
    expect(loadRunCohort('RUN-99', opts())).toBeNull();
  });

  it('isCohortDrained is true only when every member is terminal', () => {
    saveRunCohort('RUN-7', ['PAN-1', 'PAN-2'], opts());
    const terminal = new Set(['PAN-1']);
    expect(isCohortDrained('RUN-7', (id) => terminal.has(id), opts())).toBe(false);
    terminal.add('PAN-2');
    expect(isCohortDrained('RUN-7', (id) => terminal.has(id), opts())).toBe(true);
  });

  it('isCohortDrained is false when there is no cohort or it is empty', () => {
    expect(isCohortDrained('RUN-99', () => true, opts())).toBe(false);
    saveRunCohort('RUN-8', [], opts());
    expect(isCohortDrained('RUN-8', () => true, opts())).toBe(false);
  });
});
