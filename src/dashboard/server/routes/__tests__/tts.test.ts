import { describe, expect, it, vi } from 'vitest';
import { checkTtsHealth } from '../tts.js';

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
