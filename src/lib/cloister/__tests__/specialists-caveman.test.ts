import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../caveman/workspace.js', () => ({
  readCavemanVariant: vi.fn(),
  determineCavemanVariant: vi.fn(),
  injectCavemanSettings: vi.fn(),
}));

import { readCavemanVariant } from '../../caveman/workspace.js';
import { buildSpecialistCavemanExports } from '../specialists.js';

const mockReadVariant = vi.mocked(readCavemanVariant);

const baseConfig = {
  enabled: true,
  abTest: false,
  modes: {
    work: 'full' as const,
    review: 'review' as const,
    test: 'lite' as const,
    merge: 'lite' as const,
  },
};

beforeEach(() => {
  mockReadVariant.mockResolvedValue('enabled');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildSpecialistCavemanExports', () => {
  it('returns empty string for inspect-agent (sentinel protection)', async () => {
    const result = await buildSpecialistCavemanExports('inspect-agent', '/workspace', baseConfig);
    expect(result).toBe('');
    (await Effect.runPromise(expect(mockReadVariant))).not.toHaveBeenCalled();
  });

  it('returns empty string when config.enabled is false', async () => {
    const result = await buildSpecialistCavemanExports('review-agent', '/workspace', { ...baseConfig, enabled: false });
    expect(result).toBe('');
    (await Effect.runPromise(expect(mockReadVariant))).not.toHaveBeenCalled();
  });

  it('returns empty string when workspacePath is undefined', async () => {
    const result = await buildSpecialistCavemanExports('review-agent', undefined, baseConfig);
    expect(result).toBe('');
    (await Effect.runPromise(expect(mockReadVariant))).not.toHaveBeenCalled();
  });

  it('returns empty string for unknown specialist type', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('enabled')));
    const result = await buildSpecialistCavemanExports('unknown-agent', '/workspace', baseConfig);
    expect(result).toBe('');
  });

  it('returns only PANOPTICON_CAVEMAN_VARIANT when variant is "disabled"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('disabled')));
    const result = await buildSpecialistCavemanExports('review-agent', '/workspace', baseConfig);
    expect(result).toBe('export PANOPTICON_CAVEMAN_VARIANT="disabled"\n');
    expect(result).not.toContain('CAVEMAN_DEFAULT_MODE');
  });

  it('returns empty string when variant is "off"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('off')));
    const result = await buildSpecialistCavemanExports('review-agent', '/workspace', baseConfig);
    expect(result).toBe('');
  });

  it.each([
    ['review-agent', 'review', 'ultra' as const],
    ['test-agent', 'test', 'full' as const],
    ['merge-agent', 'merge', 'lite' as const],
  ] as const)('%s uses the correct mode key', async (specialistType, modeKey, modeValue) => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('enabled')));
    const config = {
      ...baseConfig,
      modes: { ...baseConfig.modes, [modeKey]: modeValue },
    };
    const result = await buildSpecialistCavemanExports(specialistType, '/workspace', config);
    expect(result).toContain(`export CAVEMAN_DEFAULT_MODE="${modeValue}"`);
    expect(result).toContain('export PANOPTICON_CAVEMAN_VARIANT="enabled"');
  });

  it('returns empty string when mode is "off"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('enabled')));
    const config = { ...baseConfig, modes: { ...baseConfig.modes, review: 'off' as const } };
    const result = await buildSpecialistCavemanExports('review-agent', '/workspace', config);
    expect(result).toBe('');
  });

  it('returns empty string when mode is "disabled"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('enabled')));
    const config = { ...baseConfig, modes: { ...baseConfig.modes, review: 'disabled' as const } };
    const result = await buildSpecialistCavemanExports('review-agent', '/workspace', config);
    expect(result).toBe('');
  });
});
