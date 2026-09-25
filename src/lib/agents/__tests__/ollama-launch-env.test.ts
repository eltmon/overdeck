import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkOllamaHealth: vi.fn(),
  ensureOllamaServeRunning: vi.fn(),
  warmOllamaModel: vi.fn(),
  loadConfigSync: vi.fn(),
}));

vi.mock('../../ollama.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ollama.js')>()),
  checkOllamaHealth: mocks.checkOllamaHealth,
  ensureOllamaServeRunning: mocks.ensureOllamaServeRunning,
  warmOllamaModel: mocks.warmOllamaModel,
}));

// Pin the config the export builder reads, so the assertions below do not depend on
// whatever ollama block the host running the tests happens to have.
vi.mock('../../config-yaml.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config-yaml.js')>()),
  loadConfigSync: mocks.loadConfigSync,
}));

import { OllamaEnsureError } from '../../ollama.js';
import { getOllamaLaunchEnv } from '../ollama-launch-env.js';

const OLLAMA = { baseUrl: 'http://localhost:11434', contextLength: 65_536 };

const HEALTHY = {
  endpointReachable: true,
  version: '0.19.0',
  versionSupported: true,
  modelPresent: true,
};

describe('getOllamaLaunchEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.warmOllamaModel.mockResolvedValue({ contextLength: 65_536 });
  });

  it('returns the local launch env with no API key and a localhost endpoint', async () => {
    mocks.checkOllamaHealth.mockResolvedValue(HEALTHY);

    const env = await getOllamaLaunchEnv('ollama:gemma4:12b', OLLAMA);

    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'http://localhost:11434',
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gemma4:12b',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gemma4:12b',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gemma4:12b',
      ANTHROPIC_SMALL_FAST_MODEL: 'gemma4:12b',
      CLAUDE_CODE_SUBAGENT_MODEL: 'gemma4:12b',
      API_TIMEOUT_MS: '600000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '65536',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '65536',
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(mocks.ensureOllamaServeRunning).not.toHaveBeenCalled();
  });

  it('pins both context vars to the warm-loaded window, not the configured one', async () => {
    mocks.checkOllamaHealth.mockResolvedValue(HEALTHY);
    mocks.warmOllamaModel.mockResolvedValue({ contextLength: 131_072 });

    const env = await getOllamaLaunchEnv('ollama:gemma4:12b', OLLAMA);

    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('131072');
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('131072');
  });

  it('starts the server once with knownUnhealthy when nothing answers, then re-probes', async () => {
    mocks.checkOllamaHealth
      .mockResolvedValueOnce({
        endpointReachable: false,
        versionSupported: false,
        modelPresent: false,
        message: 'Ollama is not reachable at http://localhost:11434. Start it with `ollama serve`.',
      })
      .mockResolvedValueOnce(HEALTHY);

    await getOllamaLaunchEnv('ollama:gemma4:12b', OLLAMA);

    expect(mocks.ensureOllamaServeRunning).toHaveBeenCalledTimes(1);
    expect(mocks.ensureOllamaServeRunning).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:11434',
      contextLength: 65_536,
      knownUnhealthy: true,
    });
    expect(mocks.checkOllamaHealth).toHaveBeenCalledTimes(2);
  });

  it('names `ollama pull` when the tag is missing', async () => {
    mocks.checkOllamaHealth.mockResolvedValue({
      endpointReachable: true,
      version: '0.19.0',
      versionSupported: true,
      modelPresent: false,
      message: 'Ollama model gemma4:12b is not pulled. Run `ollama pull gemma4:12b`.',
    });

    await expect(getOllamaLaunchEnv('ollama:gemma4:12b', OLLAMA)).rejects.toThrow(
      /ollama pull gemma4:12b/,
    );
    expect(mocks.warmOllamaModel).not.toHaveBeenCalled();
  });

  it('names the minimum version when the server is too old', async () => {
    mocks.checkOllamaHealth.mockResolvedValue({
      endpointReachable: true,
      version: '0.13.5',
      versionSupported: false,
      modelPresent: true,
      message: 'Ollama 0.13.5 is older than 0.14.0. Upgrade Ollama to 0.14.0 or newer.',
    });

    await expect(getOllamaLaunchEnv('ollama:gemma4:12b', OLLAMA)).rejects.toThrow(/0\.14\.0/);
  });

  it('surfaces the ensure error verbatim when the server never comes up', async () => {
    mocks.checkOllamaHealth.mockResolvedValue({
      endpointReachable: false,
      versionSupported: false,
      modelPresent: false,
    });
    mocks.ensureOllamaServeRunning.mockRejectedValue(
      new OllamaEnsureError('Ollama did not become healthy at http://localhost:11434 within 30s.'),
    );

    await expect(getOllamaLaunchEnv('ollama:gemma4:12b', OLLAMA)).rejects.toThrow(/within 30s/);
  });

  it('turns a missing binary into install guidance instead of a raw spawn error', async () => {
    mocks.checkOllamaHealth.mockResolvedValue({
      endpointReachable: false,
      versionSupported: false,
      modelPresent: false,
    });
    mocks.ensureOllamaServeRunning.mockRejectedValue(
      Object.assign(new Error('spawn ollama ENOENT'), { code: 'ENOENT' }),
    );

    await expect(getOllamaLaunchEnv('ollama:gemma4:12b', OLLAMA)).rejects.toThrow(
      /https:\/\/ollama\.com\/download/,
    );
  });
});

describe('getProviderExportsForModel for an ollama: model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkOllamaHealth.mockResolvedValue(HEALTHY);
    mocks.warmOllamaModel.mockResolvedValue({ contextLength: 65_536 });
    mocks.loadConfigSync.mockReturnValue({ config: { ollama: OLLAMA }, explicitlyDisabled: new Set() });
  });

  it('exports each context pin exactly once and keeps the telemetry opt-out Ollama-only', async () => {
    const { getProviderExportsForModel } = await import('../provider-env.js');

    const script = await getProviderExportsForModel('ollama:gemma4:12b', 'claude-code');
    const exportLines = script.split('\n').filter((line) => line.startsWith('export '));

    expect(exportLines.filter((l) => l.startsWith('export CLAUDE_CODE_MAX_CONTEXT_TOKENS='))).toHaveLength(1);
    expect(exportLines.filter((l) => l.startsWith('export CLAUDE_CODE_AUTO_COMPACT_WINDOW='))).toHaveLength(1);
    expect(exportLines).toContain('export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"');
    expect(exportLines).toContain('export ANTHROPIC_BASE_URL="http://localhost:11434"');
    expect(script).not.toContain('export ANTHROPIC_API_KEY=');
    // The telemetry opt-out is an Ollama-only export: adding it to PROVIDER_ENV_KEYS
    // would emit an `unset` for it on every other provider's launch, silently
    // re-enabling telemetry for an operator who sets it globally.
    expect(script).not.toContain('unset CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC');
  });
});
