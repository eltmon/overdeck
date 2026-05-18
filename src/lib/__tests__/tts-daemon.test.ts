import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedTtsDaemonConfig } from '../config-yaml.js';

const CONFIG: NormalizedTtsDaemonConfig = {
  enabled: true,
  voice: '',
  volume: 1,
  rate: 1,
  maxChars: 140,
  dropInfoWhenFull: true,
  daemonHost: '127.0.0.1',
  daemonPort: 8787,
  daemonAutoStart: false,
  voiceMap: {},
  mutedSources: [],
  utteranceTemplates: {},
  mutedIssues: [],
};

const originalPanopticonHome = process.env.PANOPTICON_HOME;
let testHome: string;

describe('tts daemon lifecycle state', () => {
  beforeEach(() => {
    vi.resetModules();
    testHome = mkdtempSync(join(tmpdir(), 'pan-tts-daemon-'));
    process.env.PANOPTICON_HOME = testHome;
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('ECONNREFUSED');
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalPanopticonHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('reports stale daemon state without deleting crash markers', async () => {
    const { QWEN_TTS_PID_PATH, QWEN_TTS_STATE_PATH, getTtsDaemonStatus } = await import('../tts-daemon.js');
    mkdirSync(join(testHome, 'pids'), { recursive: true });
    writeFileSync(QWEN_TTS_PID_PATH, '999999999\n', 'utf8');
    writeFileSync(QWEN_TTS_STATE_PATH, JSON.stringify({
      pid: 999999999,
      startedAt: '2026-05-18T00:00:00.000Z',
      host: '127.0.0.1',
      port: 8787,
    }), 'utf8');

    const status = await getTtsDaemonStatus(CONFIG);

    expect(status).toMatchObject({ ok: false, running: false, pid: null });
    expect(existsSync(QWEN_TTS_PID_PATH)).toBe(true);
    expect(existsSync(QWEN_TTS_STATE_PATH)).toBe(true);
  });
});
