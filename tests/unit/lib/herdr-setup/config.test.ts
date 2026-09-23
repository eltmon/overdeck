import { describe, expect, it, vi } from 'vitest';

import {
  ensureHerdrConfig,
  herdrConfigPath,
  setResumeAgentsOnRestore,
} from '../../../../src/lib/herdr-setup/config.js';
import type { HerdrExec } from '../../../../src/lib/herdr-setup/status.js';
import { DEFAULT_CONFIG_SESSION_SECTION } from './fixtures.js';

const DESIRED = 'resume_agents_on_restore = false';

describe('herdrConfigPath (D3)', () => {
  it('is ~/.config/herdr/config.toml, honoring XDG_CONFIG_HOME', () => {
    expect(herdrConfigPath({ homeDir: '/home/op', configHome: '/home/op/.config' }))
      .toBe('/home/op/.config/herdr/config.toml');
    expect(herdrConfigPath({ homeDir: '/home/op', configHome: '/xdg' })).toBe('/xdg/herdr/config.toml');
  });
});

describe('setResumeAgentsOnRestore — the six rules (PAN-3956 W6)', () => {
  it('rule 1: empty text becomes a [session] section', () => {
    expect(setResumeAgentsOnRestore('')).toBe(`[session]\n${DESIRED}\n`);
  });

  it('rule 2: no [session] header appends one after a blank line (the host file)', () => {
    expect(setResumeAgentsOnRestore('onboarding = false\n')).toBe(`onboarding = false\n\n[session]\n${DESIRED}\n`);
    expect(setResumeAgentsOnRestore('onboarding = false')).toBe(`onboarding = false\n\n[session]\n${DESIRED}\n`);
  });

  it('rule 3: uncomments the commented default in the [session] section', () => {
    const input = `onboarding = false\n\n${DEFAULT_CONFIG_SESSION_SECTION}\n\n[ui]\ntheme = "x"\n`;
    const output = setResumeAgentsOnRestore(input);
    expect(output).toBe(input.replace('# resume_agents_on_restore = true', DESIRED));
  });

  it('rule 3: replaces a live `true`, preferring it over a commented line', () => {
    const input = '[session]\n# resume_agents_on_restore = true\nresume_agents_on_restore = true\n';
    expect(setResumeAgentsOnRestore(input)).toBe(`[session]\n# resume_agents_on_restore = true\n${DESIRED}\n`);
  });

  it('rule 4: inserts the key right after the header when the section lacks it', () => {
    const input = '[session]\nother = 1\n\n[ui]\nresume_agents_on_restore = true\n';
    expect(setResumeAgentsOnRestore(input))
      .toBe(`[session]\n${DESIRED}\nother = 1\n\n[ui]\nresume_agents_on_restore = true\n`);
  });

  it('rule 5: is idempotent when the key is already false', () => {
    const input = '# mine\n[session]\nresume_agents_on_restore = false # keep\n';
    expect(setResumeAgentsOnRestore(input)).toBe(input);
    const once = setResumeAgentsOnRestore('onboarding = false\n');
    expect(setResumeAgentsOnRestore(once)).toBe(once);
  });

  it('rule 6: every other line is byte-identical', () => {
    const input = '# top comment\nonboarding = false\n\n[keys]\nprefix = "C-b"  # user\n\n[session]\n# note\n';
    const output = setResumeAgentsOnRestore(input);
    expect(output.split('\n').filter((line) => line !== DESIRED)).toEqual(input.split('\n'));
  });
});

function memoryFs(initial: string | null) {
  const files = new Map<string, string>();
  const path = '/home/op/.config/herdr/config.toml';
  if (initial !== null) files.set(path, initial);
  return {
    path,
    files,
    readFile: vi.fn(async (p: string) => {
      const text = files.get(p);
      if (text === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return text;
    }),
    writeFile: vi.fn(async (p: string, text: string) => { files.set(p, text); }),
    rename: vi.fn(async (from: string, to: string) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    }),
    unlink: vi.fn(async (p: string) => { files.delete(p); }),
    mkdir: vi.fn(async () => {}),
  };
}

describe('ensureHerdrConfig', () => {
  const ok: HerdrExec = async () => ({ stdout: '', stderr: '', exitCode: 0 });

  it('writes nothing and runs nothing when the key is already false', async () => {
    const fs = memoryFs(`[session]\n${DESIRED}\n`);
    const exec = vi.fn(ok);
    const result = await ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: true });
    expect(result).toEqual({ changed: false, path: fs.path });
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('writes through a tmp file, checks, and reloads a running server', async () => {
    const fs = memoryFs('onboarding = false\n');
    const exec = vi.fn(ok);
    const result = await ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: true });
    expect(result.changed).toBe(true);
    expect(fs.files.get(fs.path)).toBe(`onboarding = false\n\n[session]\n${DESIRED}\n`);
    expect(fs.writeFile).toHaveBeenCalledWith(`${fs.path}.tmp`, expect.any(String));
    expect(exec.mock.calls.map((call) => call[1])).toEqual([
      ['config', 'check'],
      ['--session', 'overdeck', 'server', 'reload-config'],
    ]);
  });

  it('does not reload when no server is running', async () => {
    const fs = memoryFs(null);
    const exec = vi.fn(ok);
    await ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: false });
    expect(fs.files.get(fs.path)).toBe(`[session]\n${DESIRED}\n`);
    expect(exec.mock.calls.map((call) => call[1])).toEqual([['config', 'check']]);
  });

  it('restores the previous text and throws when `herdr config check` rejects it', async () => {
    const previous = 'onboarding = false\n';
    const fs = memoryFs(previous);
    const exec = vi.fn<HerdrExec>(async () => ({ stdout: '', stderr: 'unknown key', exitCode: 1 }));
    await expect(ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: true }))
      .rejects.toThrow(/herdr config check rejected .*unknown key/);
    expect(fs.files.get(fs.path)).toBe(previous);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('removes a file it created when the check rejects it', async () => {
    const fs = memoryFs(null);
    const exec: HerdrExec = async () => ({ stdout: '', stderr: 'bad', exitCode: 2 });
    await expect(ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: false }))
      .rejects.toThrow(/config check rejected/);
    expect(fs.files.has(fs.path)).toBe(false);
  });
});
