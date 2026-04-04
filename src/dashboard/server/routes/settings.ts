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
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  loadSettingsApi,
  saveSettingsApi,
  validateSettingsApi,
  getAvailableModelsApi,
  getOptimalDefaultsApi,
} from '../../../lib/settings-api.js';

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

/** Determine provider from model ID */
function getProviderForModel(modelId: string): 'anthropic' | 'openai' | 'google' | 'kimi' | 'zai' {
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3-') || modelId.startsWith('o1')) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('kimi-')) return 'kimi';
  if (modelId.startsWith('glm-')) return 'zai';
  return 'kimi'; // default
}

/** Model ID to API model ID mapping */
const MODEL_API_IDS: Record<string, { apiModel: string; endpoint?: string }> = {
  // OpenAI models
  'gpt-5.2-codex': { apiModel: 'gpt-4o' },
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
  // Z.AI models
  'glm-4.7': { apiModel: 'glm-4' },
  'glm-4.7-flash': { apiModel: 'glm-4-flash' },
  'glm-4-plus': { apiModel: 'glm-4' },
  'glm-4-air': { apiModel: 'glm-4-air' },
  'glm-4-flash': { apiModel: 'glm-4-flash' },
  'glm-4-long': { apiModel: 'glm-4-long' },
};

// ─── Route: GET /api/settings ─────────────────────────────────────────────────

const getSettingsRoute = HttpRouter.add(
  'GET',
  '/api/settings',
  Effect.gen(function* () {
    return yield* Effect.try({
      try: () => {
        const settings = loadSettingsApi();
        return jsonResponse(settings);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error loading settings:', error);
        return jsonResponse({ error: 'Failed to load settings: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/settings/available-models ────────────────────────────────

const getAvailableModelsRoute = HttpRouter.add(
  'GET',
  '/api/settings/available-models',
  Effect.gen(function* () {
    return yield* Effect.try({
      try: () => {
        const availableModels = getAvailableModelsApi();
        return jsonResponse(availableModels);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error loading available models:', error);
        return jsonResponse({ error: 'Failed to load available models: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/settings/optimal-defaults ───────────────────────────────

const getOptimalDefaultsRoute = HttpRouter.add(
  'GET',
  '/api/settings/optimal-defaults',
  Effect.gen(function* () {
    return yield* Effect.try({
      try: () => {
        const optimalDefaults = getOptimalDefaultsApi();
        return jsonResponse(optimalDefaults);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting optimal defaults:', error);
        return jsonResponse({ error: 'Failed to get optimal defaults: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/settings/test-api-key ──────────────────────────────────

const postTestApiKeyRoute = HttpRouter.add(
  'POST',
  '/api/settings/test-api-key',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { provider, apiKey, model } = body as Record<string, string | undefined>;

    if (!provider || !apiKey) {
      return jsonResponse(
        { error: 'Provider and apiKey are required' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        try {
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
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: apiModel,
                  messages: [{ role: 'user', content: testPrompt }],
                  max_tokens: 10,
                }),
              });
              latencyMs = Date.now() - startTime;

              if (resp.ok) {
                const data = await resp.json() as any;
                response = data.choices?.[0]?.message?.content?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } else if (resp.status === 401) {
                error = 'Invalid API key';
              } else if (resp.status === 404) {
                error = `Model not found: ${apiModel}`;
              } else {
                const errBody = await resp.text();
                error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
              }
            } catch (err: any) {
              error = `Network error: ${err.message}`;
            }
            break;
          }

          case 'google': {
            const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'gemini-1.5-flash') : 'gemini-1.5-flash';
            try {
              const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;
              const resp = await fetch(testUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: testPrompt }] }],
                  generationConfig: { maxOutputTokens: 10 },
                }),
              });
              latencyMs = Date.now() - startTime;

              if (resp.ok) {
                const data = await resp.json() as any;
                response = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } else if (resp.status === 400 || resp.status === 403) {
                error = 'Invalid API key';
              } else if (resp.status === 404) {
                error = `Model not found: ${apiModel}`;
              } else {
                const errBody = await resp.text();
                error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
              }
            } catch (err: any) {
              error = `Network error: ${err.message}`;
            }
            break;
          }

          case 'kimi': {
            const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'moonshot-v1-8k') : 'moonshot-v1-8k';
            try {
              const resp = await fetch('https://api.moonshot.cn/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: apiModel,
                  messages: [{ role: 'user', content: testPrompt }],
                  max_tokens: 10,
                }),
              });
              latencyMs = Date.now() - startTime;

              if (resp.ok) {
                const data = await resp.json() as any;
                response = data.choices?.[0]?.message?.content?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } else if (resp.status === 401) {
                error = 'Invalid API key';
              } else if (resp.status === 404) {
                error = `Model not found: ${apiModel}`;
              } else {
                const errBody = await resp.text();
                error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
              }
            } catch (err: any) {
              error = `Network error: ${err.message}`;
            }
            break;
          }

          case 'zai': {
            const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'glm-4-flash') : 'glm-4-flash';
            try {
              const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: apiModel,
                  messages: [{ role: 'user', content: testPrompt }],
                  max_tokens: 10,
                }),
              });
              latencyMs = Date.now() - startTime;

              if (resp.ok) {
                const data = await resp.json() as any;
                response = data.choices?.[0]?.message?.content?.trim() || '';
                success = response.includes(expectedAnswer);
                if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
              } else if (resp.status === 401) {
                error = 'Invalid API key';
              } else if (resp.status === 404) {
                error = `Model not found: ${apiModel}`;
              } else {
                const errBody = await resp.text();
                error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
              }
            } catch (err: any) {
              error = `Network error: ${err.message}`;
            }
            break;
          }

          default:
            error = `Unknown provider: ${provider}`;
        }

        return jsonResponse({ success, error, response, latencyMs, model: model || 'default' });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error testing API key:', error);
          return jsonResponse({ error: 'Failed to test API key: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/settings/validate-api-key ──────────────────────────────

const postValidateApiKeyRoute = HttpRouter.add(
  'POST',
  '/api/settings/validate-api-key',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { provider, apiKey } = body as Record<string, string | undefined>;

    if (!provider || !apiKey) {
      return jsonResponse(
        { error: 'Provider and apiKey are required' },
        { status: 400 },
      );
    }

    if (!['openai', 'google', 'zai'].includes(provider)) {
      return jsonResponse(
        { error: `Unsupported provider: ${provider}` },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        let valid = false;
        let error: string | null = null;
        let models: string[] = [];

        switch (provider) {
          case 'openai': {
            try {
              const response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
              });

              if (response.ok) {
                const data = await response.json() as any;
                valid = true;
                models = data.data
                  .map((m: any) => m.id as string)
                  .filter((id: string) => id.includes('gpt-') || id.includes('o1') || id.includes('o3'));
              } else if (response.status === 401) {
                error = 'Invalid API key';
              } else if (response.status === 429) {
                error = 'Rate limit exceeded';
              } else {
                error = `HTTP error: ${response.status}`;
              }
            } catch (err: any) {
              error = `Network error: ${err.message}`;
            }
            break;
          }

          case 'google': {
            try {
              const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
              const response = await fetch(testUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: 'test' }] }],
                }),
              });

              if (response.ok || response.status === 400) {
                valid = true;
                models = ['gemini-3-pro-preview', 'gemini-3-flash-preview'];
              } else if (response.status === 401 || response.status === 403) {
                error = 'Invalid API key';
              } else if (response.status === 429) {
                error = 'Rate limit exceeded';
              } else {
                error = `HTTP error: ${response.status}`;
              }
            } catch (err: any) {
              error = `Network error: ${err.message}`;
            }
            break;
          }

          case 'zai': {
            try {
              const response = await fetch('https://api.zai.chat/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
              });

              if (response.ok) {
                const data = await response.json() as any;
                valid = true;
                models = data.data?.map((m: any) => m.id as string) || ['glm-4.7', 'glm-4.7-flash'];
              } else if (response.status === 401) {
                error = 'Invalid API key';
              } else if (response.status === 429) {
                error = 'Rate limit exceeded';
              } else {
                error = `HTTP error: ${response.status}`;
              }
            } catch (err: any) {
              error = `Network error: ${err.message}`;
            }
            break;
          }
        }

        return jsonResponse({
          valid,
          provider,
          models: valid ? models : undefined,
          error: error || undefined,
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error validating API key:', error);
          return jsonResponse({ error: 'Failed to validate API key: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: PUT /api/settings ─────────────────────────────────────────────────

const putSettingsRoute = HttpRouter.add(
  'PUT',
  '/api/settings',
  Effect.gen(function* () {
    const body = yield* readJsonBody;

    return yield* Effect.try({
      try: () => {
        const newSettings = body as any;

        const validation = validateSettingsApi(newSettings);
        if (!validation.valid) {
          return jsonResponse(
            { error: validation.errors.join('; ') },
            { status: 400 },
          );
        }

        saveSettingsApi(newSettings);

        return jsonResponse({
          success: true,
          message: 'Settings saved to config.yaml',
          warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error saving settings:', error);
        return jsonResponse({ error: 'Failed to save settings: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const settingsRouteLayer = Layer.mergeAll(
  getSettingsRoute,
  getAvailableModelsRoute,
  getOptimalDefaultsRoute,
  postTestApiKeyRoute,
  postValidateApiKeyRoute,
  putSettingsRoute,
);

export default settingsRouteLayer;
