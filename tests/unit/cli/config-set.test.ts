/** PAN-4651 WI-26 (D-4651-21): `pan admin config set <key> <value>`. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configSetCommand, type ConfigSetDeps, defaultConfigSetDeps } from '../../../src/cli/commands/config-set.js';
import { clearConfigCache } from '../../../src/lib/config-yaml/load.js';

const originalHome = process.env.OVERDECK_HOME;
let home: string;
let out: string[];
let err: string[];

function deps(overrides: Partial<ConfigSetDeps> = {}): ConfigSetDeps {
  return { ...defaultConfigSetDeps(), path: () => join(home, 'config.yaml'), stdout: (t) => { out.push(t); }, stderr: (t) => { err.push(t); }, ...overrides };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4651-config-set-'));
  process.env.OVERDECK_HOME = home;
  clearConfigCache();
  out = [];
  err = [];
});

afterEach(() => {
  clearConfigCache();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('pan admin config set (D-4651-21)', () => {
  it('ac26: writes the number 3 and keeps the comment', async () => {
    writeFileSync(join(home, 'config.yaml'), '# my machine\nresources:\n  quality_gate_slots: 2 # two is plenty\n');
    expect(await configSetCommand('resources.quality_gate_slots', '3', deps())).toBe(0);
    const text = readFileSync(join(home, 'config.yaml'), 'utf8');
    expect(text).toContain('# my machine');
    expect(text).toMatch(/quality_gate_slots: 3/);
    expect(out).toEqual([`Set resources.quality_gate_slots = 3 in ${join(home, 'config.yaml')}`]);
  });

  it('parses booleans and lists, and creates a missing file', async () => {
    expect(await configSetCommand('agents.rtk.enabled', 'false', deps())).toBe(0);
    expect(await configSetCommand('anywhere.machine.tags', '[gpu, big-disk]', deps())).toBe(0);
    const text = readFileSync(join(home, 'config.yaml'), 'utf8');
    expect(text).toMatch(/enabled: false/);
    expect(text).toMatch(/tags:\s*\n\s*- gpu\n\s*- big-disk|tags: \[ gpu, big-disk \]/);
  });

  it('ac26: a key with a capital letter exits 1 and writes nothing', async () => {
    expect(await configSetCommand('resources.qualityGateSlots', '3', deps())).toBe(1);
    expect(err[0]).toContain('dotted snake_case');
  });

  it('PAN-4905 ac9: remote.enabled refuses, names config.toml, and writes nothing', async () => {
    expect(await configSetCommand('remote.enabled', 'true', deps())).toBe(1);
    expect(err[0]).toContain('config.toml');
    expect(() => readFileSync(join(home, 'config.yaml'), 'utf8')).toThrow();
  });

  it('ac26: a value that makes the config fail to load restores the previous text', async () => {
    const before = '# keep me\nresources:\n  quality_gate_slots: 2\n';
    writeFileSync(join(home, 'config.yaml'), before);
    const code = await configSetCommand('resources.quality_gate_slots', 'not-a-number', deps({ validate: async () => { throw new Error('quality_gate_slots must be a number'); } }));
    expect(code).toBe(1);
    expect(readFileSync(join(home, 'config.yaml'), 'utf8')).toBe(before);
    expect(err[0]).toContain('quality_gate_slots must be a number');
  });
});
