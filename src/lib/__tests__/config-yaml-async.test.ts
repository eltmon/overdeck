import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const originalOverdeckHome = process.env.OVERDECK_HOME;
let projectRoot: string;
let testHome: string;

describe('async yaml config loading', () => {
  beforeEach(() => {
    vi.resetModules();
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-config-project-'));
    testHome = mkdtempSync(join(tmpdir(), 'pan-config-home-'));
    mkdirSync(join(projectRoot, '.git'));
    process.env.OVERDECK_HOME = testHome;
    process.chdir(projectRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(testHome, { recursive: true, force: true });
  });

  it('strips project-scoped TTS daemon endpoints before populating the shared cache', async () => {
    writeFileSync(join(projectRoot, '.pan.yaml'), 'tts:\n  enabled: true\n  voice: project-voice\n  daemonHost: evil.example\n  daemonPort: 80\n', 'utf8');
    const { loadConfigNoMigration, loadConfigSync } = await import('../config-yaml.js');

    const asyncResult = await loadConfigNoMigration();

    expect(asyncResult.config.tts.enabled).toBe(true);
    expect(asyncResult.config.tts.voice).toBe('project-voice');
    expect(asyncResult.config.tts.daemonHost).toBe('127.0.0.1');
    expect(asyncResult.config.tts.daemonPort).toBe(8787);
    expect(loadConfigSync().config.tts.daemonHost).toBe('127.0.0.1');
    expect(loadConfigSync().config.tts.daemonPort).toBe(8787);
  });

  it('reads resources.quality_gate_slots from the global config only (PAN-4546)', async () => {
    writeFileSync(join(testHome, 'config.yaml'), 'resources:\n  quality_gate_slots: 1\n', 'utf8');
    writeFileSync(join(projectRoot, '.pan.yaml'), 'resources:\n  quality_gate_slots: 3\n', 'utf8');
    const { loadConfigNoMigration, loadGlobalConfigNoMigration } = await import('../config-yaml/load.js');

    expect((await loadGlobalConfigNoMigration()).config.resources.qualityGateSlots).toBe(1);
    expect((await loadConfigNoMigration()).config.resources.qualityGateSlots).toBe(3);
  });

  it('defaults quality_gate_slots to 2 when there is no global config (PAN-4546)', async () => {
    writeFileSync(join(projectRoot, '.pan.yaml'), 'resources:\n  quality_gate_slots: 3\n', 'utf8');
    const { loadGlobalConfigNoMigration } = await import('../config-yaml/load.js');

    expect((await loadGlobalConfigNoMigration()).config.resources.qualityGateSlots).toBe(2);
  });
});
