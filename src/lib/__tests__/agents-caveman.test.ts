import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock caveman/workspace.js so readCavemanVariant returns controlled values
vi.mock('../caveman/workspace.js', () => ({
  readCavemanVariant: vi.fn(),
  determineCavemanVariant: vi.fn(),
  injectCavemanSettings: vi.fn(),
}));

import { readCavemanVariant } from '../caveman/workspace.js';
import { buildCavemanExports } from '../agents.js';

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

describe('buildCavemanExports', () => {
  it('returns empty string for planning agents regardless of config', async () => {
    const result = await buildCavemanExports('/workspace', { ...baseConfig, enabled: true }, true);
    expect(result).toBe('');
    (await Effect.runPromise(expect(mockReadVariant))).not.toHaveBeenCalled();
  });

  it('returns empty string when config.enabled is false', async () => {
    const result = await buildCavemanExports('/workspace', { ...baseConfig, enabled: false }, false);
    expect(result).toBe('');
    (await Effect.runPromise(expect(mockReadVariant))).not.toHaveBeenCalled();
  });

  it('returns empty string when variant is "off"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('off')));
    const result = await buildCavemanExports('/workspace', baseConfig, false);
    expect(result).toBe('');
  });

  it('returns only PANOPTICON_CAVEMAN_VARIANT when variant is "disabled"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('disabled')));
    const result = await buildCavemanExports('/workspace', baseConfig, false);
    expect(result).toBe('export PANOPTICON_CAVEMAN_VARIANT="disabled"\n');
    expect(result).not.toContain('CAVEMAN_DEFAULT_MODE');
  });

  it('returns both CAVEMAN_DEFAULT_MODE and PANOPTICON_CAVEMAN_VARIANT when variant is "enabled"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('enabled')));
    const result = await buildCavemanExports('/workspace', baseConfig, false);
    expect(result).toContain('export CAVEMAN_DEFAULT_MODE="full"');
    expect(result).toContain('export PANOPTICON_CAVEMAN_VARIANT="enabled"');
  });

  it('returns empty string when variant is "enabled" but work mode is "off"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('enabled')));
    const result = await buildCavemanExports('/workspace', { ...baseConfig, modes: { ...baseConfig.modes, work: 'off' as const } }, false);
    expect(result).toBe('');
  });

  it('returns empty string when variant is "enabled" but work mode is "disabled"', async () => {
    (await Effect.runPromise(mockReadVariant.mockResolvedValue('enabled')));
    const result = await buildCavemanExports('/workspace', { ...baseConfig, modes: { ...baseConfig.modes, work: 'disabled' as const } }, false);
    expect(result).toBe('');
  });

  it('calls readCavemanVariant with the workspace path', async () => {
    await buildCavemanExports('/my/workspace', baseConfig, false);
    (await Effect.runPromise(expect(mockReadVariant))).toHaveBeenCalledWith('/my/workspace');
  });
});
