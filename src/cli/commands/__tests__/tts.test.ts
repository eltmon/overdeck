import { describe, expect, it, vi } from 'vitest';
import { buildTtsSpeakPayload, DEFAULT_TTS_TEST_TEXT, runTtsTest } from '../tts.js';
import type { NormalizedTtsDaemonConfig } from '../../../lib/config-yaml.js';
import type { TtsVoice } from '../../../lib/tts-voices.js';

const CONFIG: NormalizedTtsDaemonConfig = {
  enabled: true,
  voice: 'voice-1',
  volume: 0.8,
  rate: 1.1,
  maxChars: 140,
  dropInfoWhenFull: true,
  daemonHost: '127.0.0.1',
  daemonPort: 8787,
  voiceMap: {},
  mutedSources: [],
  utteranceTemplates: {},
  mutedIssues: [],
};

const PRESET_VOICE: TtsVoice = {
  id: 'voice-1',
  name: 'System Voice',
  kind: 'preset',
  createdAt: '2026-05-16T00:00:00.000Z',
  presetName: 'Vivian',
  instruct: 'calm',
};

describe('pan tts test', () => {
  it('builds daemon payloads for preset, design, and clone voices', () => {
    expect(buildTtsSpeakPayload(PRESET_VOICE, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'Vivian',
      instruct: 'calm',
      volume: 0.8,
    });

    expect(buildTtsSpeakPayload({ ...PRESET_VOICE, kind: 'design', description: 'warm narrator' }, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'warm narrator',
      instruct: 'calm',
      volume: 0.8,
      mode: 'design',
    });

    expect(buildTtsSpeakPayload({ ...PRESET_VOICE, kind: 'clone', embedding: [0.1, 0.2] }, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'System Voice',
      instruct: 'calm',
      volume: 0.8,
      mode: 'clone',
      embedding: [0.1, 0.2],
    });
  });

  it('posts the default phrase to the configured daemon using the system voice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"queued":true}', { status: 202 }));
    const result = await runTtsTest(undefined, {
      config: CONFIG,
      findVoiceById: vi.fn().mockResolvedValue(PRESET_VOICE),
      fetch: fetchMock,
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() },
    });

    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:8787/speak' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: DEFAULT_TTS_TEST_TEXT, voice: 'Vivian', instruct: 'calm', volume: 0.8 }),
    });
  });

  it('prints an actionable error when no system voice is configured', async () => {
    const stderr = { error: vi.fn() };
    const result = await runTtsTest(undefined, {
      config: { ...CONFIG, voice: '' },
      findVoiceById: vi.fn(),
      fetch: vi.fn(),
      stdout: { log: vi.fn() },
      stderr,
    });

    expect(result).toMatchObject({ ok: false, reason: 'no-voice' });
    expect(stderr.error).toHaveBeenCalledWith(expect.stringContaining('No system voice set'));
  });

  it('prints an actionable error when the daemon is down', async () => {
    const stderr = { error: vi.fn() };
    const result = await runTtsTest('custom phrase', {
      config: CONFIG,
      findVoiceById: vi.fn().mockResolvedValue(PRESET_VOICE),
      fetch: vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED')),
      stdout: { log: vi.fn() },
      stderr,
    });

    expect(result).toMatchObject({ ok: false, reason: 'daemon-unavailable' });
    expect(stderr.error).toHaveBeenCalledWith(expect.stringContaining('Daemon not running at 127.0.0.1:8787'));
  });
});
