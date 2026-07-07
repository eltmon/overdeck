import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OLLAMA_MODEL, ensureOllama, OllamaEnsureError } from '../ollama.js';

function response(ok: boolean): Response {
  return { ok } as Response;
}

describe('ensureOllama', () => {
  it('returns without installing or pulling when localhost Ollama is healthy', async () => {
    const fetchImpl = vi.fn(async () => response(true));
    const runCommand = vi.fn(async () => {});
    const installOllama = vi.fn(async () => {});

    const result = await ensureOllama({ fetchImpl, runCommand, installOllama });

    expect(result).toEqual({
      status: 'already-running',
      baseUrl: 'http://localhost:11434',
      model: DEFAULT_OLLAMA_MODEL,
    });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:11434/api/tags', { method: 'GET' });
    expect(runCommand).not.toHaveBeenCalled();
    expect(installOllama).not.toHaveBeenCalled();
  });

  it('installs, pulls nomic-embed-text, and resolves after the health check passes', async () => {
    vi.useFakeTimers();
    try {
      const health = [false, false, true];
      const fetchImpl = vi.fn(async () => response(health.shift() ?? true));
      const installOllama = vi.fn(async () => {});
      const runCommand = vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === '--version') throw new Error('missing binary');
      });

      const resultPromise = ensureOllama({
        autoInstall: true,
        retryDelayMs: 100,
        maxHealthAttempts: 3,
        fetchImpl,
        runCommand,
        installOllama,
      });

      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result).toEqual({
        status: 'started',
        baseUrl: 'http://localhost:11434',
        model: 'nomic-embed-text',
      });
      expect(installOllama).toHaveBeenCalledOnce();
      expect(runCommand.mock.calls).toEqual([
        ['ollama', ['--version']],
        ['ollama', ['pull', 'nomic-embed-text']],
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects non-localhost base URLs before command execution', async () => {
    const runCommand = vi.fn(async () => {});

    await expect(ensureOllama({ baseUrl: 'https://example.com:11434', runCommand })).rejects.toBeInstanceOf(OllamaEnsureError);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('keeps the PAN-1641 coordination note in the shared helper', async () => {
    const sourcePath = fileURLToPath(new URL('../ollama.ts', import.meta.url));
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain('PAN-1641 coordination note');
    expect(source).toContain('future Pi-harness sidecar');
  });
});
