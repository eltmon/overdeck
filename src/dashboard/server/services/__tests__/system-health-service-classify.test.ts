import { describe, expect, it } from 'vitest';

import {
  buildSystemHealthTransitionPayload,
  classifyAgentKind,
  evaluateSeverity,
} from '../system-health-service.js';

const GIB = 1024 ** 3;

const thresholds = {
  memoryAvailableWarningBytes: 4 * GIB,
  memoryAvailableCriticalBytes: 2 * GIB,
  swapUsedWarningPercent: 20,
  swapUsedCriticalPercent: 50,
  cpuLoadWarningPerCore: 1,
  cpuLoadCriticalPerCore: 1.5,
  overcommitWarningPercent: 150,
  overcommitCriticalPercent: 200,
};

function severityInput(overrides: Partial<Parameters<typeof evaluateSeverity>[1]> = {}): Parameters<typeof evaluateSeverity>[1] {
  return {
    availableMemoryBytes: 16 * GIB,
    swapUsedPercent: 0,
    loadPerCore1m: 0.2,
    overcommitPercent: 40,
    leakedSpecialistCount: 0,
    smeeRelay: {
      configured: false,
      running: false,
      status: 'not_configured',
      message: 'Not configured',
    },
    ...overrides,
  };
}

describe('classifyAgentKind (PAN-1257)', () => {
  it.each([
    ['work', 'work'],
    ['review', 'specialist'],
    ['review-correctness', 'specialist'],
    ['review-security', 'specialist'],
    ['test', 'specialist'],
    ['ship', 'specialist'],
    [undefined, 'work'],
    [null, 'specialist'],
  ] as const)('classifies agent-* with role %s as %s', (role, expected) => {
    expect(classifyAgentKind('agent-foo', role as unknown as string | undefined)).toBe(expected);
  });

  it('classifies legacy planning prefixes as planning agents', () => {
    expect(classifyAgentKind('planning-foo')).toBe('planning');
  });

  it('classifies legacy specialist prefixes as specialists', () => {
    expect(classifyAgentKind('specialist-foo')).toBe('specialist');
  });
});

describe('accepted system health transitions', () => {
  it('preserves legacy fields and adds versioned accepted evidence', () => {
    expect(buildSystemHealthTransitionPayload({
      version: 7,
      previousState: 'healthy',
      state: 'warning',
      reasonCodes: ['host.linux.psi.some.warning'],
      acceptedAt: '2026-07-16T12:00:00.000Z',
    }, 2)).toEqual({
      version: 2,
      transitionVersion: 7,
      previousSeverity: 'normal',
      severity: 'warning',
      previousState: 'healthy',
      state: 'warning',
      reasons: ['host.linux.psi.some.warning'],
      reasonCodes: ['host.linux.psi.some.warning'],
      acceptedAt: '2026-07-16T12:00:00.000Z',
      leakedSpecialistCount: 2,
    });
  });
});

describe('evaluateSeverity memory thresholds', () => {
  it('keeps healthy memory usage normal when available RAM is above warning threshold', () => {
    expect(evaluateSeverity(thresholds, severityInput({
      availableMemoryBytes: 42 * GIB,
    }))).toEqual({ severity: 'normal', reasons: [] });
  });

  it('warns below the available-memory warning threshold', () => {
    const result = evaluateSeverity(thresholds, severityInput({
      availableMemoryBytes: Math.floor(3.5 * GIB),
    }));

    expect(result.severity).toBe('warning');
    expect(result.reasons).toEqual(['Available RAM is tight (3.5 GB).']);
  });

  it('marks critical below the available-memory critical threshold', () => {
    const result = evaluateSeverity(thresholds, severityInput({
      availableMemoryBytes: Math.floor(1.5 * GIB),
    }));

    expect(result.severity).toBe('critical');
    expect(result.reasons).toEqual(['Available RAM is low (1.5 GB).']);
  });

  it('does not warn exactly at the memory threshold boundaries', () => {
    expect(evaluateSeverity(thresholds, severityInput({
      availableMemoryBytes: 4 * GIB,
    }))).toEqual({ severity: 'normal', reasons: [] });

    const result = evaluateSeverity(thresholds, severityInput({
      availableMemoryBytes: 2 * GIB,
    }));

    expect(result.severity).toBe('warning');
    expect(result.reasons).toEqual(['Available RAM is tight (2 GB).']);
  });
});
