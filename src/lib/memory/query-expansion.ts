import { createHash, randomUUID } from 'crypto';
import { appendFile } from 'fs/promises';
import { Result, Schema } from 'effect';
import type { MemoryIdentity, MemoryObservation } from '@panctl/contracts';
import { ensureParentDir, resolveRagRunsFile } from './paths.js';
import {
  extractWithProviderPolicy,
  type MemoryExtractionPolicyResult,
  type MemoryProviderSettings,
} from './providers/index.js';

const QueryExpansionPayload = Schema.Struct({
  terms: Schema.Array(Schema.String),
});

type QueryExpansionPayload = typeof QueryExpansionPayload.Type;

const QUERY_EXPANSION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['terms'],
  properties: {
    terms: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
  },
};

const QUERY_EXPANSION_CACHE_MAX_ENTRIES = 500;
const QUERY_EXPANSION_CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedQueryExpansionResult {
  result: QueryExpansionResult;
  sessionId: string;
  expiresAt: number;
}

const expansionCache = new Map<string, CachedQueryExpansionResult>();

export interface QueryExpansionInput {
  prompt: string;
  identity: MemoryIdentity;
  previousObservations?: MemoryObservation[];
  settings?: MemoryProviderSettings | null;
  perDayCostCapUsd?: number;
  now?: Date;
  id?: string;
  expand?: QueryExpansionCall;
  logDecision?: (entry: QueryExpansionLogEntry) => Promise<void>;
}

export type QueryExpansionCall = (
  prompt: string,
  jsonSchema: unknown,
) => Promise<MemoryExtractionPolicyResult<unknown>>;

export interface QueryExpansionResult {
  query: string;
  expandedTerms: string[];
  cacheKey: string;
  status: 'expanded' | 'cache-hit' | 'fallback';
  reason: null | 'cost-cap' | 'extraction-failed' | 'malformed-response';
}

export interface QueryExpansionLogEntry {
  id: string;
  timestamp: string;
  type: 'query-expansion';
  identity: MemoryIdentity;
  outcome: 'expanded' | 'cache-hit' | 'expansion-failed';
  query: string;
  expandedTerms: string[];
  cacheKey: string;
  reason: string | null;
}

export function getCachedMemoryQueryExpansion(input: Pick<QueryExpansionInput, 'prompt' | 'identity' | 'previousObservations' | 'now'>): QueryExpansionResult {
  const cacheKey = buildQueryExpansionCacheKey(input);
  const cached = getCachedExpansion(cacheKey, input.now ?? new Date());
  if (cached) return { ...cached, status: 'cache-hit' };
  return {
    query: input.prompt,
    expandedTerms: [],
    cacheKey,
    status: 'fallback',
    reason: null,
  };
}

export async function expandMemoryQuery(input: QueryExpansionInput): Promise<QueryExpansionResult> {
  const cacheKey = buildQueryExpansionCacheKey(input);
  const cached = getCachedExpansion(cacheKey, input.now ?? new Date());
  if (cached) {
    const result: QueryExpansionResult = { ...cached, status: 'cache-hit' };
    await logQueryExpansion(input, result);
    return result;
  }

  const expand = input.expand ?? ((candidatePrompt, jsonSchema) => extractWithProviderPolicy(candidatePrompt, jsonSchema, {
    identity: input.identity,
    settings: input.settings,
    perDayCostCapUsd: input.perDayCostCapUsd,
    temperature: 0,
    maxTokens: 200,
  }));

  try {
    const expanded = await expand(buildQueryExpansionPrompt(input), QUERY_EXPANSION_JSON_SCHEMA);
    if (expanded.status === 'skipped') return await fallback(input, cacheKey, expanded.reason);
    if (expanded.status === 'dropped') return await fallback(input, cacheKey, expanded.reason);

    const payloadResult = Schema.decodeUnknownResult(QueryExpansionPayload)(expanded.result.data);
    if (payloadResult._tag === 'Failure') return await fallback(input, cacheKey, 'malformed-response');

    const terms = normalizeTerms(Result.getOrThrow(payloadResult).terms);
    if (terms.length === 0) return await fallback(input, cacheKey, 'malformed-response');

    const result: QueryExpansionResult = {
      query: terms.join(' '),
      expandedTerms: terms,
      cacheKey,
      status: 'expanded',
      reason: null,
    };
    setCachedExpansion(cacheKey, input.identity.sessionId, result, input.now ?? new Date());
    await logQueryExpansion(input, result);
    return result;
  } catch {
    return await fallback(input, cacheKey, 'extraction-failed');
  }
}

export function buildQueryExpansionPrompt(input: QueryExpansionInput): string {
  const previous = (input.previousObservations ?? [])
    .slice(-3)
    .map((observation, index) => [
      `Observation ${index + 1}:`,
      `- Status: ${observation.actionStatus ?? 'none'}`,
      `- Summary: ${observation.summary}`,
      `- Files: ${observation.files.join(', ') || 'none'}`,
      `- Tags: ${observation.tags.join(', ') || 'none'}`,
    ].join('\n'))
    .join('\n\n');

  return [
    'Expand this Panopticon memory retrieval prompt into 3-5 concise BM25 search terms.',
    'Prefer concrete file names, symbols, feature names, errors, decisions, and domain tags.',
    'Return terms that should retrieve durable observations; do not explain them.',
    `User prompt:\n${input.prompt}`,
    previous ? `Last 3 observations:\n${previous}` : 'Last 3 observations: none',
  ].join('\n\n');
}

export function buildQueryExpansionCacheKey(input: Pick<QueryExpansionInput, 'prompt' | 'identity' | 'previousObservations'>): string {
  const content = JSON.stringify({
    sessionId: input.identity.sessionId,
    prompt: input.prompt,
    observations: (input.previousObservations ?? []).slice(-3).map((observation) => ({
      id: observation.id,
      timestamp: observation.timestamp,
      actionStatus: observation.actionStatus,
      summary: observation.summary,
      files: observation.files,
      tags: observation.tags,
    })),
  });
  return `${input.identity.sessionId}:${createHash('sha256').update(content).digest('hex')}`;
}

export function clearQueryExpansionCache(sessionId?: string): void {
  if (!sessionId) {
    expansionCache.clear();
    return;
  }
  for (const [key, cached] of expansionCache.entries()) {
    if (cached.sessionId === sessionId) expansionCache.delete(key);
  }
}

function getCachedExpansion(cacheKey: string, now: Date): QueryExpansionResult | null {
  const cached = expansionCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= now.getTime()) {
    expansionCache.delete(cacheKey);
    return null;
  }
  expansionCache.delete(cacheKey);
  expansionCache.set(cacheKey, cached);
  return cached.result;
}

function setCachedExpansion(cacheKey: string, sessionId: string, result: QueryExpansionResult, now: Date): void {
  expansionCache.set(cacheKey, {
    result,
    sessionId,
    expiresAt: now.getTime() + QUERY_EXPANSION_CACHE_TTL_MS,
  });
  while (expansionCache.size > QUERY_EXPANSION_CACHE_MAX_ENTRIES) {
    const oldest = expansionCache.keys().next().value;
    if (!oldest) break;
    expansionCache.delete(oldest);
  }
}

async function fallback(
  input: QueryExpansionInput,
  cacheKey: string,
  reason: QueryExpansionResult['reason'],
): Promise<QueryExpansionResult> {
  const result: QueryExpansionResult = {
    query: input.prompt,
    expandedTerms: [],
    cacheKey,
    status: 'fallback',
    reason,
  };
  await logQueryExpansion(input, result);
  return result;
}

async function logQueryExpansion(input: QueryExpansionInput, result: QueryExpansionResult): Promise<void> {
  const entry: QueryExpansionLogEntry = {
    id: input.id ?? randomUUID(),
    timestamp: (input.now ?? new Date()).toISOString(),
    type: 'query-expansion',
    identity: input.identity,
    outcome: result.status === 'fallback' ? 'expansion-failed' : result.status,
    query: result.query,
    expandedTerms: result.expandedTerms,
    cacheKey: result.cacheKey,
    reason: result.reason,
  };

  if (input.logDecision) {
    await input.logDecision(entry);
    return;
  }

  await appendJsonl(resolveRagRunsFile(input.identity.projectId, input.identity.issueId, entry.timestamp), entry);
}

function normalizeTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const term of terms) {
    const value = term.trim().replace(/\s+/g, ' ');
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    normalized.push(value);
    if (normalized.length === 5) break;
  }
  return normalized;
}

async function appendJsonl(filePath: string, entry: QueryExpansionLogEntry): Promise<void> {
  await ensureParentDir(filePath);
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}
