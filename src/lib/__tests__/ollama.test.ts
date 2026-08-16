import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  checkOllamaHealth,
  DEFAULT_OLLAMA_MODEL,
  ensureOllama,
  ensureOllamaServeRunning,
  OllamaEnsureError,
  OllamaError,
  resolveOllamaBaseUrl,
} from '../ollama.js';

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'linux'),
}));

function response(ok: boolean): Response {
  return { ok } as Response;
}

describe('ensureOllama', () => {
  it('pulls the model when localhost Ollama is healthy', async () => {
    const fetchImpl = vi.fn(async () => response(true));
    const runCommand = vi.fn(async () => {});
    const installOllama = vi.fn(async () => {});
    const startServer = vi.fn(async () => {});

    const result = await ensureOllama({ fetchImpl, runCommand, installOllama, startServer });

    expect(result).toEqual({
      status: 'already-running',
      baseUrl: 'http://localhost:11434',
      model: DEFAULT_OLLAMA_MODEL,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
    expect(runCommand).toHaveBeenCalledWith('ollama', ['pull', DEFAULT_OLLAMA_MODEL]);
    expect(startServer).not.toHaveBeenCalled();
    expect(installOllama).not.toHaveBeenCalled();
  });

  it('installs, starts a stopped server, pulls nomic-embed-text, and resolves after the health check passes', async () => {
    vi.useFakeTimers();
    try {
      const health = [false, false, true];
      const fetchImpl = vi.fn(async () => response(health.shift() ?? true));
      const installOllama = vi.fn(async () => {});
      const startServer = vi.fn(async () => {});
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
        startServer,
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result).toEqual({
        status: 'started',
        baseUrl: 'http://localhost:11434',
        model: 'nomic-embed-text',
      });
      expect(installOllama).toHaveBeenCalledOnce();
      expect(startServer).toHaveBeenCalledOnce();
      expect(runCommand.mock.calls).toEqual([
        ['ollama', ['--version']],
        ['ollama', ['pull', 'nomic-embed-text']],
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a stopped server without auto-install when the binary already exists', async () => {
    vi.useFakeTimers();
    try {
      const health = [false, true, true];
      const fetchImpl = vi.fn(async () => response(health.shift() ?? true));
      const startServer = vi.fn(async () => {});
      const runCommand = vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === '--version') return;
      });

      const resultPromise = ensureOllama({
        retryDelayMs: 100,
        maxHealthAttempts: 3,
        fetchImpl,
        runCommand,
        startServer,
      });

      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result).toEqual({
        status: 'started',
        baseUrl: 'http://localhost:11434',
        model: DEFAULT_OLLAMA_MODEL,
      });
      expect(startServer).toHaveBeenCalledOnce();
      expect(runCommand.mock.calls).toEqual([
        ['ollama', ['--version']],
        ['ollama', ['pull', 'nomic-embed-text']],
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses unsafe curl|sh auto-install on Linux and points to manual install', async () => {
    vi.mocked(platform).mockReturnValue('linux');
    const fetchImpl = vi.fn(async () => response(false));
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === '--version') throw new Error('missing binary');
    });

    await expect(ensureOllama({ autoInstall: true, fetchImpl, runCommand })).rejects.toBeInstanceOf(OllamaEnsureError);
    expect(runCommand).toHaveBeenCalledWith('ollama', ['--version']);
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

describe('Pi harness Ollama lifecycle', () => {
  it('resolves the default and configured localhost base URLs and rejects remote hosts', () => {
    expect(resolveOllamaBaseUrl()).toBe('http://localhost:11434');
    expect(resolveOllamaBaseUrl({ providers: { ollama: { base_url: 'http://127.0.0.1:22434/' } } }))
      .toBe('http://127.0.0.1:22434');
    expect(() => resolveOllamaBaseUrl({ providers: { ollama: { base_url: 'https://ollama.example.com' } } }))
      .toThrow(OllamaError);
    expect(() => resolveOllamaBaseUrl({ providers: { ollama: { base_url: 'http://127.999.888.777:11434' } } }))
      .toThrow(OllamaError);
  });

  it('cancels readiness response bodies after each probe', async () => {
    const cancel = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({ ok: true, body: { cancel } }) as unknown as Response);

    await ensureOllamaServeRunning({ fetchImpl });

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('aborts a readiness probe that does not respond', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const runCommand = vi.fn(async () => { throw new Error('missing'); });

      const result = ensureOllamaServeRunning({ fetchImpl, runCommand });
      const rejection = expect(result).rejects.toMatchObject({ code: 'not-installed' });
      await vi.advanceTimersByTimeAsync(5_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a stalled health response body and cancels it', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(async () => {});
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        return Promise.resolve({
          ok: true,
          body: { cancel },
          json: () => new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
        } as unknown as Response);
      });

      const result = checkOllamaHealth('ollama:gemma4:12b', undefined, fetchImpl);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(result).resolves.toMatchObject({ endpointReachable: false, modelPresent: false });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not spawn ollama serve when the endpoint already responds', async () => {
    const fetchImpl = vi.fn(async () => response(true));
    const runCommand = vi.fn(async () => {});
    const startServer = vi.fn(async () => {});

    await ensureOllamaServeRunning({ fetchImpl, runCommand, startServer });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(runCommand).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
  });

  it('starts an installed Ollama server asynchronously and waits until it responds', async () => {
    vi.useFakeTimers();
    try {
      const health = [false, false, true];
      const fetchImpl = vi.fn(async () => response(health.shift() ?? true));
      const runCommand = vi.fn(async () => {});
      const startServer = vi.fn(async () => {});

      const result = ensureOllamaServeRunning({
        fetchImpl,
        runCommand,
        startServer,
        retryDelayMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);
      await result;

      expect(runCommand).toHaveBeenCalledWith('ollama', ['--version']);
      expect(startServer).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces one 30-second startup deadline for a stalled endpoint', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const result = ensureOllamaServeRunning({
        knownUnhealthy: true,
        fetchImpl,
        runCommand: vi.fn(async () => {}),
        startServer: vi.fn(async () => {}),
      });
      const rejection = expect(result).rejects.toMatchObject({ code: 'start-failed' });

      await vi.advanceTimersByTimeAsync(30_000);

      await rejection;
      expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries connection refusal every second and succeeds once the endpoint responds', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const fetchImpl = vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('connection refused');
        return response(true);
      });
      const result = ensureOllamaServeRunning({
        knownUnhealthy: true,
        fetchImpl,
        runCommand: vi.fn(async () => {}),
        startServer: vi.fn(async () => {}),
      });

      await vi.advanceTimersByTimeAsync(2_000);
      await result;

      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes an unreachable endpoint from a model that is not pulled', async () => {
    const unreachable = await checkOllamaHealth(
      'ollama:gemma3:12b',
      undefined,
      vi.fn(async () => { throw new Error('connection refused'); }),
    );
    expect(unreachable).toMatchObject({ endpointReachable: false, modelPresent: false });
    expect(unreachable.message).toContain('ollama serve');

    const missing = await checkOllamaHealth(
      'ollama:gemma3:12b',
      undefined,
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3:latest' }] }),
      }) as Response),
    );
    expect(missing).toMatchObject({ endpointReachable: true, modelPresent: false });
    expect(missing.message).toContain('ollama pull gemma3:12b');
  });

  it('wraps malformed tag responses in a typed Ollama error', async () => {
    const result = checkOllamaHealth(
      'ollama:gemma3:12b',
      undefined,
      vi.fn(async () => ({
        ok: true,
        json: async () => { throw new SyntaxError('bad json'); },
      }) as Response),
    );

    await expect(result).rejects.toMatchObject({
      name: 'OllamaError',
      code: 'endpoint-unreachable',
    });
  });
});
