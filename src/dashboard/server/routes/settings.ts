import { jsonResponse } from "../http-helpers.js";
/**
 * Settings route module — Effect HttpRouter.Layer (PAN-428 B15)
 *
 * Implements all /api/settings/* endpoints from the Express server:
 *   GET  /api/settings
 *   GET  /api/settings/available-models
 *   GET  /api/settings/optimal-defaults
 *   POST /api/settings/test-api-key
 *   POST /api/settings/validate-api-key
 *   PUT  /api/settings
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  loadSettingsApi,
  saveSettingsApi,
  validateSettingsApi,
  getAvailableModelsApi,
  getOptimalDefaultsApi,
  getMiniMaxDefaultsApi,
  saveOpenRouterFavorites,
  getOpenRouterFavorites,
  updateProviderApiKey,
} from '../../../lib/settings-api.js';
import { getClaudeAuthStatus } from '../../../lib/claude-auth.js';
import { getOpenAIAuthStatus } from '../../../lib/openai-auth.js';
import { getProviderForModel, PROVIDERS } from '../../../lib/providers.js';
import { OpenRouterService } from '../services/openrouter-service.js';
import { httpHandler } from './http-handler.js';
import { getProviderAuthMode, getProviderEnvForModel } from '../../../lib/agents.js';
import { canUseHarness } from '../../../lib/harness-policy.js';
import {
  detectProviderEnvConflicts,
} from '../../../lib/claude-settings-overlay.js';

// ─── Local helpers ────────────────────────────────────────────────────────────

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

/** Model ID to API model ID mapping */
const MODEL_API_IDS: Record<string, { apiModel: string; endpoint?: string }> = {
  // OpenAI models — gpt-5.x are real OpenAI model IDs (identity map).
  // Codex sign-in routes through CLIProxy; API key routes direct.
  'gpt-5.5-pro': { apiModel: 'gpt-5.5-pro' },
  'gpt-5.5': { apiModel: 'gpt-5.5' },
  'gpt-5.4-pro': { apiModel: 'gpt-5.4-pro' },
  'gpt-5.4': { apiModel: 'gpt-5.4' },
  'gpt-5.4-mini': { apiModel: 'gpt-5.4-mini' },
  'gpt-5.3-codex': { apiModel: 'gpt-5.3-codex' },
  'gpt-5.2': { apiModel: 'gpt-5.2' },
  'o3': { apiModel: 'o3' },
  'o4-mini': { apiModel: 'o4-mini' },
  'o3-deep-research': { apiModel: 'gpt-4o' },
  'gpt-4o': { apiModel: 'gpt-4o' },
  'gpt-4o-mini': { apiModel: 'gpt-4o-mini' },
  'o1': { apiModel: 'gpt-4o' },
  'o3-mini': { apiModel: 'gpt-4o-mini' },
  // Google models
  'gemini-3-pro-preview': { apiModel: 'gemini-1.5-pro' },
  'gemini-3-flash-preview': { apiModel: 'gemini-1.5-flash' },
  'gemini-2.5-pro': { apiModel: 'gemini-1.5-pro' },
  'gemini-2.5-flash': { apiModel: 'gemini-1.5-flash' },
  // Kimi models
  'kimi-k2': { apiModel: 'moonshot-v1-8k' },
  'kimi-k2.5': { apiModel: 'moonshot-v1-32k' },
  'kimi-k2-turbo': { apiModel: 'moonshot-v1-8k' },
  'K2.6-code-preview': { apiModel: 'K2.6-code-preview' },
  // MiniMax models
  'minimax-m2.7': { apiModel: 'minimax-m2.7' },
  'minimax-m2.7-highspeed': { apiModel: 'minimax-m2.7-highspeed' },
  // Z.AI models
  'glm-5.1': { apiModel: 'glm-5.1' },
  'glm-4.7': { apiModel: 'glm-4.7' },
  'glm-4.7-flash': { apiModel: 'glm-4.7-flash' },
  // MiMo models
  'mimo-v2.5-pro': { apiModel: 'mimo-v2.5-pro' },
  'mimo-v2.5': { apiModel: 'mimo-v2.5' },
};

// ─── Route: GET /api/settings ─────────────────────────────────────────────────

const getSettingsRoute = HttpRouter.add(
  'GET',
  '/api/settings',
  httpHandler(Effect.try({
    try: () => jsonResponse(loadSettingsApi()),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/settings/available-models ────────────────────────────────

const getAvailableModelsRoute = HttpRouter.add(
  'GET',
  '/api/settings/available-models',
  httpHandler(Effect.try({
    try: () => jsonResponse(getAvailableModelsApi()),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/settings/optimal-defaults ───────────────────────────────

const getOptimalDefaultsRoute = HttpRouter.add(
  'GET',
  '/api/settings/optimal-defaults',
  httpHandler(Effect.try({
    try: () => jsonResponse(getOptimalDefaultsApi()),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/settings/minimax-defaults ───────────────────────────────

const getMiniMaxDefaultsRoute = HttpRouter.add(
  'GET',
  '/api/settings/minimax-defaults',
  httpHandler(Effect.try({
    try: () => jsonResponse(getMiniMaxDefaultsApi()),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/settings/claude-auth ────────────────────────────────────

const getClaudeAuthRoute = HttpRouter.add(
  'GET',
  '/api/settings/claude-auth',
  httpHandler(Effect.gen(function* () {
    const status = yield* Effect.promise(() => getClaudeAuthStatus());
    return jsonResponse(status);
  })),
);

// ─── Route: GET /api/settings/openai-auth ────────────────────────────────────

const getOpenAIAuthRoute = HttpRouter.add(
  'GET',
  '/api/settings/openai-auth',
  httpHandler(Effect.gen(function* () {
    const status = yield* Effect.promise(() => getOpenAIAuthStatus());
    return jsonResponse(status);
  })),
);

// ─── Route: POST /api/settings/test-api-key ──────────────────────────────────

const postTestApiKeyRoute = HttpRouter.add(
  'POST',
  '/api/settings/test-api-key',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { provider, apiKey, model } = body as Record<string, string | undefined>;

    if (!provider || !apiKey) {
      return jsonResponse({ error: 'Provider and apiKey are required' }, { status: 400 });
    }

    // Test the API key by sending a minimal prompt. Errors are returned as
    // response data (success: false, error: '...') rather than HTTP errors,
    // since partial failures (wrong model, rate limits) are expected and useful.
    return yield* Effect.promise(async () => {
      let success = false;
      let error: string | null = null;
      let response: string | null = null;
      let latencyMs = 0;
      const testPrompt = 'What is 2+3? Reply with just the number.';
      const expectedAnswer = '5';
      const startTime = Date.now();

      switch (provider) {
        case 'openai': {
          const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'gpt-4o-mini') : 'gpt-4o-mini';
          try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: apiModel, messages: [{ role: 'user', content: testPrompt }], max_tokens: 10 }),
            });
            latencyMs = Date.now() - startTime;
            if (resp.ok) {
              const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
              response = data.choices?.[0]?.message?.content?.trim() || '';
              success = response.includes(expectedAnswer);
              if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 404) {
              error = `Model not found: ${apiModel}`;
            } else {
              error = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 100)}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'google': {
          const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'gemini-1.5-flash') : 'gemini-1.5-flash';
          try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: testPrompt }] }], generationConfig: { maxOutputTokens: 10 } }),
            });
            latencyMs = Date.now() - startTime;
            if (resp.ok) {
              const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
              response = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              success = response.includes(expectedAnswer);
              if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
            } else if (resp.status === 400 || resp.status === 403) {
              error = 'Invalid API key';
            } else if (resp.status === 404) {
              error = `Model not found: ${apiModel}`;
            } else {
              error = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 100)}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'kimi': {
          const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'K2.6-code-preview') : 'K2.6-code-preview';
          try {
            const resp = await fetch(`${PROVIDERS.kimi.baseUrl}v1/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: apiModel, messages: [{ role: 'user', content: testPrompt }], max_tokens: 10 }),
            });
            latencyMs = Date.now() - startTime;
            const responseText = await resp.text();
            if (resp.ok) {
              try {
                const data = JSON.parse(responseText) as { content?: Array<{ text?: string }> };
                response = data.content?.[0]?.text?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } catch {
                error = `Kimi returned non-JSON response: ${responseText.slice(0, 100)}`;
              }
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 404) {
              error = `Model not found: ${apiModel}`;
            } else {
              error = `HTTP ${resp.status}: ${responseText.slice(0, 100)}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'minimax': {
          const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'minimax-m2.7') : 'minimax-m2.7';
          try {
            const resp = await fetch('https://api.minimax.io/anthropic/v1/messages', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: apiModel, messages: [{ role: 'user', content: testPrompt }], max_tokens: 10 }),
            });
            latencyMs = Date.now() - startTime;
            const contentType = resp.headers.get('content-type');
            const location = resp.headers.get('location');
            const responseText = await resp.text();
            console.error('[settings:test-api-key:minimax]', JSON.stringify({
              status: resp.status,
              redirected: resp.redirected,
              url: resp.url,
              location,
              contentType,
              bodyPreview: responseText.slice(0, 300),
            }));
            if (resp.ok) {
              try {
                const data = JSON.parse(responseText) as { content?: Array<{ text?: string }>; usage?: unknown };
                console.error('[settings:test-api-key:minimax:parsed]', JSON.stringify({
                  hasContent: Array.isArray(data.content),
                  usageType: typeof data.usage,
                  keys: Object.keys(data),
                }));
                response = data.content?.[0]?.text?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } catch (parseErr) {
                console.error('[settings:test-api-key:minimax:parse-error]', parseErr);
                error = `MiniMax returned non-JSON response: ${responseText.slice(0, 100)}`;
              }
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 404) {
              error = `Model not found: ${apiModel}`;
            } else {
              error = `HTTP ${resp.status}: ${responseText.slice(0, 100)}`;
            }
          } catch (err) {
            console.error('[settings:test-api-key:minimax:request-error]', err);
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'zai': {
          const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'glm-5.1') : 'glm-5.1';
          try {
            const resp = await fetch('https://api.z.ai/api/anthropic/v1/messages', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: apiModel, messages: [{ role: 'user', content: testPrompt }], max_tokens: 10 }),
            });
            latencyMs = Date.now() - startTime;
            const responseText = await resp.text();
            if (resp.ok) {
              try {
                const data = JSON.parse(responseText) as { content?: Array<{ text?: string }> };
                response = data.content?.[0]?.text?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } catch {
                error = `Z.AI returned non-JSON response: ${responseText.slice(0, 100)}`;
              }
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 404) {
              error = `Model not found: ${apiModel}`;
            } else {
              error = `HTTP ${resp.status}: ${responseText.slice(0, 100)}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'mimo': {
          const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'mimo-v2.5-pro') : 'mimo-v2.5-pro';
          try {
            const resp = await fetch('https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: apiModel, messages: [{ role: 'user', content: testPrompt }], max_tokens: 128 }),
            });
            latencyMs = Date.now() - startTime;
            const responseText = await resp.text();
            if (resp.ok) {
              try {
                const data = JSON.parse(responseText) as { content?: Array<{ type?: string; text?: string }> };
                const textBlock = data.content?.find(b => b.type === 'text');
                response = textBlock?.text?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } catch {
                error = `MiMo returned non-JSON response: ${responseText.slice(0, 100)}`;
              }
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 404) {
              error = `Model not found: ${apiModel}`;
            } else {
              error = `HTTP ${resp.status}: ${responseText.slice(0, 100)}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        default:
          error = `Unknown provider: ${provider}`;
      }

      return jsonResponse({ success, error, response, latencyMs, model: model || 'default' });
    });
  })),
);

// ─── Route: POST /api/settings/validate-api-key ──────────────────────────────

const postValidateApiKeyRoute = HttpRouter.add(
  'POST',
  '/api/settings/validate-api-key',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { provider, apiKey } = body as Record<string, string | undefined>;

    if (!provider || !apiKey) {
      return jsonResponse({ error: 'Provider and apiKey are required' }, { status: 400 });
    }

    if (!['openai', 'google', 'kimi', 'minimax', 'zai', 'mimo'].includes(provider)) {
      return jsonResponse({ error: `Unsupported provider: ${provider}` }, { status: 400 });
    }

    // Validate by listing models or sending a probe request. Errors returned as data.
    return yield* Effect.promise(async () => {
      let valid = false;
      let error: string | null = null;
      let models: string[] = [];

      switch (provider) {
        case 'openai': {
          try {
            const resp = await fetch('https://api.openai.com/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (resp.ok) {
              const data = await resp.json() as { data: Array<{ id: string }> };
              valid = true;
              models = data.data
                .map(m => m.id)
                .filter(id => id.includes('gpt-') || id.includes('o1') || id.includes('o3'));
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 429) {
              error = 'Rate limit exceeded';
            } else {
              error = `HTTP error: ${resp.status}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'google': {
          try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: 'test' }] }] }),
            });
            if (resp.ok || resp.status === 400) {
              valid = true;
              models = ['gemini-3-pro-preview', 'gemini-3-flash-preview'];
            } else if (resp.status === 401 || resp.status === 403) {
              error = 'Invalid API key';
            } else if (resp.status === 429) {
              error = 'Rate limit exceeded';
            } else {
              error = `HTTP error: ${resp.status}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'kimi': {
          try {
            const resp = await fetch(`${PROVIDERS.kimi.baseUrl}v1/models`, {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' },
            });
            if (resp.ok) {
              const data = await resp.json() as { data?: Array<{ id: string }> };
              valid = true;
              models = data.data?.map(m => m.id) || ['kimi-k2.5', 'K2.6-code-preview'];
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 429) {
              error = 'Rate limit exceeded';
            } else {
              error = `HTTP error: ${resp.status}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'minimax': {
          try {
            const resp = await fetch('https://api.minimax.io/anthropic/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' },
            });
            if (resp.ok) {
              const data = await resp.json() as { data?: Array<{ id: string }> };
              valid = true;
              models = data.data?.map(m => m.id) || ['minimax-m2.7', 'minimax-m2.7-highspeed'];
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 429) {
              error = 'Rate limit exceeded';
            } else {
              error = `HTTP error: ${resp.status}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'zai': {
          try {
            const resp = await fetch('https://api.z.ai/api/anthropic/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' },
            });
            if (resp.ok) {
              const data = await resp.json() as { data?: Array<{ id: string }> };
              valid = true;
              models = data.data?.map(m => m.id) || ['glm-5.1'];
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 429) {
              error = 'Rate limit exceeded';
            } else {
              error = `HTTP error: ${resp.status}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }

        case 'mimo': {
          // MiMo subscription endpoint does not expose /v1/models; validate via a lightweight messages request
          try {
            const resp = await fetch('https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'mimo-v2.5-pro', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
            });
            if (resp.ok) {
              valid = true;
              models = ['mimo-v2.5-pro', 'mimo-v2.5'];
            } else if (resp.status === 401) {
              error = 'Invalid API key';
            } else if (resp.status === 429) {
              error = 'Rate limit exceeded';
            } else {
              error = `HTTP error: ${resp.status}`;
            }
          } catch (err) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
          }
          break;
        }
      }

      return jsonResponse({ valid, provider, models: valid ? models : undefined, error: error || undefined });
    });
  })),
);

// ─── Route: PUT /api/settings ─────────────────────────────────────────────────

const putSettingsRoute = HttpRouter.add(
  'PUT',
  '/api/settings',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      try {
        const newSettings = body as Parameters<typeof validateSettingsApi>[0];
        const validation = validateSettingsApi(newSettings);
        if (!validation.valid) {
          return jsonResponse({ error: validation.errors.join('; ') }, { status: 400 });
        }
        await saveSettingsApi(newSettings);
        return jsonResponse({
          success: true,
          message: 'Settings saved to config.yaml',
          warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
        });
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    });
  })),
);

// ─── Route: GET /api/settings/openrouter/models ──────────────────────────────

const getOpenRouterModelsRoute = HttpRouter.add(
  'GET',
  '/api/settings/openrouter/models',
  httpHandler(Effect.gen(function* () {
    const orService = yield* OpenRouterService;
    const models = yield* orService.fetchModels();
    const favorites = getOpenRouterFavorites();
    return jsonResponse({ models, favorites });
  })),
);

// ─── Route: PUT /api/settings/openrouter/favorites ───────────────────────────

const putOpenRouterFavoritesRoute = HttpRouter.add(
  'PUT',
  '/api/settings/openrouter/favorites',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { favorites } = body as { favorites?: unknown };

    if (!Array.isArray(favorites)) {
      return jsonResponse({ error: 'favorites must be an array of model IDs' }, { status: 400 });
    }

    const modelIds = favorites.filter((f): f is string => typeof f === 'string');
    return yield* Effect.promise(async () => {
      try {
        await saveOpenRouterFavorites(modelIds);
        return jsonResponse({ success: true, favorites: modelIds });
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    });
  })),
);

// ─── Route: PUT /api/settings/openrouter/api-key ─────────────────────────────

const putOpenRouterApiKeyRoute = HttpRouter.add(
  'PUT',
  '/api/settings/openrouter/api-key',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { apiKey } = body as { apiKey?: unknown };

    if (apiKey !== undefined && typeof apiKey !== 'string') {
      return jsonResponse({ error: 'apiKey must be a string when provided' }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
      try {
        const settings = await updateProviderApiKey('openrouter', apiKey?.trim() || undefined);
        return jsonResponse({
          success: true,
          apiKey: settings.api_keys.openrouter,
          message: 'OpenRouter API key saved',
        });
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    });
  })),
);

// ─── Route: POST /api/settings/openrouter/test-key ───────────────────────────

const postOpenRouterTestKeyRoute = HttpRouter.add(
  'POST',
  '/api/settings/openrouter/test-key',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { apiKey } = body as { apiKey?: string };

    if (!apiKey) {
      return jsonResponse({ error: 'apiKey is required' }, { status: 400 });
    }

    const orService = yield* OpenRouterService;
    const result = yield* orService.validateApiKey(apiKey);
    return jsonResponse(result);
  })),
);

// ─── Route: GET /api/settings/harness-policy ────────────────────────────────

const SAFE_MODEL_PATTERN = /^[a-zA-Z0-9_.:\/-]+$/;
const MAX_HARNESS_POLICY_MODELS = 250;
const MAX_HARNESS_POLICY_MODEL_LENGTH = 200;

const getHarnessPolicyRoute = HttpRouter.add(
  'GET',
  '/api/settings/harness-policy',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(async () => {
      const url = new URL(request.url, 'http://localhost');
      const models = (url.searchParams.get('models') ?? '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean);

      if (
        models.length === 0
        || models.length > MAX_HARNESS_POLICY_MODELS
        || models.some((model) => model.length > MAX_HARNESS_POLICY_MODEL_LENGTH || !SAFE_MODEL_PATTERN.test(model))
      ) {
        return jsonResponse({ error: 'Valid models parameter is required' }, { status: 400 });
      }

      const decisions: Record<string, Record<string, { allowed: boolean; reason?: string }>> = {};
      const authModeByProvider = new Map<string, Awaited<ReturnType<typeof getProviderAuthMode>>>();
      for (const model of Array.from(new Set(models))) {
        const providerName = getProviderForModel(model).name;
        let authMode = authModeByProvider.get(providerName);
        if (!authModeByProvider.has(providerName)) {
          authMode = await getProviderAuthMode(model);
          authModeByProvider.set(providerName, authMode);
        }
        decisions[model] = {
          'claude-code': canUseHarness('claude-code', model, authMode),
          pi: canUseHarness('pi', model, authMode),
        };
      }
      return jsonResponse({ decisions });
    });
  })),
);

// ─── Route: GET /api/settings/provider-env-conflicts ─────────────────────────


const getProviderEnvConflictsRoute = HttpRouter.add(
  'GET',
  '/api/settings/provider-env-conflicts',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(async () => {
      const url = new URL(request.url, 'http://localhost');
      const model = url.searchParams.get('model');
      if (!model || !SAFE_MODEL_PATTERN.test(model)) {
        return jsonResponse({ error: 'Valid model parameter is required' }, { status: 400 });
      }

      try {
        const providerEnv = await getProviderEnvForModel(model);
        const conflicts = await detectProviderEnvConflicts(providerEnv);
        return jsonResponse({ conflicts });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: msg }, { status: 500 });
      }
    });
  })),
);


// ─── Compose all routes into a single Layer ───────────────────────────────────

export const settingsRouteLayer = Layer.mergeAll(
  getSettingsRoute,
  getAvailableModelsRoute,
  getOptimalDefaultsRoute,
  getMiniMaxDefaultsRoute,
  getClaudeAuthRoute,
  getOpenAIAuthRoute,
  postTestApiKeyRoute,
  postValidateApiKeyRoute,
  putSettingsRoute,
  getOpenRouterModelsRoute,
  putOpenRouterFavoritesRoute,
  putOpenRouterApiKeyRoute,
  postOpenRouterTestKeyRoute,
  getHarnessPolicyRoute,
  getProviderEnvConflictsRoute,
);

export default settingsRouteLayer;
