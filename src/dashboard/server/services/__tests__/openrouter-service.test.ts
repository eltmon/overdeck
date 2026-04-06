import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { OpenRouterService, OpenRouterServiceLive } from '../openrouter-service.js';

// ─── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function makeModelRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: 'qwen/qwen3.6-plus:free',
    name: 'Qwen 3.6 Plus (free)',
    pricing: { prompt: '0', completion: '0' },
    context_length: 32768,
    ...overrides,
  };
}

function run<A>(effect: Effect.Effect<A, never, OpenRouterService>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, OpenRouterServiceLive));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('openrouter-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchModels', () => {
    it('returns typed model list from API response', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({
        data: [
          makeModelRaw(),
          makeModelRaw({
            id: 'anthropic/claude-3.5-sonnet',
            name: 'Claude 3.5 Sonnet',
            pricing: { prompt: '0.000003', completion: '0.000015' },
            context_length: 200000,
          }),
        ],
      }));

      const models = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.fetchModels();
      }));

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'qwen/qwen3.6-plus:free',
        promptCostPer1M: 0,
        completionCostPer1M: 0,
        contextLength: 32768,
        category: 'free',
        topProvider: 'Qwen',
      });
      expect(models[1]).toMatchObject({
        id: 'anthropic/claude-3.5-sonnet',
        promptCostPer1M: 3,
        completionCostPer1M: 15,
        contextLength: 200000,
        topProvider: 'Anthropic',
      });
    });

    it('caches results — skips second fetch within TTL', async () => {
      mockFetch.mockResolvedValue(makeResponse({ data: [makeModelRaw()] }));

      await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        yield* svc.fetchModels();
        yield* svc.fetchModels();
      }));

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns empty array on network error with no cache', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const models = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.fetchModels();
      }));

      expect(models).toEqual([]);
    });

    it('detects thinking support from architecture modality', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({
        data: [makeModelRaw({ id: 'qwen/qwq-32b', name: 'QwQ 32B', architecture: { modality: 'text+reasoning' } })],
      }));

      const models = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.fetchModels();
      }));

      expect(models[0]?.supportsThinking).toBe(true);
    });

    it('classifies code models correctly', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({
        data: [makeModelRaw({ id: 'deepseek/deepseek-coder-v2', name: 'DeepSeek Coder V2' })],
      }));

      const models = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.fetchModels();
      }));

      expect(models[0]?.category).toBe('code');
    });
  });

  describe('validateApiKey', () => {
    it('returns valid:true for 200 response', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ data: {} }, 200));

      const result = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.validateApiKey('sk-or-valid-key');
      }));

      expect(result).toEqual({ valid: true });
    });

    it('returns valid:false with error for 401', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, 401));

      const result = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.validateApiKey('bad-key');
      }));

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('returns valid:false on network error without throwing', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.validateApiKey('any-key');
      }));

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('getModelCapabilities', () => {
    it('returns model by ID after populating cache', async () => {
      mockFetch.mockResolvedValue(makeResponse({
        data: [makeModelRaw({ id: 'qwen/qwen3.6-plus:free', name: 'Qwen 3.6 Plus' })],
      }));

      const caps = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        // Populate cache first
        yield* svc.fetchModels();
        return yield* svc.getModelCapabilities('qwen/qwen3.6-plus:free');
      }));

      expect(caps).not.toBeNull();
      expect(caps?.id).toBe('qwen/qwen3.6-plus:free');
      expect(caps?.category).toBe('free');
    });

    it('returns null for unknown model ID', async () => {
      mockFetch.mockResolvedValue(makeResponse({ data: [makeModelRaw()] }));

      const caps = await run(Effect.gen(function* () {
        const svc = yield* OpenRouterService;
        return yield* svc.getModelCapabilities('unknown/model');
      }));

      expect(caps).toBeNull();
    });
  });
});
