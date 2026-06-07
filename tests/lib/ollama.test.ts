import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  spawn: vi.fn(),
  unref: vi.fn(),
}));

vi.mock('child_process', async (importActual) => ({
  ...(await importActual<typeof import('child_process')>()),
  exec: mocks.exec,
  spawn: mocks.spawn,
}));

import {
  OLLAMA_BASE_URL,
  OllamaError,
  assertOllamaModelAvailable,
  checkOllamaModelHealth,
  ensureOllamaServeRunning,
  isOllamaInstalled,
  resolveOllamaBaseUrl,
} from '../../src/lib/ollama.js';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('ollama lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    mocks.exec.mockImplementation((_command: string, _options: unknown, callback: ExecCallback) => {
      callback(null, 'ollama version is 0.12.0', '');
    });
    mocks.spawn.mockReturnValue({ pid: 1234, unref: mocks.unref });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves the default localhost base URL and validates configured localhost URLs', () => {
    expect(resolveOllamaBaseUrl()).toBe(OLLAMA_BASE_URL);
    expect(resolveOllamaBaseUrl({ models: { providers: { ollama: { base_url: 'http://127.0.0.1:11434/' } } } })).toBe('http://127.0.0.1:11434');
    expect(resolveOllamaBaseUrl({ models: { providers: { ollama: true } } })).toBe(OLLAMA_BASE_URL);
  });

  it('rejects non-localhost base URLs', () => {
    expect(() => resolveOllamaBaseUrl({ models: { providers: { ollama: { base_url: 'https://example.com' } } } })).toThrow(OllamaError);
    expect(() => resolveOllamaBaseUrl({ models: { providers: { ollama: { base_url: 'http://192.168.1.10:11434' } } } })).toThrow(/localhost/);
  });

  it('detects whether the ollama binary is installed with async exec', async () => {
    await expect(isOllamaInstalled()).resolves.toBe(true);
    expect(mocks.exec).toHaveBeenCalledWith('ollama --version', { timeout: 5_000 }, expect.any(Function));

    mocks.exec.mockImplementationOnce((_command: string, _options: unknown, callback: ExecCallback) => {
      callback(new Error('missing'), '', '');
    });
    await expect(isOllamaInstalled()).resolves.toBe(false);
  });

  it('does not spawn ollama serve when the endpoint already responds', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse({ models: [] }));

    await ensureOllamaServeRunning();

    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('spawns ollama serve when the endpoint is initially unreachable', async () => {
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(okResponse({ models: [] }));

    await ensureOllamaServeRunning();

    expect(mocks.spawn).toHaveBeenCalledWith('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(mocks.unref).toHaveBeenCalledOnce();
  });

  it('reports endpoint unreachable separately from missing models', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('connection refused'));

    const health = await checkOllamaModelHealth('gemma3:12b');

    expect(health).toMatchObject({ endpointReachable: false, modelPresent: false, models: [] });
    expect(health.message).toContain('ollama serve');
  });

  it('reports a missing model with an actionable pull command', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse({ models: [{ name: 'llama3.2:3b' }] }));

    const health = await checkOllamaModelHealth('gemma3:12b');

    expect(health.endpointReachable).toBe(true);
    expect(health.modelPresent).toBe(false);
    expect(health.message).toContain('ollama pull gemma3:12b');
  });

  it('asserts model availability only when the endpoint is reachable and the model is present', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse({ models: [{ name: 'gemma3:12b' }] }));
    await expect(assertOllamaModelAvailable('gemma3:12b')).resolves.toBeUndefined();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse({ models: [{ name: 'llama3.2:3b' }] }));
    await expect(assertOllamaModelAvailable('gemma3:12b')).rejects.toThrow(/ollama pull gemma3:12b/);
  });
});
