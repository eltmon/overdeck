import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_CLOISTER_CONFIG } from '../config.js';
import { CloseOutSettingsError, readCloseOutSettings, writeCloseOutSetting } from '../close-out-settings.js';

describe('close-out-settings', () => {
  let dir: string;
  let configFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'close-out-settings-test-'));
    configFile = join(dir, 'cloister.toml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readCloseOutSettings', () => {
    it('returns all four keys as default when the file is missing', async () => {
      const view = await readCloseOutSettings(configFile);
      expect(view).toEqual({
        remove_workspace: { value: DEFAULT_CLOISTER_CONFIG.close_out.remove_workspace, source: 'default' },
        delete_feature_branch: { value: DEFAULT_CLOISTER_CONFIG.close_out.delete_feature_branch, source: 'default' },
        auto: { value: DEFAULT_CLOISTER_CONFIG.close_out.auto, source: 'default', inert: true },
        auto_delay_minutes: {
          value: DEFAULT_CLOISTER_CONFIG.close_out.auto_delay_minutes,
          source: 'default',
          inert: true,
        },
      });
    });

    it('marks only the keys present in the file as cloister.toml-sourced', async () => {
      await writeFile(configFile, '[close_out]\nremove_workspace = false\n', 'utf-8');
      const view = await readCloseOutSettings(configFile);
      expect(view.remove_workspace).toEqual({ value: false, source: 'cloister.toml' });
      expect(view.delete_feature_branch.source).toBe('default');
      expect(view.auto.source).toBe('default');
      expect(view.auto_delay_minutes.source).toBe('default');
    });
  });

  describe('writeCloseOutSetting', () => {
    it('sets only the given key, preserves other tables, and materializes no defaults', async () => {
      await writeFile(configFile, '[concurrency]\nmax_work_agents = 14\n', 'utf-8');

      await writeCloseOutSetting('delete_feature_branch', true, configFile);

      const raw = (await import('@iarna/toml')).parse(await readFile(configFile, 'utf-8')) as any;
      expect(raw.concurrency.max_work_agents).toBe(14);
      expect(raw.close_out.delete_feature_branch).toBe(true);
      expect(Object.hasOwn(raw.close_out, 'remove_workspace')).toBe(false);
      expect(raw.startup).toBeUndefined();
    });

    it('rejects the inert auto key with 400', async () => {
      await expect(writeCloseOutSetting('auto', true, configFile)).rejects.toMatchObject({
        status: 400,
      });
      await expect(writeCloseOutSetting('auto', true, configFile)).rejects.toBeInstanceOf(CloseOutSettingsError);
    });

    it('rejects a non-boolean value with 400', async () => {
      await expect(writeCloseOutSetting('remove_workspace', 'yes', configFile)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rejects an unparseable file with 409 and leaves the file bytes unchanged', async () => {
      const badContent = 'not = [valid toml\n';
      await writeFile(configFile, badContent, 'utf-8');

      await expect(writeCloseOutSetting('remove_workspace', true, configFile)).rejects.toMatchObject({
        status: 409,
      });

      expect(await readFile(configFile, 'utf-8')).toBe(badContent);
    });
  });
});
