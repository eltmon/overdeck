import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ComputerUseConfigSyntaxError,
  ComputerUseSettingsValidationError,
  readComputerUseSettings,
  saveComputerUseSettings,
} from '../settings.js';

describe('computer-use settings door (PAN-5461 WI-3a)', () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pan-5461-settings-'));
    configPath = join(dir, 'config.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads off when config.yaml is missing', async () => {
    expect(await readComputerUseSettings({ configPath })).toEqual({ enabled: false });
  });

  it('reads enabled only when computer_use.enabled is true', async () => {
    await writeFile(configPath, 'computer_use:\n  enabled: true\n');
    expect(await readComputerUseSettings({ configPath })).toEqual({ enabled: true });
    await writeFile(configPath, 'computer_use:\n  enabled: "yes"\n');
    expect(await readComputerUseSettings({ configPath })).toEqual({ enabled: false });
  });

  it('preserves comments and unrelated keys', async () => {
    await writeFile(
      configPath,
      ['# keep me', 'jev:', '  model: jev-1.13-free', 'computer_use:', '  # flag comment', '  enabled: false', ''].join('\n'),
    );

    expect(await saveComputerUseSettings({ enabled: true }, { configPath })).toEqual({ enabled: true });

    const text = await readFile(configPath, 'utf8');
    expect(text).toContain('# keep me');
    expect(text).toContain('model: jev-1.13-free');
    expect(text).toContain('# flag comment');
    expect(text).toContain('enabled: true');
    expect(await readComputerUseSettings({ configPath })).toEqual({ enabled: true });
  });

  it('creates the computer_use block when it is missing', async () => {
    await writeFile(configPath, 'jev:\n  model: x\n');
    await saveComputerUseSettings({ enabled: true }, { configPath });
    const text = await readFile(configPath, 'utf8');
    expect(text).toContain('jev:');
    expect(text).toMatch(/computer_use:\n\s+enabled: true/);
  });

  it('creates config.yaml when it does not exist', async () => {
    await saveComputerUseSettings({ enabled: false }, { configPath });
    expect(await readComputerUseSettings({ configPath })).toEqual({ enabled: false });
    expect(existsSync(configPath)).toBe(true);
  });

  it.each([[{ enabled: 'yes' }], [{ enabled: true, other: 1 }], [{}], [null], [[true]], ['enabled']])(
    'rejects %j without writing',
    (input) => {
      expect(() => saveComputerUseSettings(input, { configPath })).toThrow(ComputerUseSettingsValidationError);
      expect(existsSync(configPath)).toBe(false);
    },
  );

  it('rejects a YAML syntax error with ComputerUseConfigSyntaxError without writing', async () => {
    const broken = 'computer_use:\n  enabled: [true\n';
    await writeFile(configPath, broken);
    await expect(saveComputerUseSettings({ enabled: true }, { configPath })).rejects.toBeInstanceOf(ComputerUseConfigSyntaxError);
    await expect(readComputerUseSettings({ configPath })).rejects.toBeInstanceOf(ComputerUseConfigSyntaxError);
    expect(await readFile(configPath, 'utf8')).toBe(broken);
  });
});
