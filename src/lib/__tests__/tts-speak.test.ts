import { describe, expect, it, vi } from 'vitest';
import { buildTtsSpeakPayload, resolveAndSpeak } from '../tts-speak.js';
import type { NormalizedTtsDaemonConfig } from '../config-yaml.js';
import type { TtsVoice } from '../tts-voices.js';

const CONFIG: NormalizedTtsDaemonConfig = {
  enabled: true,
  voice: 'voice-preset',
  statusVoice: 'voice-status',
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
  id: 'voice-preset',
  name: 'System Voice',
  kind: 'preset',
  createdAt: '2026-05-16T00:00:00.000Z',
  presetName: 'Vivian',
  instruct: 'calm',
};

const STATUS_VOICE: TtsVoice = {
  id: 'voice-status',
  name: 'Status Voice',
  kind: 'preset',
  createdAt: '2026-05-16T00:00:00.000Z',
  presetName: 'Ryan',
};

const CLONE_VOICE: TtsVoice = {
  id: 'voice-clone',
  name: 'Clone Voice',
  kind: 'clone',
  createdAt: '2026-05-16T00:00:00.000Z',
  instruct: 'bright',
  embedding: [0.1, 0.2, 0.3],
};

function findVoiceById(id: string): Promise<TtsVoice | undefined> {
  return Promise.resolve([PRESET_VOICE, STATUS_VOICE, CLONE_VOICE].find((voice) => voice.id === id));
}

describe('buildTtsSpeakPayload', () => {
  it('builds daemon payloads for preset, design, and clone voices', () => {
    expect(buildTtsSpeakPayload(PRESET_VOICE, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'Vivian',
      instruct: 'calm',
      volume: 0.8,
      mode: 'custom',
    });

    expect(buildTtsSpeakPayload({ ...PRESET_VOICE, kind: 'design', description: 'warm narrator' }, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'warm narrator',
      instruct: 'calm',
      volume: 0.8,
      mode: 'design',
    });

    expect(buildTtsSpeakPayload(CLONE_VOICE, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'clone',
      instruct: 'bright',
      volume: 0.8,
      mode: 'clone',
      embedding: [0.1, 0.2, 0.3],
    });
  });
});

describe('resolveAndSpeak', () => {
  it('posts a preset voice payload to the configured daemon', async () => {
    const fetchMock = vi.fn(async () => new Response('{"queued":true}', { status: 202 }));

    await expect(resolveAndSpeak({ text: 'hello' }, {
      config: CONFIG,
      findVoiceById,
      fetch: fetchMock,
    })).resolves.toBe('spoken');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'hello', voice: 'Vivian', instruct: 'calm', volume: 0.8, mode: 'custom' }),
    }));
  });

  it('uses the status voice for routine priority 2 utterances', async () => {
    const fetchMock = vi.fn(async () => new Response('{"queued":true}', { status: 202 }));

    await expect(resolveAndSpeak({ text: 'routine update', priority: 2 }, {
      config: CONFIG,
      findVoiceById,
      fetch: fetchMock,
    })).resolves.toBe('spoken');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', expect.objectContaining({
      body: JSON.stringify({ text: 'routine update', voice: 'Ryan', instruct: '', volume: 0.8, mode: 'custom' }),
    }));
  });

  it('uses voiceMap and sends clone embeddings', async () => {
    const fetchMock = vi.fn(async () => new Response('{"queued":true}', { status: 202 }));

    await expect(resolveAndSpeak({ text: 'merged', eventType: 'mergeStatus.merged' }, {
      config: { ...CONFIG, voiceMap: { 'mergeStatus.merged': 'voice-clone' } },
      findVoiceById,
      fetch: fetchMock,
    })).resolves.toBe('spoken');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', expect.objectContaining({
      body: JSON.stringify({
        text: 'merged',
        voice: 'clone',
        instruct: 'bright',
        volume: 0.8,
        mode: 'clone',
        embedding: [0.1, 0.2, 0.3],
      }),
    }));
  });

  it('does not call the daemon for muted sources or issues', async () => {
    const fetchMock = vi.fn();

    await expect(resolveAndSpeak({ text: 'skip', source: 'merge-agent' }, {
      config: { ...CONFIG, mutedSources: ['merge-agent'] },
      findVoiceById,
      fetch: fetchMock,
    })).resolves.toBe('muted');

    await expect(resolveAndSpeak({ text: 'skip', issueId: 'PAN-829' }, {
      config: { ...CONFIG, mutedIssues: ['PAN-829'] },
      findVoiceById,
      fetch: fetchMock,
    })).resolves.toBe('muted');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies utterance template substitution before speaking', async () => {
    const fetchMock = vi.fn(async () => new Response('{"queued":true}', { status: 202 }));

    await expect(resolveAndSpeak({ text: 'original', eventType: 'reviewStatus.passed', issueId: 'PAN-829' }, {
      config: { ...CONFIG, utteranceTemplates: { 'reviewStatus.passed': '{issueId} passed review' } },
      findVoiceById,
      fetch: fetchMock,
    })).resolves.toBe('spoken');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', expect.objectContaining({
      body: JSON.stringify({ text: 'PAN-829 passed review', voice: 'Vivian', instruct: 'calm', volume: 0.8, mode: 'custom' }),
    }));
  });

  it('returns no-voice when no configured voice can be resolved', async () => {
    const fetchMock = vi.fn();

    await expect(resolveAndSpeak({ text: 'hello' }, {
      config: { ...CONFIG, voice: '', statusVoice: undefined },
      findVoiceById,
      fetch: fetchMock,
    })).resolves.toBe('no-voice');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns daemon-unavailable when the daemon request fails', async () => {
    await expect(resolveAndSpeak({ text: 'hello' }, {
      config: CONFIG,
      findVoiceById,
      fetch: vi.fn(async () => { throw new TypeError('ECONNREFUSED'); }),
    })).resolves.toBe('daemon-unavailable');
  });

  it('passes direct preview payloads through without loading a saved voice', async () => {
    const fetchMock = vi.fn(async () => new Response('{"queued":true}', { status: 202 }));
    const findVoice = vi.fn();

    await expect(resolveAndSpeak({ text: 'preview', voice: 'warm narrator', instruct: 'clear', volume: 0.4, mode: 'design' }, {
      config: CONFIG,
      findVoiceById: findVoice,
      fetch: fetchMock,
    })).resolves.toBe('spoken');

    expect(findVoice).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', expect.objectContaining({
      body: JSON.stringify({ text: 'preview', voice: 'warm narrator', instruct: 'clear', volume: 0.4, mode: 'design' }),
    }));
  });
});
