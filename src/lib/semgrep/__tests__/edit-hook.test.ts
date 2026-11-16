import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runSemgrepEditHook,
  semgrepScanEnv,
  type SemgrepEditHookDeps,
} from '../../../../sync-sources/hooks/semgrep-edit-hook.js';
import { semgrepInSessionEnv } from '../in-session.js';
import { HOOK_SCRIPT_NAMES, OVERDECK_HOOK_REGISTRATIONS } from '../../claude-hooks-registration.js';

/** Run `bash <scriptPath>` with `stdin` on its stdin, and collect stdout. */
function runShim(scriptPath: string, stdin: string): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath]);
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, code }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

const HOME = '/h';
const AGENT_ID = 'agent-work-1';
const EXPECTED_TARGET = join(HOME, 'tools', 'semgrep', 'bin', 'semgrep');
const BIN = join(HOME, 'bin', 'semgrep');
const STATE_PATH = join(HOME, 'agents', AGENT_ID, 'state.json');

function writePayload(toolName: string, filePath: string, cwd = '/repo'): string {
  return JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath }, cwd });
}

function findingsJson(count: number): string {
  const results = Array.from({ length: count }, (_, i) => ({
    check_id: `rule-${i}`,
    start: { line: i + 1 },
    extra: { message: `message ${i}`, severity: 'WARNING' },
  }));
  return JSON.stringify({ results });
}

interface DepsOverrides extends Partial<SemgrepEditHookDeps> {
  role?: string | null;
  configFiles?: Set<string>;
}

function baseDeps(overrides: DepsOverrides = {}): SemgrepEditHookDeps {
  const role = overrides.role === undefined ? 'work' : overrides.role;
  const configFiles = overrides.configFiles ?? new Set<string>();
  return {
    exists: async (path: string) => {
      if (path === STATE_PATH) return role !== null;
      return configFiles.has(path);
    },
    readFile: async (path: string) => {
      if (path === STATE_PATH) return JSON.stringify({ role });
      throw new Error(`unexpected readFile: ${path}`);
    },
    stat: async () => ({ isFile: () => true, size: 100 }),
    lstat: async () => ({ isSymbolicLink: () => true }),
    readlink: async () => EXPECTED_TARGET,
    execFile: async () => ({ stdout: findingsJson(0) }),
    ...overrides,
  };
}

const ENV = { OVERDECK_AGENT_ID: AGENT_ID, OVERDECK_HOME: HOME };

describe('semgrepScanEnv (PAN-4591 WI-4 ac4)', () => {
  it('removes the token/rules vars, keeps PATH, and matches semgrepInSessionEnv on the Semgrep keys', () => {
    const env = semgrepScanEnv({ SEMGREP_APP_TOKEN: 't', SEMGREP_RULES: 'r', PATH: '/bin' }, HOME);
    expect(env.SEMGREP_APP_TOKEN).toBeUndefined();
    expect(env.SEMGREP_RULES).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    const expected = semgrepInSessionEnv(HOME);
    expect(env.SEMGREP_ENABLE_VERSION_CHECK).toBe(expected.SEMGREP_ENABLE_VERSION_CHECK);
    expect(env.SEMGREP_SEND_METRICS).toBe(expected.SEMGREP_SEND_METRICS);
    expect(env.SEMGREP_SETTINGS_FILE).toBe(expected.SEMGREP_SETTINGS_FILE);
    expect(env.SEMGREP_LOG_FILE).toBe(expected.SEMGREP_LOG_FILE);
  });
});

describe('runSemgrepEditHook (PAN-4591 WI-4 ac1/ac2/ac3/ac6/ac7)', () => {
  it('returns the output JSON with both findings, their lines, and the nosemgrep instruction', async () => {
    const calls: Array<{ file: string; args: string[]; opts: { timeout: number } }> = [];
    const deps = baseDeps({
      execFile: async (file, args, opts) => {
        calls.push({ file, args, opts });
        return { stdout: findingsJson(2) };
      },
    });
    const output = await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps);
    expect(output).not.toBe('');
    const parsed = JSON.parse(output) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('rule-0');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('rule-1');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('line 1');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('line 2');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('nosemgrep');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.file).toBe(BIN);
    expect(call.args[call.args.length - 1]).toBe('/repo/src/a.ts');
    expect(call.args).toContain('--metrics=off');
    const configIndex = call.args.indexOf('p/default');
    expect(call.args[configIndex - 1]).toBe('--config');
    expect(call.opts.timeout).toBe(30_000);
  });

  it('returns "" for zero results', async () => {
    const output = await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, baseDeps());
    expect(output).toBe('');
  });

  it('returns "" and never calls execFile for a non-work role', async () => {
    let called = false;
    const deps = baseDeps({ role: 'review', execFile: async () => { called = true; return { stdout: findingsJson(0) }; } });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile with no OVERDECK_AGENT_ID', async () => {
    let called = false;
    const deps = baseDeps({ execFile: async () => { called = true; return { stdout: findingsJson(0) }; } });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), { OVERDECK_HOME: HOME }, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile for a Bash tool call', async () => {
    let called = false;
    const deps = baseDeps({ execFile: async () => { called = true; return { stdout: findingsJson(0) }; } });
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/repo' });
    expect(await runSemgrepEditHook(payload, ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile for a .md file', async () => {
    let called = false;
    const deps = baseDeps({ execFile: async () => { called = true; return { stdout: findingsJson(0) }; } });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/README.md'), ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile for a node_modules path', async () => {
    let called = false;
    const deps = baseDeps({ execFile: async () => { called = true; return { stdout: findingsJson(0) }; } });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/node_modules/x/a.ts'), ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile for a 2 MiB file', async () => {
    let called = false;
    const deps = baseDeps({
      stat: async () => ({ isFile: () => true, size: 2 * 1024 * 1024 }),
      execFile: async () => { called = true; return { stdout: findingsJson(0) }; },
    });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile when the binary is missing', async () => {
    let called = false;
    const deps = baseDeps({
      lstat: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      execFile: async () => { called = true; return { stdout: findingsJson(0) }; },
    });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile when ~/.overdeck/bin/semgrep is a regular file', async () => {
    let called = false;
    const deps = baseDeps({
      lstat: async () => ({ isSymbolicLink: () => false }),
      execFile: async () => { called = true; return { stdout: findingsJson(0) }; },
    });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" and never calls execFile when the symlink points anywhere but the managed target', async () => {
    let called = false;
    const deps = baseDeps({
      readlink: async () => '/somewhere/else/semgrep',
      execFile: async () => { called = true; return { stdout: findingsJson(0) }; },
    });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" when execFile rejects with a timeout error', async () => {
    const deps = baseDeps({
      execFile: async () => { throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' }); },
    });
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps)).toBe('');
  });

  it('lists 10 findings plus "...and 2 more" for 12 results', async () => {
    const deps = baseDeps({ execFile: async () => ({ stdout: findingsJson(12) }) });
    const output = await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps);
    const parsed = JSON.parse(output) as { hookSpecificOutput: { additionalContext: string } };
    expect(parsed.hookSpecificOutput.additionalContext).toContain('rule-9');
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain('rule-10');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('…and 2 more');
  });

  it('adds a second --config pair when .semgrep.yml exists in cwd', async () => {
    const calls: string[][] = [];
    const deps = baseDeps({
      configFiles: new Set([join('/repo', '.semgrep.yml')]),
      execFile: async (_file, args) => {
        calls.push(args);
        return { stdout: findingsJson(0) };
      },
    });
    await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), ENV, deps);
    expect(calls[0]).toContain(join('/repo', '.semgrep.yml'));
  });

  it('returns "" without calling execFile under OVERDECK_DOCKER_WORKSPACE=1', async () => {
    let called = false;
    const deps = baseDeps({ execFile: async () => { called = true; return { stdout: findingsJson(0) }; } });
    const env = { ...ENV, OVERDECK_DOCKER_WORKSPACE: '1' };
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), env, deps)).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" without calling execFile under PAN_DOCKER=1', async () => {
    let called = false;
    const deps = baseDeps({ execFile: async () => { called = true; return { stdout: findingsJson(0) }; } });
    const env = { ...ENV, PAN_DOCKER: '1' };
    expect(await runSemgrepEditHook(writePayload('Write', '/repo/src/a.ts'), env, deps)).toBe('');
    expect(called).toBe(false);
  });
});

const REAL_SHIM = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'sync-sources', 'hooks', 'semgrep-edit-hook');

describe('semgrep-edit-hook shell entry point (PAN-4591 WI-4 ac7)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'semgrep-edit-hook-shim-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('exits 0 with empty stdout when the bundle is missing', async () => {
    const shimPath = join(dir, 'semgrep-edit-hook');
    await copyFile(REAL_SHIM, shimPath);
    await chmod(shimPath, 0o755);
    const { stdout, code } = await runShim(shimPath, writePayload('Write', '/repo/src/a.ts'));
    expect(code).toBe(0);
    expect(stdout).toBe('');
  });

  it('exits 0 with empty stdout when the bundle exits 3', async () => {
    const shimPath = join(dir, 'semgrep-edit-hook');
    await copyFile(REAL_SHIM, shimPath);
    await chmod(shimPath, 0o755);
    await writeFile(join(dir, 'semgrep-edit-hook.js'), '#!/usr/bin/env node\nprocess.exit(3);\n');
    const { stdout, code } = await runShim(shimPath, writePayload('Write', '/repo/src/a.ts'));
    expect(code).toBe(0);
    expect(stdout).toBe('');
  });
});

describe('hook registration (PAN-4591 WI-4 ac5)', () => {
  it('lists semgrep-edit-hook and its bundle in HOOK_SCRIPT_NAMES, never in OVERDECK_HOOK_REGISTRATIONS', () => {
    expect(HOOK_SCRIPT_NAMES).toContain('semgrep-edit-hook');
    expect(HOOK_SCRIPT_NAMES).toContain('semgrep-edit-hook.js');
    expect(OVERDECK_HOOK_REGISTRATIONS.some((r) => r.scriptName.startsWith('semgrep-edit-hook'))).toBe(false);
  });
});
