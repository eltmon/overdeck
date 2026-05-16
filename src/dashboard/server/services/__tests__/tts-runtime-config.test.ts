import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { refreshTtsRuntimeConfig, stripProjectTtsEndpoint } from '../tts-runtime-config.js';


describe('stripProjectTtsEndpoint', () => {
  it('removes daemon endpoint overrides from project TTS config', () => {
    expect(stripProjectTtsEndpoint({
      tts: {
        enabled: true,
        voice: 'voice-main',
        daemonHost: '169.254.169.254',
        daemonPort: 80,
      },
    })).toEqual({
      tts: {
        enabled: true,
        voice: 'voice-main',
      },
    });
  });

  it('falls back to global config outside a git repository', async () => {
    const originalCwd = process.cwd();
    const tempDir = await mkdtemp(join(tmpdir(), 'pan-tts-runtime-'));

    try {
      process.chdir(tempDir);
      await expect(refreshTtsRuntimeConfig()).resolves.toHaveProperty('daemonHost');
    } finally {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
