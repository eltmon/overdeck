import { describe, expect, it, vi } from 'vitest';
import {
  checkTtsHealth,
  createTtsVoice,
  EXTRACT_EMBEDDING_TIMEOUT_MS,
  extractTtsEmbedding,
  listTtsVoices,
  originErrorResponse,
  parseCreateTtsVoiceInput,
  parseExtractEmbeddingInput,
  parseSpeakTtsInput,
  removeTtsVoice,
  speakTts,
} from '../tts.js';
import type { TtsVoice } from '../../../../lib/tts-voices.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';

function responseJson(response: { body: unknown }): unknown {
  const body = response.body as { body?: Uint8Array } | null;
  const text = body?.body ? new TextDecoder().decode(body.body) : '{}';
  return JSON.parse(text);
}

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

describe('TTS mutation origin guard', () => {
  it('rejects mutation requests with missing or untrusted origins', async () => {
    const missingOrigin = originErrorResponse({ method: 'POST', headers: {} } as never);
    expect(missingOrigin?.status).toBe(403);
    expect(responseJson(missingOrigin!)).toEqual({ error: 'Missing origin' });

    const invalidOrigin = originErrorResponse({
      method: 'DELETE',
      headers: { origin: 'https://evil.example' },
    } as never);
    expect(invalidOrigin?.status).toBe(403);
    expect(responseJson(invalidOrigin!)).toEqual({ error: 'Invalid origin' });
  });

  it('allows mutation requests from trusted origins', () => {
    const previousPort = process.env['API_PORT'];
    process.env['API_PORT'] = '3011';
    _resetTrustedOriginsForTests();

    try {
      expect(originErrorResponse({
        method: 'POST',
        headers: { origin: 'http://localhost:3011' },
      } as never)).toBeUndefined();
    } finally {
      if (previousPort === undefined) delete process.env['API_PORT'];
      else process.env['API_PORT'] = previousPort;
      _resetTrustedOriginsForTests();
    }
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

  it('accepts clone voices with non-empty embeddings', () => {
    expect(parseCreateTtsVoiceInput({
      name: 'Clone voice',
      kind: 'clone',
      embedding: [0.1, 0.2],
    })).toEqual({
      name: 'Clone voice',
      kind: 'clone',
      embedding: [0.1, 0.2],
    });
  });

  it('rejects invalid voice create payloads', () => {
    expect(parseCreateTtsVoiceInput({ name: '', kind: 'preset' })).toBeUndefined();
    expect(parseCreateTtsVoiceInput({ name: 'Bad', kind: 'robot' })).toBeUndefined();
    expect(parseCreateTtsVoiceInput({ name: 'Bad', kind: 'clone' })).toBeUndefined();
    expect(parseCreateTtsVoiceInput({ name: 'Bad', kind: 'clone', embedding: [] })).toBeUndefined();
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

describe('TTS speak route helpers', () => {
  it('parses a speak request with voice resolution fields', () => {
    expect(parseSpeakTtsInput({
      text: 'PAN-829 passed review',
      source: 'review-specialist',
      eventType: 'reviewStatus.passed',
      issueId: 'PAN-829',
      priority: 1,
      voiceId: 'voice-1',
      preview: true,
    })).toEqual({
      text: 'PAN-829 passed review',
      source: 'review-specialist',
      eventType: 'reviewStatus.passed',
      issueId: 'PAN-829',
      priority: 1,
      voiceId: 'voice-1',
      preview: true,
    });
  });

  it('parses a direct preview speak request', () => {
    expect(parseSpeakTtsInput({
      text: 'preview voice',
      voice: 'Vivian',
      instruct: 'calm',
      volume: 0.4,
      mode: 'custom',
      embedding: [0.1, 0.2],
    })).toEqual({
      text: 'preview voice',
      voice: 'Vivian',
      instruct: 'calm',
      volume: 0.4,
      mode: 'custom',
      embedding: [0.1, 0.2],
    });
  });

  it('rejects invalid speak payloads', () => {
    expect(parseSpeakTtsInput({ text: '' })).toBeUndefined();
    expect(parseSpeakTtsInput({ text: 'bad', mode: 'robot' })).toBeUndefined();
    expect(parseSpeakTtsInput({ text: 'bad', preview: 'yes' })).toBeUndefined();
    expect(parseSpeakTtsInput({ text: 'bad', volume: 2 })).toBeUndefined();
    expect(parseSpeakTtsInput({ text: 'bad', embedding: ['x'] })).toBeUndefined();
  });

  it('returns 200 with spoken true when the resolver speaks', async () => {
    const resolve = vi.fn(async () => 'spoken' as const);

    await expect(speakTts({ text: 'hello' }, { resolveAndSpeak: resolve })).resolves.toEqual({
      status: 200,
      body: { spoken: true, result: 'spoken' },
    });
    expect(resolve).toHaveBeenCalledWith({ text: 'hello' });
  });

  it('returns 200 with spoken false for muted and no-voice results', async () => {
    await expect(speakTts({ text: 'hello' }, { resolveAndSpeak: vi.fn(async () => 'muted' as const) })).resolves.toEqual({
      status: 200,
      body: { spoken: false, result: 'muted' },
    });

    await expect(speakTts({ text: 'hello' }, { resolveAndSpeak: vi.fn(async () => 'no-voice' as const) })).resolves.toEqual({
      status: 200,
      body: { spoken: false, result: 'no-voice' },
    });
  });

  it('returns 503 when the daemon is unavailable', async () => {
    await expect(speakTts({ text: 'hello' }, { resolveAndSpeak: vi.fn(async () => 'daemon-unavailable' as const) })).resolves.toEqual({
      status: 503,
      body: { spoken: false, result: 'daemon-unavailable', error: 'TTS daemon unavailable' },
    });
  });
});

describe('TTS embedding extraction route helpers', () => {
  it('parses extraction requests', () => {
    expect(parseExtractEmbeddingInput({ design: 'warm narrator', text: 'sample text' })).toEqual({
      design: 'warm narrator',
      text: 'sample text',
    });
  });

  it('rejects invalid extraction requests', () => {
    expect(parseExtractEmbeddingInput({ design: '', text: 'sample text' })).toBeUndefined();
    expect(parseExtractEmbeddingInput({ design: 'warm narrator', text: '' })).toBeUndefined();
    expect(parseExtractEmbeddingInput({ design: 1, text: 'sample text' })).toBeUndefined();
  });

  it('proxies extraction requests to the daemon with a 60-second timeout', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 }));

    await expect(extractTtsEmbedding({ design: 'warm narrator', text: 'sample text' }, {
      fetch: fetchImpl,
      host: '127.0.0.1',
      port: 8787,
    })).resolves.toEqual({ status: 200, body: { embedding: [0.1, 0.2] } });

    expect(EXTRACT_EMBEDDING_TIMEOUT_MS).toBe(60_000);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8787/extract-embedding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design: 'warm narrator', text: 'sample text' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('returns 503 when the daemon is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

    await expect(extractTtsEmbedding({ design: 'warm narrator', text: 'sample text' }, {
      fetch: fetchImpl,
      host: '127.0.0.1',
      port: 8787,
    })).resolves.toEqual({ status: 503, body: { error: 'TTS daemon unavailable' } });
  });
});
