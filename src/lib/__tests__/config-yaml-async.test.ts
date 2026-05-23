import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalPanopticonHome = process.env.PANOPTICON_HOME;
let projectRoot: string;
let testHome: string;

describe('async yaml config loading', () => {
  beforeEach(() => {
    vi.resetModules();
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-config-project-'));
    testHome = mkdtempSync(join(tmpdir(), 'pan-config-home-'));
    mkdirSync(join(projectRoot, '.git'));
    mkdirSync(join(testHome, '.panopticon'), { recursive: true });
    process.env.HOME = testHome;
    process.env.PANOPTICON_HOME = testHome;
    process.chdir(projectRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalPanopticonHome;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(testHome, { recursive: true, force: true });
  });

  it('strips project-scoped TTS daemon endpoints before populating the shared cache', async () => {
    writeFileSync(join(projectRoot, '.pan.yaml'), 'tts:\n  enabled: true\n  voice: project-voice\n  daemonHost: evil.example\n  daemonPort: 80\n', 'utf8');
    const { loadConfigNoMigration, loadConfigSync } = await import('../config-yaml.js');

    const asyncResult = await Effect.runPromise(loadConfigNoMigration());

    expect(asyncResult.config.tts.enabled).toBe(true);
    expect(asyncResult.config.tts.voice).toBe('project-voice');
    expect(asyncResult.config.tts.daemonHost).toBe('127.0.0.1');
    expect(asyncResult.config.tts.daemonPort).toBe(8787);
    expect(loadConfigSync().config.tts.daemonHost).toBe('127.0.0.1');
    expect(loadConfigSync().config.tts.daemonPort).toBe(8787);
  });

  it('returns global-only auto-merge config through the async accessor', async () => {
    writeFileSync(join(testHome, '.panopticon', 'config.yaml'), `
merge:
  autoMerge:
    enabled: true
    cooldownMinutes: 6
    maxStaleMinutes: 42
    requireGitHubCiPassing: false
    requireAllCommitStatusChecks: false
    requireNoBlockerLabels:
      - global-blocked
`, 'utf8');
    const { getAutoMergeConfig } = await import('../config-yaml.js');

    await expect(Effect.runPromise(getAutoMergeConfig())).resolves.toEqual({
      enabled: true,
      cooldownMinutes: 6,
      maxStaleMinutes: 42,
      requireGitHubCiPassing: false,
      requireAllCommitStatusChecks: false,
      requireNoBlockerLabels: ['global-blocked'],
    });
  });

  it('returns project-only auto-merge config through the async accessor', async () => {
    writeFileSync(join(testHome, 'projects.yaml'), `
projects:
  panopticon:
    name: Panopticon
    path: ${projectRoot}
`, 'utf8');
    writeFileSync(join(projectRoot, '.pan.yaml'), `
merge:
  autoMerge:
    enabled: true
    cooldownMinutes: 4
    maxStaleMinutes: 8
    requireGitHubCiPassing: false
    requireAllCommitStatusChecks: false
    requireNoBlockerLabels:
      - project-only
`, 'utf8');
    const { getAutoMergeConfig } = await import('../config-yaml.js');

    await expect(Effect.runPromise(getAutoMergeConfig('panopticon'))).resolves.toEqual({
      enabled: true,
      cooldownMinutes: 4,
      maxStaleMinutes: 8,
      requireGitHubCiPassing: false,
      requireAllCommitStatusChecks: false,
      requireNoBlockerLabels: ['project-only'],
    });
  });

  it('replaces global auto-merge config with project config through the async accessor', async () => {
    writeFileSync(join(testHome, '.panopticon', 'config.yaml'), `
merge:
  autoMerge:
    enabled: true
    cooldownMinutes: 20
    maxStaleMinutes: 120
    requireGitHubCiPassing: false
    requireAllCommitStatusChecks: false
    requireNoBlockerLabels:
      - global-blocked
`, 'utf8');
    writeFileSync(join(testHome, 'projects.yaml'), `
projects:
  panopticon:
    name: Panopticon
    path: ${projectRoot}
`, 'utf8');
    writeFileSync(join(projectRoot, '.pan.yaml'), `
merge:
  autoMerge:
    enabled: true
    cooldownMinutes: 2
    requireNoBlockerLabels:
      - project-blocked
`, 'utf8');
    const { getAutoMergeConfig } = await import('../config-yaml.js');

    await expect(Effect.runPromise(getAutoMergeConfig('panopticon'))).resolves.toEqual({
      enabled: true,
      cooldownMinutes: 2,
      maxStaleMinutes: 60,
      requireGitHubCiPassing: true,
      requireAllCommitStatusChecks: true,
      requireNoBlockerLabels: ['project-blocked'],
    });
  });
});
