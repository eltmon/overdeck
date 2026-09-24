import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { HerdrConfigEditError, ensureHerdrConfig, herdrConfigDisablesResume, herdrConfigPath, lineLevelResumeDisabled, planResumeAgentsOnRestore } from '../../../../src/lib/herdr-setup/config.js';
import type { HerdrExec } from '../../../../src/lib/herdr-setup/status.js';
import { DEFAULT_CONFIG_SESSION_SECTION } from './fixtures.js';

// Moved here from src/lib/herdr-setup/config.ts, which no production code called (PAN-3958 CH-8).
/**
 * Pure: the text with `[session] resume_agents_on_restore = false`, touching
 * nothing else. Returns the input unchanged when it already says so. Throws
 * `HerdrConfigEditError` when no safe edit exists.
 */
function setResumeAgentsOnRestore(text: string): string {
  const plan = planResumeAgentsOnRestore(text);
  if (plan.kind === 'unchanged') return text;
  if (plan.kind === 'edited') return plan.text;
  throw new HerdrConfigEditError('config.toml', plan.reason, plan.hint);
}

const DESIRED = 'resume_agents_on_restore = false';

describe('herdrConfigPath (D3)', () => {
  it('is ~/.config/herdr/config.toml, honoring XDG_CONFIG_HOME', () => {
    expect(herdrConfigPath({ homeDir: '/home/op', configHome: '/home/op/.config', env: {} }))
      .toBe('/home/op/.config/herdr/config.toml');
    expect(herdrConfigPath({ homeDir: '/home/op', configHome: '/xdg', env: {} })).toBe('/xdg/herdr/config.toml');
    expect(herdrConfigPath({ homeDir: '/home/op', env: { XDG_CONFIG_HOME: '/xdg2' } })).toBe('/xdg2/herdr/config.toml');
    expect(herdrConfigPath({ homeDir: '/home/op', env: {} })).toBe('/home/op/.config/herdr/config.toml');
  });

  it('honors HERDR_CONFIG_PATH first, the way herdr does (review finding 3)', () => {
    expect(herdrConfigPath({
      homeDir: '/home/op',
      configHome: '/xdg',
      env: { HERDR_CONFIG_PATH: '/etc/herdr/mine.toml', XDG_CONFIG_HOME: '/xdg' },
    })).toBe('/etc/herdr/mine.toml');
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

describe('planResumeAgentsOnRestore — real TOML shapes (review findings 4 and 11)', () => {
  function edited(text: string): string {
    const plan = planResumeAgentsOnRestore(text);
    if (plan.kind !== 'edited') throw new Error(`expected an edit, got ${JSON.stringify(plan)}`);
    return plan.text;
  }

  it('rewrites a root dotted key in place', () => {
    expect(edited('onboarding = false\nsession.resume_agents_on_restore = true\n[ui]\nx = 1\n'))
      .toBe('onboarding = false\nsession.resume_agents_on_restore = false\n[ui]\nx = 1\n');
  });

  it('adds a dotted key beside other root `session.` keys instead of a clashing [session] table', () => {
    expect(edited('session.foo = 1\n[ui]\nx = 1\n'))
      .toBe('session.foo = 1\nsession.resume_agents_on_restore = false\n[ui]\nx = 1\n');
  });

  it('reads a spaced header and keeps the end-of-line comment on the key line', () => {
    expect(edited('[ session ]\nresume_agents_on_restore = true # my note\n'))
      .toBe('[ session ]\nresume_agents_on_restore = false # my note\n');
  });

  it('rewrites a quoted key and inserts under a quoted header', () => {
    expect(edited('[session]\n"resume_agents_on_restore" = true\n')).toBe('[session]\n"resume_agents_on_restore" = false\n');
    expect(edited('["session"]\nfoo = 1\n')).toBe(`["session"]\n${DESIRED}\nfoo = 1\n`);
  });

  it('never mistakes a multi-line array element or a multi-line string line for a header', () => {
    const array = '[session]\nfoo = [\n  ["a"],\n  ["b"],\n]\nbar = 2\n[ui]\nx = 1\n';
    expect(edited(array)).toBe(`[session]\n${DESIRED}\nfoo = [\n  ["a"],\n  ["b"],\n]\nbar = 2\n[ui]\nx = 1\n`);
    const string = '[session]\ndoc = """\n[fake]\nresume_agents_on_restore = true\n"""\n';
    expect(edited(string)).toBe(`[session]\n${DESIRED}\ndoc = """\n[fake]\nresume_agents_on_restore = true\n"""\n`);
  });

  it('leaves a prose comment that starts with the key name alone', () => {
    const input = '[session]\n# resume_agents_on_restore = true restarts agents; see docs\n';
    expect(edited(input)).toBe(`[session]\n${DESIRED}\n# resume_agents_on_restore = true restarts agents; see docs\n`);
  });

  it('keeps CRLF line endings on inserted lines', () => {
    expect(edited('onboarding = false\r\n[session]\r\nfoo = 1\r\n'))
      .toBe(`onboarding = false\r\n[session]\r\n${DESIRED}\r\nfoo = 1\r\n`);
  });

  it('is unchanged when any TOML shape already says false', () => {
    for (const text of [
      'session.resume_agents_on_restore = false\n',
      'session = { resume_agents_on_restore = false }\n',
      '[ session ]\n\'resume_agents_on_restore\' = false\n',
    ]) {
      expect(planResumeAgentsOnRestore(text)).toEqual({ kind: 'unchanged' });
    }
  });

  it('refuses an inline table with the exact hand fix', () => {
    expect(planResumeAgentsOnRestore('session = { resume_agents_on_restore = true, foo = 1 }\n')).toEqual({
      kind: 'refused',
      reason: '`session` is an inline table (`session = { … }`), which Overdeck does not rewrite',
      hint: 'set `resume_agents_on_restore = false` inside the `session = { … }` inline table',
    });
  });

  it('refuses a file its parser cannot read without calling it broken (herdr config check decides)', () => {
    const plan = planResumeAgentsOnRestore('[session\nfoo = 1\n');
    expect(plan.kind).toBe('refused');
    if (plan.kind !== 'refused') return;
    expect(plan.reason).toMatch(/^Overdeck's TOML parser cannot read it \(.+\), so Overdeck will not edit it$/);
    expect(plan.parseError).toBeTruthy();
    expect(plan.hint).toBe(`add \`${DESIRED}\` under \`[session]\``);
  });

  it('reads TOML 1.0 the way herdr does: mixed-type arrays and a leading BOM (review of #4020, 3)', () => {
    expect(edited('x = [1, "a"]\n[session]\nresume_agents_on_restore = true\n'))
      .toBe(`x = [1, "a"]\n[session]\n${DESIRED}\n`);
    expect(edited('\uFEFFonboarding = false\n')).toBe(`\uFEFFonboarding = false\n\n[session]\n${DESIRED}\n`);
    expect(planResumeAgentsOnRestore('\uFEFF[session]\nresume_agents_on_restore = false\n')).toEqual({ kind: 'unchanged' });
  });

  it('never throws on an integer beyond 2^53 (review of #4020, 6)', () => {
    expect(() => planResumeAgentsOnRestore('x = 9007199254740993\n')).not.toThrow();
    expect(edited('x = 9007199254740993\n')).toBe(`x = 9007199254740993\n\n[session]\n${DESIRED}\n`);
  });

  it('lineLevelResumeDisabled accepts only one live `false` key line for session', () => {
    expect(lineLevelResumeDisabled('[session]\nresume_agents_on_restore = false # mine\n')).toBe(true);
    expect(lineLevelResumeDisabled('session.resume_agents_on_restore = false\n')).toBe(true);
    expect(lineLevelResumeDisabled('[session]\nresume_agents_on_restore = true\n')).toBe(false);
    expect(lineLevelResumeDisabled('[ui]\nresume_agents_on_restore = false\n')).toBe(false);
    expect(lineLevelResumeDisabled('session = { resume_agents_on_restore = false }\n')).toBe(false);
    expect(lineLevelResumeDisabled('[session]\nresume_agents_on_restore = false\nresume_agents_on_restore = true\n'))
      .toBe(false);
  });

  it('setResumeAgentsOnRestore throws HerdrConfigEditError instead of returning an unsafe edit', () => {
    expect(() => setResumeAgentsOnRestore('session = { foo = 1 }\n')).toThrow(HerdrConfigEditError);
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
    realpath: vi.fn(async (p: string) => p),
    fileMode: vi.fn(async () => null),
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
    expect(fs.writeFile).toHaveBeenCalledWith(`${fs.path}.${process.pid}.tmp`, expect.any(String));
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

  it('writes nothing and throws the hand fix when no safe edit exists', async () => {
    const fs = memoryFs('session = { foo = 1 }\n');
    const exec = vi.fn(ok);
    await expect(ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: false }))
      .rejects.toThrow(/Cannot safely edit .*config\.toml: `session` is an inline table.*then run `pan sync`/);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('says "fix the syntax" only when herdr config check rejects the file too', async () => {
    const fs = memoryFs('[session\n');
    const rejects = vi.fn<HerdrExec>(async () => ({ stdout: '', stderr: 'expected `]`', exitCode: 1 }));
    await expect(ensureHerdrConfig({ ...fs, exec: rejects, binary: '/b/herdr', session: 'overdeck', serverRunning: false }))
      .rejects.toThrow(/herdr config check rejects it too \(expected `\]`\).*By hand: fix the syntax, then add/);

    const accepts = vi.fn(ok);
    await expect(ensureHerdrConfig({ ...fs, exec: accepts, binary: '/b/herdr', session: 'overdeck', serverRunning: false }))
      .rejects.toThrow(/herdr accepts it, but Overdeck's TOML parser cannot read it .*By hand: add `resume_agents_on_restore/);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('reports a reload that exits non-zero, with the file still written (review finding 2)', async () => {
    const fs = memoryFs('onboarding = false\n');
    const exec = vi.fn<HerdrExec>(async (_file, args) => (
      args.includes('reload-config')
        ? { stdout: '', stderr: 'no server is running', exitCode: 1 }
        : { stdout: '', stderr: '', exitCode: 0 }
    ));
    const result = await ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: true });
    expect(result.changed).toBe(true);
    expect(result.reloadWarning).toMatch(/server reload-config` failed \(no server is running\)/);
    expect(result.reloadWarning).toContain('keeps its old setting until its next restart');
    expect(fs.files.get(fs.path)).toContain(DESIRED);
  });

  it('reports a reload that times out instead of calling the config "not updated"', async () => {
    const fs = memoryFs('onboarding = false\n');
    const exec = vi.fn<HerdrExec>(async (_file, args) => {
      if (args.includes('reload-config')) throw new Error('Command timed out after 10000ms');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await ensureHerdrConfig({ ...fs, exec, binary: '/b/herdr', session: 'overdeck', serverRunning: true });
    expect(result.changed).toBe(true);
    expect(result.reloadWarning).toContain('Command timed out after 10000ms');
  });
});

describe('ensureHerdrConfig on a real filesystem (review finding 11)', () => {
  const ok: HerdrExec = async () => ({ stdout: '', stderr: '', exitCode: 0 });

  it('edits a symlink\'s target, keeps the link and the file mode, and leaves no tmp file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'herdr-config-'));
    try {
      const target = join(dir, 'dotfiles-config.toml');
      const link = join(dir, 'config.toml');
      writeFileSync(target, 'onboarding = false\n');
      chmodSync(target, 0o600);
      symlinkSync(target, link);

      const result = await ensureHerdrConfig({ exec: ok, binary: '/b/herdr', session: 'overdeck', serverRunning: false, path: link });

      expect(result).toEqual({ changed: true, path: link });
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, 'utf-8')).toBe(`onboarding = false\n\n[session]\n${DESIRED}\n`);
      expect(statSync(target).mode & 0o777).toBe(0o600);
      await expect(herdrConfigDisablesResume(link)).resolves.toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('herdrConfigDisablesResume trusts a line-level false only when herdr accepts the file', async () => {
    const text = '[session\nresume_agents_on_restore = false\n';
    const read = async () => '[session]\nweird = @\nresume_agents_on_restore = false\n';
    await expect(herdrConfigDisablesResume('/x', read)).resolves.toBe(false);
    await expect(herdrConfigDisablesResume('/x', read, async () => true)).resolves.toBe(true);
    await expect(herdrConfigDisablesResume('/x', read, async () => false)).resolves.toBe(false);
    await expect(herdrConfigDisablesResume('/x', async () => text, async () => true)).resolves.toBe(false);
  });

  it('herdrConfigDisablesResume is false for a missing, unparseable or resume-on file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'herdr-config-'));
    try {
      const path = join(dir, 'config.toml');
      await expect(herdrConfigDisablesResume(path)).resolves.toBe(false);
      writeFileSync(path, '[session\n');
      await expect(herdrConfigDisablesResume(path)).resolves.toBe(false);
      writeFileSync(path, '[session]\nresume_agents_on_restore = true\n');
      await expect(herdrConfigDisablesResume(path)).resolves.toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
