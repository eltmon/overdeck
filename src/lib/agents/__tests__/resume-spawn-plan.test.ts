import { describe, expect, it } from 'vitest';

import { decideResumeSpawnPlan } from '../resume-spawn-plan.js';

const baseInput = {
  harness: 'claude-code' as const,
  compactSeed: false,
  driftReasons: [],
  piProcessWasAlive: true,
  transcriptExists: true,
  allowExplicitRecovery: false,
};

describe('decideResumeSpawnPlan', () => {
  it('fresh-launches and clears stale pointers for a missing Claude transcript', () => {
    expect(decideResumeSpawnPlan({
      ...baseInput,
      transcriptExists: false,
    })).toEqual({
      mode: 'fresh',
      freshReason: 'claude-jsonl-missing',
      clearSessionPointers: true,
      rotationRefused: false,
    });
  });

  it('resumes the saved Claude session when its transcript exists', () => {
    expect(decideResumeSpawnPlan(baseInput)).toEqual({
      mode: 'resume-saved',
      clearSessionPointers: false,
      rotationRefused: false,
    });
  });

  it('refuses drift rotation whether or not the Claude transcript exists', () => {
    for (const transcriptExists of [false, true]) {
      expect(decideResumeSpawnPlan({
        ...baseInput,
        driftReasons: ['model a→b'],
        transcriptExists,
      })).toEqual({
        mode: 'fresh',
        freshReason: 'drift',
        clearSessionPointers: false,
        rotationRefused: true,
      });
    }
  });

  it('identifies compact recovery before other fresh-launch reasons', () => {
    expect(decideResumeSpawnPlan({
      ...baseInput,
      compactSeed: true,
      driftReasons: ['model a→b'],
      transcriptExists: false,
    })).toEqual({
      mode: 'fresh',
      freshReason: 'compact',
      clearSessionPointers: false,
      rotationRefused: true,
    });
  });

  it('fresh-launches a dead Oh My Pi process without refusing rotation', () => {
    expect(decideResumeSpawnPlan({
      ...baseInput,
      harness: 'ohmypi',
      piProcessWasAlive: false,
      transcriptExists: false,
    })).toEqual({
      mode: 'fresh',
      freshReason: 'pi-dead-recovery',
      clearSessionPointers: false,
      rotationRefused: false,
    });
  });
});
