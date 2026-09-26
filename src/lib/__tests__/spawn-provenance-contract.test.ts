import { describe, expect, it } from 'vitest';
import {
  resolveAgentStartedBy,
  type SpawnOptions,
  type SpawnRunOptions,
} from '../agents/spawn-prep.js';
import {
  FLYWHEEL_STARTED_BY,
  isFlywheelStartedBy,
  planningHandoffStartedBy,
  resolveCliStartedBy,
} from '../agents/provenance.js';
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
    expect(() => resolveAgentStartedBy(undefined, undefined, '')).toThrow(
      'Agent spawn provenance is required',
    );
  });

  it('normalizes explicit and flywheel origins', () => {
    expect(resolveAgentStartedBy(' operator:cli:pan-start ', undefined, ''))
      .toBe('operator:cli:pan-start');
    expect(resolveAgentStartedBy(undefined, 'RUN-42', '')).toBe('flywheel:RUN-42');
  });

  it('treats blank inherited CLI provenance as unset', () => {
    expect(resolveCliStartedBy('operator:cli:pan-plan', {
      OVERDECK_AGENT_STARTED_BY: '   ',
      OVERDECK_CONVERSATION: 'conv-flywheel',
    })).toBe('flywheel:conv-flywheel');
    expect(resolveCliStartedBy('operator:cli:pan-start', {
      OVERDECK_AGENT_STARTED_BY: '',
      OVERDECK_CONVERSATION: 'not-flywheel',
    })).toBe('operator:cli:pan-start');
  });

  it('mints the Flywheel token from OVERDECK_CONVERSATION when unset', () => {
    expect(resolveCliStartedBy('operator:cli:pan-start', {
      OVERDECK_AGENT_STARTED_BY: '',
      OVERDECK_CONVERSATION: 'conv-flywheel',
    })).toBe('flywheel:conv-flywheel');
  });

  it('prefers inherited startedBy over OVERDECK_CONVERSATION', () => {
    expect(resolveCliStartedBy('operator:cli:pan-start', {
      OVERDECK_AGENT_STARTED_BY: 'planning-auto-handoff',
      OVERDECK_CONVERSATION: 'conv-flywheel',
    })).toBe('planning-auto-handoff');
  });

  it('no longer reads OVERDECK_FLYWHEEL_RUN_ID', () => {
    expect(resolveCliStartedBy('operator:cli:pan-start', {
      OVERDECK_FLYWHEEL_RUN_ID: 'RUN-42',
    })).toBe('operator:cli:pan-start');
  });

  it('isFlywheelStartedBy identifies flywheel-prefixed provenance', () => {
    expect(isFlywheelStartedBy('flywheel:conv-flywheel')).toBe(true);
    expect(isFlywheelStartedBy('flywheel:RUN-84')).toBe(true);
    expect(isFlywheelStartedBy('operator:cli:pan-start')).toBe(false);
    expect(isFlywheelStartedBy('planning-auto-handoff')).toBe(false);
    expect(isFlywheelStartedBy('')).toBe(false);
    expect(isFlywheelStartedBy(undefined)).toBe(false);
  });

  it('planningHandoffStartedBy carries Flywheel provenance only for Flywheel chains', () => {
    expect(planningHandoffStartedBy('operator:cli:pan-start')).toBe('planning-auto-handoff');
    expect(planningHandoffStartedBy(undefined)).toBe('planning-auto-handoff');
    expect(planningHandoffStartedBy('flywheel:conv-flywheel')).toBe(FLYWHEEL_STARTED_BY);
    expect(planningHandoffStartedBy('flywheel:RUN-84')).toBe(FLYWHEEL_STARTED_BY);
  });
});
