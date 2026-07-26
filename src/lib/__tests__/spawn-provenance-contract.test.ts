import { describe, expect, it } from 'vitest';
import {
  resolveAgentStartedBy,
  type SpawnOptions,
  type SpawnRunOptions,
} from '../agents/spawn-prep.js';
import type { SpawnPlanningOptions } from '../planning/spawn-planning-session.js';

type IsRequired<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;

const spawnAgentRequiresStartedBy: IsRequired<SpawnOptions, 'startedBy'> = true;
const spawnRunRequiresStartedBy: IsRequired<SpawnRunOptions, 'startedBy'> = true;
const spawnPlanningRequiresStartedBy: IsRequired<SpawnPlanningOptions, 'startedBy'> = true;

describe('spawn provenance contract', () => {
  it('requires provenance in both fresh-launch option types', () => {
    expect(spawnAgentRequiresStartedBy).toBe(true);
    expect(spawnRunRequiresStartedBy).toBe(true);
    expect(spawnPlanningRequiresStartedBy).toBe(true);
  });

  it('fails closed when no immediate or inherited origin is available', () => {
    expect(() => resolveAgentStartedBy(undefined, undefined, undefined)).toThrow(
      'Agent spawn provenance is required',
    );
  });

  it('normalizes explicit and flywheel origins', () => {
    expect(resolveAgentStartedBy(' operator:cli:pan-start ', undefined, undefined))
      .toBe('operator:cli:pan-start');
    expect(resolveAgentStartedBy(undefined, 'RUN-42', undefined)).toBe('flywheel:RUN-42');
  });
});
