import { DEFAULT_EFFORT, EFFORT_LEVELS, isEffortLevel, type EffortLevel } from '@overdeck/contracts';
import {
  MODEL_CAPABILITIES,
  apiLaunchModelId,
  hasModelCapability,
  modelSupportsSamplingParams,
  resolveModelId,
} from '../../src/lib/model-capabilities.js';
import { getModelProvider } from '../../src/lib/model-fallback.js';
import type { ModelId } from '../../src/lib/settings.js';

/** Output cap when a catalog row has no maxOutputTokens (a token count, not a model fallback). */
export const EVAL_DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export type EvalProvider = 'anthropic' | 'openai';
export type OpenAIVia = 'api' | 'cliproxy';
export type AnthropicVia = 'api' | 'claude-cli';

export interface EvalModelConfig {
  /** Exactly the OVERDECK_EVAL_MODEL value. */
  model: string;
  /** Catalog row id (dated snapshots resolve to their undated base). */
  catalogId: string;
  /** Id sent on the wire. */
  apiModel: string;
  provider: EvalProvider;
  /** null = the model enumerates no effort levels, so none is sent. */
  effort: EffortLevel | null;
  /** Anthropic only; null = no thinking field sent. */
  thinking: 'adaptive' | null;
  /** 0 = temperature sent; null = no sampling params sent. */
  temperature: 0 | null;
  maxTokens: number;
  /** OpenAI only. */
  openaiVia: OpenAIVia | null;
  /** Anthropic only. */
  anthropicVia: AnthropicVia | null;
}

const DATED_SNAPSHOT_SUFFIX = /-\d{8}$/;

export function resolveEvalModelConfig(
  env: Record<string, string | undefined>,
  opts: { maxTokens?: number } = {},
): EvalModelConfig {
  const model = env['OVERDECK_EVAL_MODEL']?.trim();
  if (!model) {
    throw new Error(
      'OVERDECK_EVAL_MODEL is not set — live prompt evals require an explicit eval model (no hardcoded fallback). Example: OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001 npm run eval',
    );
  }

  const resolved = resolveModelId(model);
  if (resolved !== model) {
    throw new Error(`Eval model "${model}" is deprecated; set OVERDECK_EVAL_MODEL=${resolved} to evaluate its replacement.`);
  }

  const catalogId = hasModelCapability(model)
    ? model
    : DATED_SNAPSHOT_SUFFIX.test(model) && hasModelCapability(model.replace(DATED_SNAPSHOT_SUFFIX, ''))
      ? model.replace(DATED_SNAPSHOT_SUFFIX, '')
      : null;
  if (catalogId === null) {
    throw new Error(
      `Unknown eval model "${model}": no MODEL_CAPABILITIES row. Use a catalogued model id (src/lib/model-capabilities.ts, src/lib/model-capability-additions.ts).`,
    );
  }

  const provider = getModelProvider(model);
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`Eval model "${model}" uses provider "${provider}", which the eval harness does not support (supported: anthropic, openai).`);
  }

  const rawEffort = env['OVERDECK_EVAL_EFFORT']?.trim();
  const explicitEffort = Boolean(rawEffort);
  const requestedEffort = rawEffort || DEFAULT_EFFORT;
  if (!isEffortLevel(requestedEffort)) {
    throw new Error(`OVERDECK_EVAL_EFFORT="${requestedEffort}" is not an effort level (allowed: ${EFFORT_LEVELS.join(', ')}).`);
  }

  const levels = MODEL_CAPABILITIES[catalogId as ModelId].effortLevels;
  let effort: EffortLevel | null;
  if (levels && levels.length > 0) {
    if (!levels.includes(requestedEffort)) {
      throw new Error(`Eval model "${model}" does not accept effort "${requestedEffort}" (allowed: ${levels.join(', ')}).`);
    }
    effort = requestedEffort;
  } else {
    if (explicitEffort) {
      throw new Error(`Eval model "${model}" accepts no effort setting; unset OVERDECK_EVAL_EFFORT.`);
    }
    effort = null;
  }

  const thinking: 'adaptive' | null = provider === 'anthropic' && effort !== null ? 'adaptive' : null;
  const temperature: 0 | null = provider === 'anthropic' && thinking === null && modelSupportsSamplingParams(catalogId) ? 0 : null;

  const catalogCap = MODEL_CAPABILITIES[catalogId as ModelId].maxOutputTokens ?? EVAL_DEFAULT_MAX_OUTPUT_TOKENS;
  let maxTokens: number;
  if (opts.maxTokens !== undefined) {
    if (!Number.isInteger(opts.maxTokens) || opts.maxTokens <= 0) {
      throw new Error(`maxTokens must be a positive integer (got ${opts.maxTokens}).`);
    }
    maxTokens = Math.min(opts.maxTokens, catalogCap);
  } else {
    maxTokens = catalogCap;
  }

  let openaiVia: OpenAIVia | null = null;
  if (provider === 'openai') {
    const via = env['OVERDECK_EVAL_OPENAI_VIA']?.trim() || 'api';
    if (via !== 'api' && via !== 'cliproxy') {
      throw new Error(`OVERDECK_EVAL_OPENAI_VIA="${via}" is not supported (use api or cliproxy).`);
    }
    if (via === 'api' && !env['OPENAI_API_KEY']?.trim()) {
      throw new Error('OPENAI_API_KEY is not set; set it, or set OVERDECK_EVAL_OPENAI_VIA=cliproxy to use the local CLIProxy.');
    }
    openaiVia = via;
  }

  // Selected explicitly only: a missing ANTHROPIC_API_KEY never switches the route.
  let anthropicVia: AnthropicVia | null = null;
  if (provider === 'anthropic') {
    const via = env['OVERDECK_EVAL_ANTHROPIC_VIA']?.trim() || 'api';
    if (via !== 'api' && via !== 'claude-cli') {
      throw new Error(`OVERDECK_EVAL_ANTHROPIC_VIA="${via}" is not supported (use api or claude-cli).`);
    }
    anthropicVia = via;
  }

  const apiModel = provider === 'openai' ? apiLaunchModelId(model) : model;

  return { model, catalogId, apiModel, provider, effort, thinking, temperature, maxTokens, openaiVia, anthropicVia };
}
