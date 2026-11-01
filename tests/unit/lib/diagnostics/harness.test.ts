import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildHarnessLaunch,
  checkHarnessEligibility,
  type HarnessEligibilityDeps,
} from '../../../../src/lib/diagnostics/harness.js';

const originalCodexHome = process.env.CODEX_HOME;
let tempCodexHome: string | undefined;

afterEach(async () => {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  if (tempCodexHome) {
    await rm(tempCodexHome, { recursive: true, force: true });
    tempCodexHome = undefined;
  }
});

function deps(overrides: Partial<HarnessEligibilityDeps> = {}): Partial<HarnessEligibilityDeps> {
  return {
    which: async () => true,
    claudeLogin: async () => ({ ok: true }),
    readCodexAuth: async () => null,
    ...overrides,
  };
}

describe('checkHarnessEligibility', () => {
  it('reports claude-code as not eligible with the install fix when not installed', async () => {
    const result = await checkHarnessEligibility('claude-code', deps({ which: async () => false }));
    expect(result).toEqual({
      harness: 'claude-code',
      label: 'Claude Code',
      installed: false,
      authenticated: false,
      eligible: false,
      reason: 'not installed',
      fix: 'Install: npm install -g @anthropic-ai/claude-code',
    });
  });

  it('reports codex as not eligible with the sign-in fix when installed but not signed in', async () => {
    const result = await checkHarnessEligibility('codex', deps({ readCodexAuth: async () => null }));
    expect(result).toEqual({
      harness: 'codex',
      label: 'Codex',
      installed: true,
      authenticated: false,
      eligible: false,
      reason: 'not signed in',
      fix: 'Run: codex login',
    });
  });

  it('reports claude-code as not eligible with the sign-in fix when installed but not signed in', async () => {
    const result = await checkHarnessEligibility('claude-code', deps({ claudeLogin: async () => ({ ok: false }) }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not signed in');
    expect(result.fix).toBe('Run: claude, then /login (or set ANTHROPIC_API_KEY)');
  });

  it('reports codex as eligible when installed and auth.json is valid', async () => {
    const validAuth = JSON.stringify({ OPENAI_API_KEY: 'sk-test' });
    const result = await checkHarnessEligibility('codex', deps({ readCodexAuth: async () => validAuth }));
    expect(result.installed).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.fix).toBeNull();
  });

  it('reads auth from $CODEX_HOME/auth.json when CODEX_HOME is set, via the default readCodexAuth dep', async () => {
    tempCodexHome = await mkdtemp(join(tmpdir(), 'overdeck-codex-home-'));
    process.env.CODEX_HOME = tempCodexHome;
    await writeFile(join(tempCodexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test' }));

    // which/claudeLogin are injected; readCodexAuth is left to its default
    // implementation, which must honour CODEX_HOME.
    const result = await checkHarnessEligibility('codex', { which: async () => true, claudeLogin: async () => ({ ok: true }) });

    expect(result.authenticated).toBe(true);
    expect(result.eligible).toBe(true);
  });
});

describe('buildHarnessLaunch', () => {
  it('builds the claude-code launch argv', () => {
    const launch = buildHarnessLaunch('claude-code', 'diagnose this', '/home/op/.overdeck');
    expect(launch).toEqual({ command: 'claude', args: ['diagnose this'], cwd: '/home/op/.overdeck' });
  });

  it('builds the codex launch argv', () => {
    const launch = buildHarnessLaunch('codex', 'diagnose this', '/home/op/.overdeck');
    expect(launch).toEqual({ command: 'codex', args: ['diagnose this'], cwd: '/home/op/.overdeck' });
  });

  it('never includes a permission-bypass or exec flag in either harness launch', () => {
    const forbidden = ['--dangerously', '-p', 'exec', '--full-auto', '--model'];
    for (const harness of ['claude-code', 'codex'] as const) {
      const launch = buildHarnessLaunch(harness, 'diagnose this', '/home/op/.overdeck');
      for (const flag of forbidden) {
        expect(launch.args).not.toContain(flag);
        expect(launch.command).not.toBe(flag);
      }
      expect(launch.args).toEqual(['diagnose this']);
    }
  });
});
