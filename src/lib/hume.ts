/**
 * Hume EVI Config Management
 *
 * Manages per-workspace Hume EVI configs for BYOLLM (Bring Your Own LLM).
 * Called during workspace create (createHumeConfig) and workspace remove/deep-wipe (deleteHumeConfig).
 *
 * Pattern mirrors tunnel.ts — stateless CRUD against external API.
 */

import { Effect, Data } from 'effect';
import { HumeConfig, TemplatePlaceholders, replacePlaceholders } from './workspace-config.js';

/** A Hume EVI API call failed (HTTP, timeout, or auth). */
export class HumeApiError extends Data.TaggedError('HumeApiError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface HumeResult {
  success: boolean;
  steps: string[];
  /** Populated on successful create */
  configId?: string;
  configName?: string;
}

const HUME_API = 'https://api.hume.ai/v0/evi';
const FETCH_TIMEOUT = 15_000;

/**
 * Make an authenticated Hume API request.
 * Auth via X-Hume-Api-Key header.
 */
async function humeFetch(
  path: string,
  apiKey: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(`${HUME_API}${path}`, {
      method,
      headers: {
        'X-Hume-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    // DELETE returns 204 No Content
    if (resp.status === 204) {
      return { ok: true, status: 204, data: null };
    }

    const json = await resp.json();
    return { ok: resp.ok, status: resp.status, data: json };
  } catch (err: any) {
    return { ok: false, status: 0, data: { message: err.message } };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Create a workspace-specific Hume EVI config by cloning the template config.
 *
 * Steps:
 * 1. Resolve config name from name_pattern with placeholders
 * 2. Check if config already exists (idempotent)
 * 3. GET template config to extract voice, prompt, tools, etc.
 * 4. POST new config with workspace-specific BYOLLM URL
 */
export async function createHumeConfig(
  config: HumeConfig,
  placeholders: TemplatePlaceholders,
): Promise<HumeResult> {
  const steps: string[] = [];

  // Resolve API key
  const apiKey = process.env[config.api_key_env || 'HUME_API_KEY'];
  if (!apiKey) {
    return { success: false, steps: [`[hume] API key not found in env var ${config.api_key_env || 'HUME_API_KEY'}`] };
  }

  // Resolve config name and BYOLLM URL
  const configName = replacePlaceholders(config.name_pattern, placeholders);
  const byollmUrl = replacePlaceholders(config.byollm_url_pattern, placeholders);
  steps.push(`[hume] Target config: ${configName}`);
  steps.push(`[hume] BYOLLM URL: ${byollmUrl}`);

  // Check if config already exists (idempotent)
  const listResult = await humeFetch(`/configs?name=${encodeURIComponent(configName)}`, apiKey);
  if (listResult.ok) {
    const configs = listResult.data?.configs_page ?? [];
    const existing = Array.isArray(configs)
      ? configs.find((c: any) => c.name === configName)
      : null;
    if (existing) {
      steps.push(`[hume] Config "${configName}" already exists (ID: ${existing.id}), skipping creation`);
      return { success: true, steps, configId: existing.id, configName };
    }
  }

  // GET template config (API returns paginated format even for single-config lookup)
  const templateResult = await humeFetch(`/configs/${config.template_config_id}`, apiKey);
  if (!templateResult.ok) {
    steps.push(`[hume] Failed to get template config ${config.template_config_id}: ${JSON.stringify(templateResult.data)}`);
    return { success: false, steps };
  }

  // Extract config from paginated response
  const templatePage = templateResult.data?.configs_page;
  const template = Array.isArray(templatePage) ? templatePage[0] : templateResult.data;
  if (!template || !template.id) {
    steps.push(`[hume] Template config ${config.template_config_id} not found in response`);
    return { success: false, steps };
  }
  steps.push(`[hume] Read template config: ${template.name || config.template_config_id}`);

  // Build new config payload — clone template but override name and BYOLLM URL
  const newConfig: Record<string, any> = {
    name: configName,
    evi_version: template.evi_version || '3',
    language_model: {
      model_provider: 'CUSTOM_LANGUAGE_MODEL',
      model_resource: byollmUrl,
    },
  };

  // Preserve voice from template
  if (template.voice) {
    newConfig.voice = template.voice;
  }

  // Preserve prompt from template
  if (template.prompt) {
    newConfig.prompt = template.prompt;
  }

  // Preserve event messages from template
  if (template.event_messages) {
    newConfig.event_messages = template.event_messages;
  }

  // Preserve timeouts from template
  if (template.timeouts) {
    newConfig.timeouts = template.timeouts;
  }

  // Preserve tools from template
  if (template.tools) {
    newConfig.tools = template.tools;
  }

  // Preserve builtin_tools from template
  if (template.builtin_tools) {
    newConfig.builtin_tools = template.builtin_tools;
  }

  // Preserve ellm_model (quick responses) from template
  if (template.ellm_model) {
    newConfig.ellm_model = template.ellm_model;
  }

  // Create new config
  const createResult = await humeFetch('/configs', apiKey, 'POST', newConfig);
  if (!createResult.ok) {
    steps.push(`[hume] Failed to create config: ${JSON.stringify(createResult.data)}`);
    return { success: false, steps };
  }

  const newId = createResult.data?.id;
  steps.push(`[hume] Created config "${configName}" (ID: ${newId})`);

  return { success: true, steps, configId: newId, configName };
}

/**
 * Delete a workspace-specific Hume EVI config.
 *
 * Steps:
 * 1. List configs matching the workspace name
 * 2. DELETE each match
 */
export async function deleteHumeConfig(
  config: HumeConfig,
  placeholders: TemplatePlaceholders,
): Promise<HumeResult> {
  const steps: string[] = [];

  // Resolve API key
  const apiKey = process.env[config.api_key_env || 'HUME_API_KEY'];
  if (!apiKey) {
    return { success: false, steps: [`[hume] API key not found in env var ${config.api_key_env || 'HUME_API_KEY'}`] };
  }

  const configName = replacePlaceholders(config.name_pattern, placeholders);
  steps.push(`[hume] Looking for config: ${configName}`);

  // List configs matching the name
  const listResult = await humeFetch(`/configs?name=${encodeURIComponent(configName)}`, apiKey);
  if (!listResult.ok) {
    steps.push(`[hume] Failed to list configs: ${JSON.stringify(listResult.data)}`);
    return { success: false, steps };
  }

  const configs = listResult.data?.configs_page ?? [];
  const matches = Array.isArray(configs)
    ? configs.filter((c: any) => c.name === configName)
    : [];

  if (matches.length === 0) {
    steps.push(`[hume] No config found with name "${configName}"`);
    return { success: true, steps };
  }

  let allOk = true;
  for (const match of matches) {
    const delResult = await humeFetch(`/configs/${match.id}`, apiKey, 'DELETE');
    if (delResult.ok) {
      steps.push(`[hume] Deleted config "${configName}" (ID: ${match.id})`);
    } else {
      steps.push(`[hume] Failed to delete config ${match.id}: ${JSON.stringify(delResult.data)}`);
      allOk = false;
    }
  }

  return { success: allOk, steps };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native createHumeConfig. The Promise version reports failure through
 * the `success: false` branch with step logs rather than throwing; this Effect
 * variant wraps it so callers can compose with other Effect work. Only the
 * underlying call itself throwing (network exception, JSON parse outside
 * humeFetch) surfaces as HumeApiError.
 */
export const createHumeConfigEffect = (
  config: HumeConfig,
  placeholders: TemplatePlaceholders,
): Effect.Effect<HumeResult, HumeApiError> =>
  Effect.tryPromise({
    try: () => createHumeConfig(config, placeholders),
    catch: (cause) =>
      new HumeApiError({
        operation: 'createHumeConfig',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/**
 * Effect-native deleteHumeConfig. Same shape as createHumeConfigEffect:
 * step-level failures stay in the returned payload, transport-level throws
 * become HumeApiError on the typed error channel.
 */
export const deleteHumeConfigEffect = (
  config: HumeConfig,
  placeholders: TemplatePlaceholders,
): Effect.Effect<HumeResult, HumeApiError> =>
  Effect.tryPromise({
    try: () => deleteHumeConfig(config, placeholders),
    catch: (cause) =>
      new HumeApiError({
        operation: 'deleteHumeConfig',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
