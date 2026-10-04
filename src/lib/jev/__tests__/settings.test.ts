import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({ loadConfigSync: vi.fn(), clearConfigCache: vi.fn() }));
vi.mock('../../config-yaml/load.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml/load.js')>();
  return { ...actual, loadConfigSync: configMock.loadConfigSync, clearConfigCache: configMock.clearConfigCache };
});

const memoMock = vi.hoisted(() => ({ resetJevMemo: vi.fn() }));
vi.mock('../memo.js', () => ({ resetJevMemo: memoMock.resetJevMemo }));

import { defaultBackgroundAiFeatures } from '../../background-ai/registry.js';
import { DEFAULT_JEV_API_KEY_REF } from '../../config-yaml/jev.js';
import { JevSettingsValidationError, readJevSettings, saveJevSettings } from '../settings.js';

function featuresConfig(overrides: Partial<ReturnType<typeof defaultBackgroundAiFeatures>> = {}) {
  return { config: { backgroundAi: { cheapMode: false, features: { ...defaultBackgroundAiFeatures(), ...overrides } } } };
}

describe('jev settings door (PAN-4508)', () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jev-settings-'));
    configPath = join(dir, 'config.yaml');
    configMock.loadConfigSync.mockReturnValue(featuresConfig());
    configMock.clearConfigCache.mockClear();
    memoMock.resetJevMemo.mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes route direct, model and timeout while preserving api_key_ref, a comment, and an unrelated key', async () => {
    await writeFile(
      configPath,
      [
        'jev:',
        '  base_url: https://opencode.ai/zen',
        '  api_key_ref: MY_KEY',
        '  # keep this comment',
        '  model: old-model',
        'unrelated_key: 1',
        '',
      ].join('\n'),
    );

    const view = await saveJevSettings({ route: 'direct', model: 'jev-1.13.0', timeoutMs: 1500 }, { configPath });

    expect(view).toEqual({
      configured: true,
      route: 'direct',
      model: 'jev-1.13.0',
      timeoutMs: 1500,
      apiKeyRef: 'MY_KEY',
    });
    const text = await readFile(configPath, 'utf8');
    expect(text).not.toContain('base_url');
    expect(text).toContain('api_key_ref: MY_KEY');
    expect(text).toContain('# keep this comment');
    expect(text).toContain('unrelated_key: 1');
    expect(text).toContain('model: jev-1.13.0');
    expect(text).toContain('timeout_ms: 1500');
  });

  it('creates the jev block when none exists and is readable back', async () => {
    const view = await saveJevSettings({ route: 'zen', model: 'jev-1.13-free', timeoutMs: 2000 }, { configPath });
    expect(view).toEqual({
      configured: true,
      route: 'zen',
      baseUrl: 'https://opencode.ai/zen',
      model: 'jev-1.13-free',
      timeoutMs: 2000,
      apiKeyRef: DEFAULT_JEV_API_KEY_REF,
    });

    const reread = await readJevSettings({ configPath });
    expect(reread).toEqual({
      configured: true,
      route: 'zen',
      baseUrl: 'https://opencode.ai/zen',
      model: 'jev-1.13-free',
      timeoutMs: 2000,
      apiKeyRef: DEFAULT_JEV_API_KEY_REF,
    });
  });

  it('rejects an invalid timeoutMs and leaves the file untouched', async () => {
    const original = 'jev:\n  model: m\n  timeout_ms: 2000\n';
    await writeFile(configPath, original);

    await expect(saveJevSettings({ route: 'direct', model: 'm', timeoutMs: 0 }, { configPath })).rejects.toBeInstanceOf(
      JevSettingsValidationError,
    );

    const text = await readFile(configPath, 'utf8');
    expect(text).toBe(original);
  });

  it('is immediately readable after save and resets the memo exactly once', async () => {
    await saveJevSettings({ route: 'direct', model: 'jev-1.13-free', timeoutMs: 3000 }, { configPath });

    const reread = await readJevSettings({ configPath });
    expect(reread.model).toBe('jev-1.13-free');
    expect(reread.timeoutMs).toBe(3000);
    expect(memoMock.resetJevMemo).toHaveBeenCalledTimes(1);
    expect(configMock.clearConfigCache).toHaveBeenCalled();
  });
});
