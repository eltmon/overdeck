import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  checkOllamaHealth,
  DEFAULT_OLLAMA_AGENT_MODEL,
  DEFAULT_OLLAMA_MODEL,
  ensureOllama,
  ensureOllamaServeRunning,
  MIN_OLLAMA_VERSION,
  OLLAMA_MODEL_PREFIX,
  OllamaEnsureError,
  stripOllamaPrefix,
  warmOllamaModel,
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
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:11434/api/tags', { method: 'GET' });
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

const BASE_URL = 'http://localhost:11434';

interface FetchCall {
  url: string;
  signal?: AbortSignal | null;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A fetch double that records every call and dispatches on the URL suffix. */
function recordingFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response> | Response,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, signal: init?.signal });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('stripOllamaPrefix', () => {
  it('strips only the ollama: prefix and leaves tags containing colons intact', () => {
    expect(OLLAMA_MODEL_PREFIX).toBe('ollama:');
    expect(stripOllamaPrefix('ollama:gemma4:12b')).toBe('gemma4:12b');
    expect(stripOllamaPrefix('gemma4:12b')).toBe('gemma4:12b');
    expect(stripOllamaPrefix('claude-opus-5')).toBe('claude-opus-5');
    expect(DEFAULT_OLLAMA_AGENT_MODEL).toBe('gemma4:12b');
  });
});

describe('checkOllamaHealth', () => {
  it('aborts and reports the endpoint unreachable when the /api/tags body never resolves', async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl, calls } = recordingFetch((url) => {
        if (url.endsWith('/api/version')) return jsonResponse({ version: '0.19.0' });
        return { ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response;
      });

      const healthPromise = checkOllamaHealth('gemma4:12b', BASE_URL, { fetchImpl });
      await vi.advanceTimersByTimeAsync(5_000);
      const health = await healthPromise;

      expect(health.endpointReachable).toBe(false);
      expect(health.message).toContain(BASE_URL);
      expect(calls.map((call) => call.url)).toEqual([
        `${BASE_URL}/api/version`,
        `${BASE_URL}/api/tags`,
      ]);
      expect(calls.every((call) => call.signal?.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a server older than the minimum Anthropic-API release', async () => {
    const { fetchImpl } = recordingFetch((url) =>
      url.endsWith('/api/version')
        ? jsonResponse({ version: '0.13.5' })
        : jsonResponse({ models: [{ name: 'gemma4:12b', model: 'gemma4:12b' }] }),
    );

    const health = await checkOllamaHealth('gemma4:12b', BASE_URL, { fetchImpl });

    expect(health.endpointReachable).toBe(true);
    expect(health.version).toBe('0.13.5');
    expect(health.versionSupported).toBe(false);
    expect(health.message).toContain(MIN_OLLAMA_VERSION);
  });

  it('accepts a supported version and matches the pulled tag through the ollama: prefix', async () => {
    const { fetchImpl } = recordingFetch((url) =>
      url.endsWith('/api/version')
        ? jsonResponse({ version: '0.14.0' })
        : jsonResponse({ models: [{ name: 'gemma4:12b', model: 'gemma4:12b' }] }),
    );

    const health = await checkOllamaHealth('ollama:gemma4:12b', BASE_URL, { fetchImpl });

    expect(health).toEqual({
      endpointReachable: true,
      version: '0.14.0',
      versionSupported: true,
      modelPresent: true,
      message: undefined,
    });
  });

  it('matches a tag without an explicit version against <tag>:latest', async () => {
    const { fetchImpl } = recordingFetch((url) =>
      url.endsWith('/api/version')
        ? jsonResponse({ version: '0.19.0' })
        : jsonResponse({ models: [{ name: 'qwen3:latest', model: 'qwen3:latest' }] }),
    );

    await expect(checkOllamaHealth('qwen3', BASE_URL, { fetchImpl })).resolves.toMatchObject({
      modelPresent: true,
    });
  });

  it('tells the operator to pull a tag the server does not have', async () => {
    const { fetchImpl } = recordingFetch((url) =>
      url.endsWith('/api/version') ? jsonResponse({ version: '0.19.0' }) : jsonResponse({ models: [] }),
    );

    const health = await checkOllamaHealth('gemma4:12b', BASE_URL, { fetchImpl });

    expect(health.modelPresent).toBe(false);
    expect(health.message).toContain('ollama pull gemma4:12b');
  });
});

describe('ensureOllamaServeRunning', () => {
  it('skips the pre-start probe when knownUnhealthy and fails on one overall deadline', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const { fetchImpl, calls } = recordingFetch(() => new Promise<Response>(() => {}));
      let probesBeforeStart = -1;
      const startServer = vi.fn(async () => {
        probesBeforeStart = calls.length;
      });

      const running = ensureOllamaServeRunning({
        baseUrl: BASE_URL,
        contextLength: 65_536,
        knownUnhealthy: true,
        fetchImpl,
        startServer,
      });
      const rejection = expect(running).rejects.toBeInstanceOf(OllamaEnsureError);

      await vi.advanceTimersByTimeAsync(29_999);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;

      expect(probesBeforeStart).toBe(0);
      expect(startServer).toHaveBeenCalledOnce();
      expect(startServer.mock.calls[0]?.[0]).toMatchObject({
        OLLAMA_HOST: 'localhost:11434',
        OLLAMA_CONTEXT_LENGTH: '65536',
      });
      expect(Date.now() - startedAt).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the startup deadline in the failure message', async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl } = recordingFetch(() => new Promise<Response>(() => {}));
      const running = ensureOllamaServeRunning({
        baseUrl: BASE_URL,
        contextLength: 65_536,
        knownUnhealthy: true,
        fetchImpl,
        startServer: async () => {},
      });
      const rejection = expect(running).rejects.toThrow(/did not become healthy at http:\/\/localhost:11434 within 30s/);

      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns without starting a server when the endpoint is already healthy', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ models: [] }));
    const startServer = vi.fn(async () => {});

    await ensureOllamaServeRunning({ baseUrl: BASE_URL, contextLength: 65_536, fetchImpl, startServer });

    expect(startServer).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('polls until the started server answers', async () => {
    vi.useFakeTimers();
    try {
      const health = [false, false, true];
      const { fetchImpl } = recordingFetch(() => {
        const ok = health.shift() ?? true;
        return { ok, status: ok ? 200 : 503 } as unknown as Response;
      });
      const startServer = vi.fn(async () => {});

      const running = ensureOllamaServeRunning({
        baseUrl: BASE_URL,
        contextLength: 65_536,
        knownUnhealthy: true,
        fetchImpl,
        startServer,
      });

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(running).resolves.toBeUndefined();
      expect(startServer).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('warmOllamaModel', () => {
  it('loads the tag and reports the context length the server assigned it', async () => {
    const { fetchImpl, calls } = recordingFetch((url) => {
      if (url.endsWith('/api/generate')) return jsonResponse({ done: true });
      return jsonResponse({ models: [{ name: 'gemma4:12b', model: 'gemma4:12b', context_length: 65_536 }] });
    });

    await expect(warmOllamaModel('gemma4:12b', BASE_URL, { fetchImpl })).resolves.toEqual({
      contextLength: 65_536,
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE_URL}/api/generate`,
      `${BASE_URL}/api/ps`,
    ]);
  });

  it('posts the bare tag with an empty prompt', async () => {
    let body: string | undefined;
    const { fetchImpl } = recordingFetch((url, init) => {
      if (url.endsWith('/api/generate')) {
        body = init?.body as string;
        return jsonResponse({ done: true });
      }
      return jsonResponse({ models: [{ name: 'gemma4:12b', context_length: 32_768 }] });
    });

    await warmOllamaModel('ollama:gemma4:12b', BASE_URL, { fetchImpl });

    expect(JSON.parse(body ?? '{}')).toEqual({ model: 'gemma4:12b', prompt: '' });
  });

  it('throws with the tag when /api/ps does not report a context length', async () => {
    const { fetchImpl } = recordingFetch((url) =>
      url.endsWith('/api/generate') ? jsonResponse({ done: true }) : jsonResponse({ models: [] }),
    );

    await expect(warmOllamaModel('gemma4:12b', BASE_URL, { fetchImpl })).rejects.toThrow(/gemma4:12b/);
  });
});
