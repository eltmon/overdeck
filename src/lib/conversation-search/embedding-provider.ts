import { createOpenAI } from '@ai-sdk/openai';
import { embedMany as aiEmbedMany } from 'ai';

import { getConversationSearchConfigSync, type NormalizedConversationSearchConfig } from '../config-yaml.js';

export type ConversationEmbeddingProviderName = 'openai';

export interface ConversationEmbeddingResult {
  embeddings: Float32Array[];
  model: string;
  tokenCount?: number;
}

export interface ConversationEmbeddingCostEstimate {
  provider: ConversationEmbeddingProviderName;
  model: string;
  tokenCount: number;
  pricePerMillionTokens: number;
  estimatedUsd: number;
}

export interface ConversationEmbeddingProvider {
  provider: ConversationEmbeddingProviderName;
  model: string;
  enabled: boolean;
  embed(texts: string[]): Promise<ConversationEmbeddingResult>;
  estimateCost(texts: string[]): ConversationEmbeddingCostEstimate;
}

export interface CreateConversationEmbeddingProviderOptions {
  config?: NormalizedConversationSearchConfig;
  env?: NodeJS.ProcessEnv;
  embedMany?: AiEmbedMany;
  createOpenAI?: OpenAIFactory;
}

type AiEmbedMany = (input: { model: unknown; values: string[] }) => Promise<{
  embeddings: number[][];
  usage?: { tokens?: number; totalTokens?: number };
}>;

type OpenAIFactory = (options: { apiKey: string }) => { embedding: (model: string) => unknown };

const OPENAI_DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY';
const APPROX_CHARS_PER_TOKEN = 4;

const OPENAI_EMBEDDING_PRICES_PER_MILLION: Record<string, number> = {
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13,
};

export class ConversationEmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationEmbeddingUnavailableError';
  }
}

export function createConversationEmbeddingProvider(
  options: CreateConversationEmbeddingProviderOptions = {},
): ConversationEmbeddingProvider {
  const config = options.config ?? getConversationSearchConfigSync();
  const provider = config.provider as ConversationEmbeddingProviderName;

  if (!config.enabled) return unavailableProvider(provider, config.model, 'conversationSearch is disabled');
  if (provider !== 'openai') return unavailableProvider('openai', config.model, `Unsupported conversationSearch provider: ${config.provider}`);

  const env = options.env ?? process.env;
  const apiKeyName = config.apiKeyRef ?? OPENAI_DEFAULT_API_KEY_ENV;
  const apiKey = env[apiKeyName];
  if (!apiKey) return unavailableProvider(provider, config.model, `${apiKeyName} is not set`);

  const embedMany = options.embedMany ?? (aiEmbedMany as AiEmbedMany);
  const createProvider = options.createOpenAI ?? (createOpenAI as OpenAIFactory);

  return {
    provider,
    model: config.model,
    enabled: true,
    estimateCost: (texts) => estimateConversationEmbeddingCost(texts, { provider, model: config.model }),
    embed: async (texts) => {
      if (texts.length === 0) return { embeddings: [], model: config.model, tokenCount: 0 };
      const openai = createProvider({ apiKey });
      const result = await embedMany({ model: openai.embedding(config.model), values: texts });
      return {
        embeddings: result.embeddings.map((embedding) => new Float32Array(embedding)),
        model: config.model,
        tokenCount: result.usage?.tokens ?? result.usage?.totalTokens,
      };
    },
  };
}

export function estimateConversationEmbeddingCost(
  texts: string[],
  options: { provider?: ConversationEmbeddingProviderName; model?: string } = {},
): ConversationEmbeddingCostEstimate {
  const provider = options.provider ?? 'openai';
  const model = options.model ?? 'text-embedding-3-small';
  const tokenCount = estimateTokenCount(texts);
  const pricePerMillionTokens = OPENAI_EMBEDDING_PRICES_PER_MILLION[model] ?? OPENAI_EMBEDDING_PRICES_PER_MILLION['text-embedding-3-small'];
  return {
    provider,
    model,
    tokenCount,
    pricePerMillionTokens,
    estimatedUsd: (tokenCount / 1_000_000) * pricePerMillionTokens,
  };
}

export function estimateTokenCount(texts: string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / APPROX_CHARS_PER_TOKEN), 0);
}

function unavailableProvider(
  provider: ConversationEmbeddingProviderName,
  model: string,
  reason: string,
): ConversationEmbeddingProvider {
  return {
    provider,
    model,
    enabled: false,
    estimateCost: (texts) => estimateConversationEmbeddingCost(texts, { provider, model }),
    embed: async () => {
      throw new ConversationEmbeddingUnavailableError(reason);
    },
  };
}
