import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SEMGREP_VERSION,
  SEMGREP_QUIET_ENV,
  ensureSemgrepInstalled,
  readSemgrepVersion,
  managedSemgrepPath,
  semgrepToolsDir,
  formatSemgrepInstallOutcome,
  type SemgrepInstallDeps,
} from '../install.js';

type Call = { file: string; args: string[]; opts: { env: NodeJS.ProcessEnv; timeout: number } };

/** Scripted execFile fake: throws for any call the test did not script, so no test can reach a real process. */
function scriptedExecFile(
  script: Record<string, (() => Promise<{ stdout: string; stderr: string }>) | undefined>,
  calls: Call[],
) {
  return async (file: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeout: number }) => {
    calls.push({ file, args, opts });
    const key = `${file} ${args.join(' ')}`;
    const handler = script[key];
    if (!handler) throw new Error(`unexpected exec: ${file} ${args.join(' ')}`);
    return handler();
  };
}

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'semgrep-install-test-'));
  await mkdir(join(home, 'bin'), { recursive: true });
  return home;
}

describe('semgrep install module (PAN-4585)', () => {
  it('reports present when the managed binary already matches the pinned version, with no installer call', async () => {
    const home = await makeHome();
    const calls: Call[] = [];
    const deps: SemgrepInstallDeps = {
      home,
      execFile: scriptedExecFile(
        { [`${managedSemgrepPath(home)} --version`]: async () => ({ stdout: `${SEMGREP_VERSION}\n`, stderr: '' }) },
        calls,
      ),
    };
    const outcome = await ensureSemgrepInstalled(deps);
    expect(outcome.status).toBe('present');
    expect(outcome.version).toBe(SEMGREP_VERSION);
    expect(calls.some((c) => c.file === 'uv' || c.file === 'pipx')).toBe(false);
  });

  it('installs via uv when uv is available', async () => {
    const home = await makeHome();
    const tools = semgrepToolsDir(home);
    const binary = managedSemgrepPath(home);
    const calls: Call[] = [];
    let linked: [string, string] | undefined;
    const deps: SemgrepInstallDeps = {
      home,
      execFile: scriptedExecFile(
        {
          [`${binary} --version`]: async () => ({ stdout: '', stderr: '' }),
          'uv --version': async () => ({ stdout: 'uv 0.5.0\n', stderr: '' }),
          [`uv tool install --force semgrep==${SEMGREP_VERSION}`]: async () => ({ stdout: '', stderr: '' }),
        },
        calls,
      ),
      inspectLauncher: async () => 'absent',
      linkLauncher: async (target, linkPath) => {
        linked = [target, linkPath];
      },
    };
    // second version read (after install) must report the pinned version
    let versionReads = 0;
    const baseExec = deps.execFile!;
    deps.execFile = async (file, args, opts) => {
      if (file === binary && args[0] === '--version') {
        versionReads += 1;
        if (versionReads === 1) return { stdout: '', stderr: '' };
        return { stdout: `${SEMGREP_VERSION}\n`, stderr: '' };
      }
      return baseExec(file, args, opts);
    };

    const outcome = await ensureSemgrepInstalled(deps);
    expect(outcome.status).toBe('installed');
    expect(outcome.installer).toBe('uv');
    const installCall = calls.find((c) => c.file === 'uv' && c.args[0] === 'tool');
    expect(installCall?.args).toEqual(['tool', 'install', '--force', `semgrep==${SEMGREP_VERSION}`]);
    expect(installCall?.opts.env.UV_TOOL_DIR).toBe(join(tools, 'uv'));
    expect(installCall?.opts.env.UV_TOOL_BIN_DIR).toBe(join(tools, 'bin'));
    expect(linked).toEqual([join(tools, 'bin', 'semgrep'), binary]);
  });

  it('falls back to pipx when uv is unavailable', async () => {
    const home = await makeHome();
    const tools = semgrepToolsDir(home);
    const binary = managedSemgrepPath(home);
    const calls: Call[] = [];
    let versionReads = 0;
    const deps: SemgrepInstallDeps = {
      home,
      inspectLauncher: async () => 'absent',
      linkLauncher: async () => {},
      execFile: async (file, args, opts) => {
        calls.push({ file, args, opts });
        if (file === binary && args[0] === '--version') {
          versionReads += 1;
          if (versionReads === 1) return { stdout: '', stderr: '' };
          return { stdout: `${SEMGREP_VERSION}\n`, stderr: '' };
        }
        if (file === 'uv' && args[0] === '--version') throw new Error('uv: command not found');
        if (file === 'pipx' && args[0] === '--version') return { stdout: 'pipx 1.0.0\n', stderr: '' };
        if (file === 'pipx' && args[0] === 'install') return { stdout: '', stderr: '' };
        throw new Error(`unexpected exec: ${file} ${args.join(' ')}`);
      },
    };
    const outcome = await ensureSemgrepInstalled(deps);
    expect(outcome.status).toBe('installed');
    expect(outcome.installer).toBe('pipx');
    const installCall = calls.find((c) => c.file === 'pipx' && c.args[0] === 'install');
    expect(installCall?.args).toEqual(['install', '--force', `semgrep==${SEMGREP_VERSION}`]);
    expect(installCall?.opts.env.PIPX_HOME).toBe(join(tools, 'pipx'));
    expect(installCall?.opts.env.PIPX_BIN_DIR).toBe(join(tools, 'bin'));
  });

  it('fails with a fix mentioning uv and pipx when neither installer is present', async () => {
    const home = await makeHome();
    const binary = managedSemgrepPath(home);
    const calls: Call[] = [];
    const deps: SemgrepInstallDeps = {
      home,
      inspectLauncher: async () => 'absent',
      execFile: scriptedExecFile(
        {
          [`${binary} --version`]: async () => ({ stdout: '', stderr: '' }),
          'uv --version': () => Promise.reject(new Error('not found')),
          'pipx --version': () => Promise.reject(new Error('not found')),
        },
        calls,
      ),
    };
    const outcome = await ensureSemgrepInstalled(deps);
    expect(outcome.status).toBe('failed');
    expect(outcome.fix).toMatch(/uv/);
    expect(outcome.fix).toMatch(/pipx/);
  });

  it('fails and names the installer when the install command throws', async () => {
    const home = await makeHome();
    const binary = managedSemgrepPath(home);
    const calls: Call[] = [];
    const deps: SemgrepInstallDeps = {
      home,
      inspectLauncher: async () => 'absent',
      execFile: scriptedExecFile(
        {
          [`${binary} --version`]: async () => ({ stdout: '', stderr: '' }),
          'uv --version': async () => ({ stdout: 'uv 0.5.0\n', stderr: '' }),
          [`uv tool install --force semgrep==${SEMGREP_VERSION}`]: () =>
            Promise.reject(new Error('network error\nmore detail')),
        },
        calls,
      ),
    };
    const outcome = await ensureSemgrepInstalled(deps);
    expect(outcome.status).toBe('failed');
    expect(outcome.installer).toBe('uv');
    expect(outcome.message).toContain('uv install of semgrep==1.180.0 failed');
    expect(outcome.message).toContain('network error');
  });

  it('fails on a post-install version mismatch', async () => {
    const home = await makeHome();
    const binary = managedSemgrepPath(home);
    let versionReads = 0;
    const deps: SemgrepInstallDeps = {
      home,
      inspectLauncher: async () => 'absent',
      linkLauncher: async () => {},
      execFile: async (file, args) => {
        if (file === binary && args[0] === '--version') {
          versionReads += 1;
          if (versionReads === 1) return { stdout: '', stderr: '' };
          return { stdout: '1.181.0\n', stderr: '' };
        }
        if (file === 'uv' && args[0] === '--version') return { stdout: 'uv 0.5.0\n', stderr: '' };
        if (file === 'uv' && args[0] === 'tool') return { stdout: '', stderr: '' };
        throw new Error(`unexpected exec: ${file} ${args.join(' ')}`);
      },
    };
    const outcome = await ensureSemgrepInstalled(deps);
    expect(outcome.status).toBe('failed');
    expect(outcome.version).toBe('1.181.0');
  });

  it('refuses a launcher occupied by a foreign regular file, without touching it', async () => {
    const home = await makeHome();
    const binary = managedSemgrepPath(home);
    await writeFile(binary, '#!/bin/sh\necho fake\n');
    const calls: Call[] = [];
    const outcome = await ensureSemgrepInstalled({
      home,
      execFile: scriptedExecFile({}, calls),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.fix).toContain('Move ~/.overdeck/bin/semgrep');
    expect(calls.some((c) => c.file === 'uv' || c.file === 'pipx')).toBe(false);
    const content = await readFileContent(binary);
    expect(content).toContain('echo fake');
  });

  it('refuses a launcher occupied by a symlink to somewhere else, leaving it unchanged', async () => {
    const home = await makeHome();
    const binary = managedSemgrepPath(home);
    await symlink('/usr/local/bin/semgrep', binary);
    const outcome = await ensureSemgrepInstalled({ home, execFile: scriptedExecFile({}, []) });
    expect(outcome.status).toBe('failed');
    expect(outcome.fix).toContain('Move ~/.overdeck/bin/semgrep');
    expect(await readlink(binary)).toBe('/usr/local/bin/semgrep');
  });

  it('proceeds when the launcher is already a symlink to the managed target', async () => {
    const home = await makeHome();
    const tools = semgrepToolsDir(home);
    const binary = managedSemgrepPath(home);
    const toolsBin = join(tools, 'bin', 'semgrep');
    await symlink(toolsBin, binary);
    let versionReads = 0;
    const outcome = await ensureSemgrepInstalled({
      home,
      linkLauncher: async () => {},
      execFile: async (file, args) => {
        if (file === binary && args[0] === '--version') {
          versionReads += 1;
          return versionReads === 1 ? { stdout: '', stderr: '' } : { stdout: `${SEMGREP_VERSION}\n`, stderr: '' };
        }
        if (file === 'uv' && args[0] === '--version') return { stdout: 'uv 0.5.0\n', stderr: '' };
        if (file === 'uv' && args[0] === 'tool') return { stdout: '', stderr: '' };
        throw new Error(`unexpected exec: ${file} ${args.join(' ')}`);
      },
    });
    expect(outcome.status).toBe('installed');
  });

  it('reports unsupported on win32 without any exec call', async () => {
    const calls: Call[] = [];
    const outcome = await ensureSemgrepInstalled({
      home: await makeHome(),
      platform: 'win32',
      execFile: scriptedExecFile({}, calls),
    });
    expect(outcome.status).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  it('sends the quiet env on every exec call', async () => {
    const home = await makeHome();
    const binary = managedSemgrepPath(home);
    const calls: Call[] = [];
    await ensureSemgrepInstalled({
      home,
      inspectLauncher: async () => 'absent',
      linkLauncher: async () => {},
      execFile: async (file, args, opts) => {
        calls.push({ file, args, opts });
        if (file === binary && args[0] === '--version') {
          return calls.filter((c) => c.file === binary).length === 1
            ? { stdout: '', stderr: '' }
            : { stdout: `${SEMGREP_VERSION}\n`, stderr: '' };
        }
        if (file === 'uv' && args[0] === '--version') return { stdout: 'uv 0.5.0\n', stderr: '' };
        if (file === 'uv' && args[0] === 'tool') return { stdout: '', stderr: '' };
        throw new Error(`unexpected exec: ${file} ${args.join(' ')}`);
      },
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.opts.env.SEMGREP_ENABLE_VERSION_CHECK).toBe(SEMGREP_QUIET_ENV.SEMGREP_ENABLE_VERSION_CHECK);
      expect(call.opts.env.SEMGREP_SEND_METRICS).toBe(SEMGREP_QUIET_ENV.SEMGREP_SEND_METRICS);
    }
  });

  it('maps every status to the right spinner level', () => {
    expect(formatSemgrepInstallOutcome({ status: 'present', version: '1.180.0', message: 'm' }).level).toBe('info');
    expect(formatSemgrepInstallOutcome({ status: 'installed', version: '1.180.0', message: 'm' }).level).toBe('succeed');
    expect(formatSemgrepInstallOutcome({ status: 'failed', version: null, message: 'm', fix: 'f' }).level).toBe('warn');
    expect(formatSemgrepInstallOutcome({ status: 'failed', version: null, message: 'm', fix: 'f' }).text).toBe('m — f');
    expect(formatSemgrepInstallOutcome({ status: 'unsupported', version: null, message: 'm' }).level).toBe('warn');
  });

  it('readSemgrepVersion returns null when the binary cannot run', async () => {
    const version = await readSemgrepVersion('/no/such/binary', {
      execFile: () => Promise.reject(new Error('ENOENT')),
    });
    expect(version).toBeNull();
  });
});

async function readFileContent(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf-8');
}
