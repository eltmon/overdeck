import { describe, expect, it, vi } from 'vitest';
import {
  checkTtsHealth,
  createTtsVoice,
  listTtsVoices,
  parseCreateTtsVoiceInput,
  removeTtsVoice,
} from '../tts.js';
import type { TtsVoice } from '../../../../lib/tts-voices.js';

describe('checkTtsHealth', () => {
  it('returns daemon health details when the daemon responds', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ queue: 2, model: 'qwen3-tts' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(checkTtsHealth({ fetch: fetchImpl, host: '127.0.0.1', port: 8787 })).resolves.toEqual({
      ok: true,
      queue: 2,
      model: 'qwen3-tts',
    });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8787/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('returns ok false when the daemon is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(checkTtsHealth({ fetch: fetchImpl, host: '127.0.0.1', port: 8787 })).resolves.toEqual({
      ok: false,
      error: 'daemon unreachable',
    });
  });

  it('returns ok false for non-2xx daemon responses', async () => {
    const fetchImpl = vi.fn(async () => new Response('not ready', { status: 503 }));

    await expect(checkTtsHealth({ fetch: fetchImpl, host: '127.0.0.1', port: 8787 })).resolves.toEqual({
      ok: false,
      error: 'daemon unreachable',
    });
  });
});

describe('TTS voice routes helpers', () => {
  it('lists voices without embedding fields', async () => {
    const voices: TtsVoice[] = [
      {
        id: 'voice-1',
        name: 'Narrator',
        kind: 'clone',
        createdAt: '2026-05-16T00:00:00.000Z',
        description: 'warm',
        embedding: [0.1, 0.2],
      },
    ];

    await expect(listTtsVoices({ loadVoices: async () => voices })).resolves.toEqual([
      {
        id: 'voice-1',
        name: 'Narrator',
        kind: 'clone',
        createdAt: '2026-05-16T00:00:00.000Z',
        description: 'warm',
      },
    ]);
  });

  it('parses and creates a voice record', async () => {
    const body = {
      name: 'Preset voice',
      kind: 'preset',
      presetName: 'vivian',
      instruct: 'clear and calm',
    };
    const input = parseCreateTtsVoiceInput(body);
    expect(input).toEqual(body);

    const addVoice = vi.fn(async (voice) => ({
      ...voice,
      id: 'voice-2',
      createdAt: '2026-05-16T00:01:00.000Z',
    }));

    await expect(createTtsVoice(input!, { addVoice })).resolves.toEqual({
      id: 'voice-2',
      createdAt: '2026-05-16T00:01:00.000Z',
      ...body,
    });
    expect(addVoice).toHaveBeenCalledWith(body);
  });

  it('rejects invalid voice create payloads', () => {
    expect(parseCreateTtsVoiceInput({ name: '', kind: 'preset' })).toBeUndefined();
    expect(parseCreateTtsVoiceInput({ name: 'Bad', kind: 'robot' })).toBeUndefined();
    expect(parseCreateTtsVoiceInput({ name: 'Bad', kind: 'clone', embedding: ['x'] })).toBeUndefined();
  });

  it('deletes voices and reports unknown ids', async () => {
    const deleteVoice = vi.fn(async (id: string) => id === 'voice-1');

    await expect(removeTtsVoice('voice-1', { deleteVoice })).resolves.toBe(true);
    await expect(removeTtsVoice('missing', { deleteVoice })).resolves.toBe(false);
    expect(deleteVoice).toHaveBeenNthCalledWith(1, 'voice-1');
    expect(deleteVoice).toHaveBeenNthCalledWith(2, 'missing');
  });
});
