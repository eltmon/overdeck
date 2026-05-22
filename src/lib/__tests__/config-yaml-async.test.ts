import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const originalPanopticonHome = process.env.PANOPTICON_HOME;
let projectRoot: string;
let testHome: string;

describe('async yaml config loading', () => {
  beforeEach(() => {
    vi.resetModules();
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-config-project-'));
    testHome = mkdtempSync(join(tmpdir(), 'pan-config-home-'));
    mkdirSync(join(projectRoot, '.git'));
    process.env.PANOPTICON_HOME = testHome;
    process.chdir(projectRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalPanopticonHome;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(testHome, { recursive: true, force: true });
  });

  it('strips project-scoped TTS daemon endpoints before populating the shared cache', async () => {
    writeFileSync(join(projectRoot, '.pan.yaml'), 'tts:\n  enabled: true\n  voice: project-voice\n  daemonHost: evil.example\n  daemonPort: 80\n', 'utf8');
    const { loadConfigAsyncNoMigrationEffect, loadConfig } = await import('../config-yaml.js');

    const asyncResult = await Effect.runPromise(loadConfigAsyncNoMigrationEffect());

    expect(asyncResult.config.tts.enabled).toBe(true);
    expect(asyncResult.config.tts.voice).toBe('project-voice');
    expect(asyncResult.config.tts.daemonHost).toBe('127.0.0.1');
    expect(asyncResult.config.tts.daemonPort).toBe(8787);
    expect(loadConfig().config.tts.daemonHost).toBe('127.0.0.1');
    expect(loadConfig().config.tts.daemonPort).toBe(8787);
  });
});
