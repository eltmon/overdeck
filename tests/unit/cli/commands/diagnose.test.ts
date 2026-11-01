import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { diagnoseCommand, type DiagnoseDeps, type DiagnoseOptions } from '../../../../src/cli/commands/diagnose.js';
import { diagnosticsRoot } from '../../../../src/lib/diagnostics/bundle.js';
import { collectSystem } from '../../../../src/lib/diagnostics/collect-system.js';
import type { HarnessEligibility } from '../../../../src/lib/diagnostics/harness.js';

class ExitSignal extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

let root: string;
let overdeckHome: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'overdeck-diagnose-'));
  overdeckHome = join(root, 'home');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function recorder(): { fn: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { fn: (line) => lines.push(line), lines };
}

function baseDeps(overrides: Partial<DiagnoseDeps> = {}): DiagnoseDeps {
  return {
    out: () => {},
    err: () => {},
    readLine: async () => '',
    isTTY: true,
    exit: async (code: number) => { throw new ExitSignal(code); },
    collectSystem: async () => ({ entries: [], failures: [] }),
    collectFiles: async () => ({ entries: [], failures: [] }),
    collectDoctor: async () => ({ entries: [], failures: [] }),
    listHarnessEligibility: async () => [],
    checkHarnessEligibility: async (harness) => ({
      harness,
      label: harness,
      installed: true,
      authenticated: true,
      eligible: true,
      reason: null,
      fix: null,
    }),
    spawnForeground: async () => 0,
    onSignals: () => {},
    offSignals: () => {},
    now: () => new Date('2026-11-01T04:44:53.027Z'),
    overdeckHome,
    home: '/home/exampleuser',
    ...overrides,
  };
}

async function runDiagnose(options: DiagnoseOptions, deps: DiagnoseDeps): Promise<number> {
  try {
    await diagnoseCommand(options, deps);
  } catch (error) {
    if (error instanceof ExitSignal) return error.code;
    throw error;
  }
  throw new Error('diagnoseCommand resolved without calling exit');
}

describe('diagnoseCommand', () => {
  it('with --bundle-only and the dashboard down, still writes a complete bundle and exits 0', async () => {
    const out = recorder();
    const rejectingFetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3011'));

    const deps = baseDeps({
      out: out.fn,
      collectSystem: () => collectSystem({
        fetch: rejectingFetch as unknown as typeof fetch,
        isSupervisorRunning: () => false,
        getDashboardApiUrl: () => 'http://localhost:3011',
        getSupervisorUrl: () => 'http://localhost:3012',
        readPackageVersion: async () => '1.2.3',
        getBuildInfo: () => ({ buildCommit: null, builtAt: null, buildDirty: null, buildBranch: null }),
        hostTerminalBackendName: async () => 'herdr',
        execFile: async () => {
          throw Object.assign(new Error('not found'), { code: 'ENOENT' });
        },
      }),
    });

    const code = await runDiagnose({ bundleOnly: true }, deps);
    expect(code).toBe(0);

    const dir = out.lines[out.lines.length - 1];
    const manifest = await readFile(join(dir, 'MANIFEST.md'), 'utf-8');
    expect(manifest).toContain('# Overdeck diagnostic bundle');

    const services = JSON.parse(await readFile(join(dir, 'services.json'), 'utf-8'));
    expect(services.dashboard.reachable).toBe(false);
  });

  it('never leaves a runtime secret anywhere in the written bundle', async () => {
    const secret = ['sk', 'ant', 'api03', 'Q'.repeat(40)].join('-');
    const out = recorder();

    const deps = baseDeps({
      out: out.fn,
      collectFiles: async () => ({
        entries: [
          { path: 'config/config.yaml', content: `linear_api_key: ${secret}\n`, kind: 'config', description: 'Overdeck config' },
          { path: 'logs/dashboard.log', content: `auth failed, secret was ${secret}\n`, kind: 'text', description: 'Dashboard log tail' },
        ],
        failures: [],
      }),
    });

    const code = await runDiagnose({ bundleOnly: true }, deps);
    expect(code).toBe(0);

    const dir = out.lines[out.lines.length - 1];
    for (const relPath of ['config/config.yaml', 'logs/dashboard.log']) {
      const content = await readFile(join(dir, relPath), 'utf-8');
      expect(content).not.toContain(secret);
      expect(content).toContain('[REDACTED');
    }
  });

  it('fails fast on an explicit ineligible --harness, writing no bundle dir', async () => {
    const err = recorder();
    const deps = baseDeps({
      err: err.fn,
      checkHarnessEligibility: async (): Promise<HarnessEligibility> => ({
        harness: 'codex',
        label: 'Codex',
        installed: false,
        authenticated: false,
        eligible: false,
        reason: 'not installed',
        fix: 'Install: npm install -g @openai/codex',
      }),
    });

    const code = await runDiagnose({ harness: 'codex' }, deps);
    expect(code).toBe(1);
    expect(err.lines.join('\n')).toContain('Install: npm install -g @openai/codex');
    await expect(readdir(diagnosticsRoot(overdeckHome))).rejects.toThrow();
  });

  it('launches claude-code with the prompt and overdeckHome as cwd after confirming', async () => {
    const out = recorder();
    const spawnForeground = vi.fn().mockResolvedValue(0);
    const deps = baseDeps({ out: out.fn, readLine: async () => 'y', spawnForeground });

    const code = await runDiagnose({ harness: 'claude-code' }, deps);
    expect(code).toBe(0);
    expect(spawnForeground).toHaveBeenCalledTimes(1);

    const [command, args, cwd] = spawnForeground.mock.calls[0];
    const bundleLine = out.lines.find((line) => line.startsWith('Bundle: '));
    const dir = bundleLine!.slice('Bundle: '.length);

    expect(command).toBe('claude');
    expect(args).toHaveLength(1);
    expect(args[0]).toContain(dir);
    expect(cwd).toBe(overdeckHome);
  });

  it('launches codex when --harness codex --yes skips the confirmation prompt', async () => {
    const spawnForeground = vi.fn().mockResolvedValue(0);
    const deps = baseDeps({ spawnForeground });

    const code = await runDiagnose({ harness: 'codex', yes: true }, deps);
    expect(code).toBe(0);
    expect(spawnForeground.mock.calls[0][0]).toBe('codex');
  });

  it('does not launch the harness when consent is declined', async () => {
    const spawnForeground = vi.fn();
    const deps = baseDeps({ readLine: async () => 'n', spawnForeground });

    const code = await runDiagnose({ harness: 'claude-code' }, deps);
    expect(code).toBe(0);
    expect(spawnForeground).not.toHaveBeenCalled();
  });

  it('writes the bundle and exits 1 mentioning --bundle-only when not a TTY', async () => {
    const out = recorder();
    const err = recorder();
    const deps = baseDeps({ isTTY: false, out: out.fn, err: err.fn });

    const code = await runDiagnose({}, deps);
    expect(code).toBe(1);
    expect(err.lines.join('\n')).toContain('--bundle-only');

    const dir = out.lines[out.lines.length - 1];
    await expect(readFile(join(dir, 'MANIFEST.md'), 'utf-8')).resolves.toContain('# Overdeck diagnostic bundle');
  });

  it('exits 1 listing both fixes when no harness is eligible and none is specified', async () => {
    const err = recorder();
    const deps = baseDeps({
      err: err.fn,
      listHarnessEligibility: async (): Promise<HarnessEligibility[]> => [
        { harness: 'claude-code', label: 'Claude Code', installed: false, authenticated: false, eligible: false, reason: 'not installed', fix: 'Install: npm install -g @anthropic-ai/claude-code' },
        { harness: 'codex', label: 'Codex', installed: false, authenticated: false, eligible: false, reason: 'not installed', fix: 'Install: npm install -g @openai/codex' },
      ],
    });

    const code = await runDiagnose({}, deps);
    expect(code).toBe(1);
    const combined = err.lines.join('\n');
    expect(combined).toContain('Install: npm install -g @anthropic-ai/claude-code');
    expect(combined).toContain('Install: npm install -g @openai/codex');
  });

  it('omits "gh issue create" from PROMPT.md when --no-issue is passed', async () => {
    const out = recorder();
    const deps = baseDeps({ out: out.fn });

    const code = await runDiagnose({ bundleOnly: true, issue: false }, deps);
    expect(code).toBe(0);

    const dir = out.lines[out.lines.length - 1];
    const prompt = await readFile(join(dir, 'PROMPT.md'), 'utf-8');
    expect(prompt).not.toContain('gh issue create');
    expect(prompt).toContain('Do not draft or create an upstream issue');
  });

  it('installs signal no-ops before spawnForeground and removes them after it settles', async () => {
    const calls: string[] = [];
    const deps = baseDeps({
      onSignals: () => calls.push('on'),
      offSignals: () => calls.push('off'),
      spawnForeground: async () => {
        calls.push('spawn');
        return 0;
      },
    });

    await runDiagnose({ harness: 'claude-code', yes: true }, deps);
    expect(calls).toEqual(['on', 'spawn', 'off']);
  });

  it('removes signal no-ops even when spawnForeground rejects', async () => {
    const calls: string[] = [];
    const deps = baseDeps({
      onSignals: () => calls.push('on'),
      offSignals: () => calls.push('off'),
      spawnForeground: async () => {
        calls.push('spawn');
        throw new Error('boom');
      },
    });

    const code = await runDiagnose({ harness: 'claude-code', yes: true }, deps);
    expect(code).toBe(1);
    expect(calls).toEqual(['on', 'spawn', 'off']);
  });
});
