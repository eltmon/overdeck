import { describe, expect, it, vi } from 'vitest';
import {
  buildTtsSpeakPayload,
  DEFAULT_TTS_TEST_TEXT,
  deleteTtsVoiceByName,
  formatVoiceDetails,
  formatVoicesTable,
  listTtsVoices,
  mapTtsVoice,
  playTtsVoice,
  runTtsTest,
  setDefaultTtsVoice,
  showTtsVoice,
} from '../tts.js';
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

const DESIGN_VOICE: TtsVoice = {
  id: 'voice-2',
  name: 'Design Voice',
  kind: 'design',
  createdAt: '2026-05-16T00:00:00.000Z',
  description: 'warm narrator with crisp diction and fri cadence',
};

const CLONE_VOICE: TtsVoice = {
  id: 'voice-3',
  name: 'Clone Voice',
  kind: 'clone',
  createdAt: '2026-05-16T00:00:00.000Z',
  description: 'designed from warm narrator sample',
  embedding: [0.1, 0.2, 0.3],
};

describe('pan tts voices', () => {
  it('prints a table of all saved voices', async () => {
    const stdout = { log: vi.fn() };
    const voices = await listTtsVoices({
      loadVoices: vi.fn().mockResolvedValue([PRESET_VOICE, DESIGN_VOICE, CLONE_VOICE]),
      stdout,
    });

    expect(voices).toEqual([PRESET_VOICE, DESIGN_VOICE, CLONE_VOICE]);
    const output = stdout.log.mock.calls[0][0] as string;
    expect(output).toContain('NAME');
    expect(output).toContain('KIND');
    expect(output).toContain('MODEL/SOURCE');
    expect(output).toContain('System Voice');
    expect(output).toContain('preset');
    expect(output).toContain('Vivian');
    expect(output).toContain('warm narrator with crisp diction and fri');
    expect(output).toContain('embedding (designed from designed from warm narrator sa)');
  });

  it('prints the empty library message', async () => {
    const stdout = { log: vi.fn() };
    await listTtsVoices({ loadVoices: vi.fn().mockResolvedValue([]), stdout });

    expect(stdout.log).toHaveBeenCalledWith('No voices saved yet');
  });

  it('prints voice details without raw embedding values', async () => {
    const details = formatVoiceDetails(CLONE_VOICE);

    expect(details).toContain('"name": "Clone Voice"');
    expect(details).toContain('"embedding": "[3 floats]"');
    expect(details).not.toContain('0.1');
  });

  it('shows a voice by name', async () => {
    const stdout = { log: vi.fn() };
    const result = await showTtsVoice('Clone Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(CLONE_VOICE),
      stdout,
      stderr: { error: vi.fn() },
    });

    expect(result).toEqual(CLONE_VOICE);
    expect(stdout.log).toHaveBeenCalledWith(formatVoiceDetails(CLONE_VOICE));
  });

  it('prints a not found error for unknown voices', async () => {
    const stderr = { error: vi.fn() };
    const result = await showTtsVoice('Missing', {
      findVoiceByName: vi.fn().mockResolvedValue(undefined),
      stdout: { log: vi.fn() },
      stderr,
    });

    expect(result).toBeUndefined();
    expect(stderr.error).toHaveBeenCalledWith(expect.stringContaining('Voice not found: Missing'));
  });

  it('formats the voices table without raw embedding values', () => {
    const output = formatVoicesTable([CLONE_VOICE]);

    expect(output).toContain('Clone Voice');
    expect(output).toContain('clone');
    expect(output).toContain('embedding (designed from designed from warm narrator sa)');
    expect(output).not.toContain('0.1');
  });

  it('plays a named voice through the daemon directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"queued":true}', { status: 202 }));
    const result = await playTtsVoice('System Voice', 'custom phrase', {
      config: CONFIG,
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      fetch: fetchMock,
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() },
    });

    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:8787/speak' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'custom phrase', voice: 'Vivian', instruct: 'calm', volume: 0.8 }),
    }));
  });

  it('deletes a named voice by id', async () => {
    const stdout = { log: vi.fn() };
    const deleteMock = vi.fn().mockResolvedValue(true);
    await expect(deleteTtsVoiceByName('System Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      deleteVoice: deleteMock,
      stdout,
    })).resolves.toBe(true);

    expect(deleteMock).toHaveBeenCalledWith('voice-1');
    expect(stdout.log).toHaveBeenCalledWith('Deleted System Voice');
  });

  it('sets a named voice as the system default', async () => {
    const stdout = { log: vi.fn() };
    const updateMock = vi.fn().mockResolvedValue(undefined);
    await expect(setDefaultTtsVoice('System Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      updateTtsConfig: updateMock,
      stdout,
    })).resolves.toEqual(PRESET_VOICE);

    expect(updateMock).toHaveBeenCalledWith({ voice: 'voice-1' });
    expect(stdout.log).toHaveBeenCalledWith('Set System Voice as system voice');
  });

  it('maps an event key to a named voice', async () => {
    const stdout = { log: vi.fn() };
    const updateMock = vi.fn().mockResolvedValue(undefined);
    await expect(mapTtsVoice('reviewStatus.passed', 'System Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      updateTtsConfig: updateMock,
      stdout,
    })).resolves.toEqual(PRESET_VOICE);

    expect(updateMock).toHaveBeenCalledWith({ voiceMap: { 'reviewStatus.passed': 'voice-1' } });
    expect(stdout.log).toHaveBeenCalledWith('Mapped reviewStatus.passed → System Voice');
  });
});

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
