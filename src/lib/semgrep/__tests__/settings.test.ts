import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NORMALIZED_SECURITY } from '../../config-yaml/semgrep.js';
import { SEMGREP_VERSION } from '../install.js';
import { readSemgrepSettings, saveSemgrepSettings, SemgrepSettingsValidationError } from '../settings.js';

describe('semgrep settings door (PAN-4594)', () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'semgrep-settings-'));
    configPath = join(dir, 'config.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads defaults when config.yaml has no security block', async () => {
    const view = await readSemgrepSettings({ configPath });
    expect(view).toEqual({ ...DEFAULT_NORMALIZED_SECURITY.semgrep, pinnedVersion: SEMGREP_VERSION });
  });

  it('preserves comments and unrelated keys', async () => {
    await writeFile(
      configPath,
      ['# keep me', 'jev:', '  model: jev-1.13-free', 'security:', '  semgrep:', '    mcp: true', ''].join('\n'),
    );

    await saveSemgrepSettings({ gate: 'blocking' }, { configPath });

    const text = await readFile(configPath, 'utf8');
    expect(text).toContain('# keep me');
    expect(text).toContain('jev:');
    expect(text).toContain('model: jev-1.13-free');
    expect(text).toContain('mcp: true');
    expect(text).toContain('gate: blocking');
  });

  it('rejects an invalid value without writing', async () => {
    await writeFile(configPath, 'security:\n  semgrep:\n    gate: advisory\n');
    const original = await readFile(configPath, 'utf8');

    const error = await saveSemgrepSettings({ gate: 'strict' }, { configPath }).catch((e) => e);
    expect(error).toBeInstanceOf(SemgrepSettingsValidationError);
    expect((error as Error).message).toContain('security.semgrep.gate');

    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it('rejects unknown keys and empty configs', async () => {
    await writeFile(configPath, 'security:\n  semgrep:\n    gate: advisory\n');
    const original = await readFile(configPath, 'utf8');

    expect(() => saveSemgrepSettings({ foo: 1 }, { configPath })).toThrow(SemgrepSettingsValidationError);
    await expect(saveSemgrepSettings({ configs: [] }, { configPath })).rejects.toBeInstanceOf(SemgrepSettingsValidationError);

    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it('replaces a null security node', async () => {
    await writeFile(configPath, 'security:\n');

    await saveSemgrepSettings({ enabled: true }, { configPath });

    const view = await readSemgrepSettings({ configPath });
    expect(view.enabled).toBe(true);
  });

  it('refuses to write a file with a YAML syntax error', async () => {
    await writeFile(configPath, 'jev: [unclosed\n');
    const original = await readFile(configPath, 'utf8');

    await expect(saveSemgrepSettings({ enabled: true }, { configPath })).rejects.toBeInstanceOf(SemgrepSettingsValidationError);
    await expect(readSemgrepSettings({ configPath })).rejects.toBeInstanceOf(SemgrepSettingsValidationError);

    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it('writes configs as a YAML sequence', async () => {
    await saveSemgrepSettings({ configs: [' p/default ', 'rules/x.yml'] }, { configPath });

    const view = await readSemgrepSettings({ configPath });
    expect(view.configs).toEqual(['p/default', 'rules/x.yml']);
  });

  it('rejects a config that only becomes a leading dash after trimming', async () => {
    await writeFile(configPath, 'security:\n  semgrep:\n    gate: advisory\n');
    const original = await readFile(configPath, 'utf8');

    await expect(saveSemgrepSettings({ configs: [' -bad'] }, { configPath })).rejects.toBeInstanceOf(SemgrepSettingsValidationError);

    expect(await readFile(configPath, 'utf8')).toBe(original);
  });
});
