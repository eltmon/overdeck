/**
 * Single-session enrichment (PAN-457).
 *
 * Reads JSONL messages up to tier context limit, builds a prompt,
 * calls the Claude API, parses the structured JSON response,
 * and writes enrichment data back to the DB.
 */

import { promises as fs } from 'fs';
import * as readline from 'readline';
import { createReadStream } from 'fs';

import { getDiscoveredSessionById, updateEnrichment, markEnrichmentFailed } from '../../database/discovered-sessions-db.js';
import { calculateCost, getPricing } from '../../cost.js';
import { applyFallback, selectEnrichmentModelForTier } from '../../model-fallback.js';
import { loadConfig as loadYamlConfig } from '../../config-yaml.js';
import { getProviderEnv, getProviderForModel } from '../../providers.js';
import type { TokenUsage } from '../../cost.js';
import type { EnrichmentTier, EnrichmentTierConfig } from '../../model-fallback.js';
import type { ModelId } from '../../settings.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnrichmentResponse {
  summary: string;
  summaryDetailed?: string;
  tags: string[];
  usage?: TokenUsage & { cost: number };
}

export interface EnrichSessionOptions {
  sessionId: number;
  jsonlPath: string;
  tier: EnrichmentTier;
  config: EnrichmentTierConfig;
  /** Override the model used (ignores tier-based selection) */
  modelOverride?: string;
  /** Append custom text to the enrichment prompt */
  promptSuffix?: string;
  /** Read every JSONL line without tier sampling caps */
  fullTranscript?: boolean;
  /** Injected for testing — skips real API call */
  callApi?: (model: string, prompt: string) => Promise<EnrichmentResponse>;
}

export interface EnrichSessionResult {
  sessionId: number;
  tier: EnrichmentTier;
  model: string;
  tokensUsed?: number;
  cost?: number;
  error?: string;
}

// ─── JSONL message reader ─────────────────────────────────────────────────────

function redactSensitiveText(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:sk-ant|sk-proj|sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(?:ghp|github_pat|glpat|xox[baprs]|npm)_[A-Za-z0-9_\-]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:DATABASE_URL|[A-Z0-9_]*(?:PASSWORD|PASSWD|API_KEY|SECRET|TOKEN)[A-Z0-9_]*)\s*=\s*[^\s,;]+/g, (match) => {
      const [key] = match.split('=', 1);
      return `${key}=[REDACTED]`;
    })
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s,;@]+:[^\s,;@]+@[^\s,;]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

const MAX_JSONL_LINE_CHARS = 20_000;
const L3_MAX_LINES = 5_000;
const L3_MAX_BYTES = 2_000_000;

type SampledLine = { index: number; line: string };

function boundedLine(line: string): string {
  return line.length > MAX_JSONL_LINE_CHARS ? line.slice(0, MAX_JSONL_LINE_CHARS) : line;
}

function pushRing<T>(ring: T[], value: T, max: number): void {
  ring.push(value);
  if (ring.length > max) ring.shift();
}

function deterministicReservoirSlot(candidateCount: number, reservoirSize: number): number {
  if (candidateCount <= reservoirSize) return candidateCount - 1;
  const n = (candidateCount * 1_103_515_245 + 12_345) >>> 0;
  return n % candidateCount < reservoirSize ? n % reservoirSize : -1;
}

async function sampleJsonlLines(filePath: string, tier: EnrichmentTier, options: { fullTranscript?: boolean } = {}): Promise<string[]> {
  try {
    await fs.access(filePath);
  } catch {
    return [];
  }

  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const firstLimit = tier === 1 ? 1 : 3;
    const middleLimit = tier === 1 ? 1 : 5;
    const tailLimit = tier === 1 ? 1 : 3;
    const first: SampledLine[] = [];
    const middle: SampledLine[] = [];
    const tail: SampledLine[] = [];
    const l3Lines: string[] = [];
    let seen = 0;
    let middleCandidates = 0;
    let bytes = 0;
    let capped = false;

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed || capped) return;
      if (options.fullTranscript) {
        l3Lines.push(trimmed);
        return;
      }
      const sampled = boundedLine(trimmed);
      seen++;

      if (tier === 3) {
        bytes += Buffer.byteLength(trimmed, 'utf8');
        if (l3Lines.length >= L3_MAX_LINES || bytes > L3_MAX_BYTES) {
          capped = true;
          rl.close();
          stream.destroy();
          return;
        }
        l3Lines.push(sampled);
        return;
      }

      const entry = { index: seen, line: sampled };
      if (first.length < firstLimit) {
        first.push(entry);
        return;
      }

      middleCandidates++;
      const slot = deterministicReservoirSlot(middleCandidates, middleLimit);
      if (slot >= 0) middle[slot] = entry;
      pushRing(tail, entry, tailLimit);
    });

    rl.on('close', () => {
      if (tier === 3 || options.fullTranscript) {
        resolve(l3Lines);
        return;
      }
      const byIndex = new Map<number, string>();
      for (const item of [...first, ...middle, ...tail]) byIndex.set(item.index, item.line);
      resolve([...byIndex.entries()].sort(([a], [b]) => a - b).map(([, line]) => line));
    });
    rl.on('error', () => resolve(tier === 3 || options.fullTranscript ? l3Lines : []));
  });
}

/**
 * Parse JSONL lines into a human-readable conversation excerpt for the prompt.
 * Extracts role + text content from each line.
 */
function buildConversationExcerpt(lines: string[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as {
        message?: { role?: string; content?: unknown };
        content?: unknown;
      };
      const role = msg.message?.role ?? 'unknown';
      // Real transcripts store content in message.content; legacy fixtures use top-level content
      const content = msg.message?.content ?? msg.content;
      let text = '';
      if (typeof content === 'string') {
        text = redactSensitiveText(content).slice(0, 500);
      } else if (Array.isArray(content)) {
        text = content
          .map((b: unknown) => {
            const block = b as { type?: string; text?: string; name?: string };
            if (block.type === 'text') return redactSensitiveText(block.text ?? '');
            if (block.type === 'tool_use') return `[tool_use:${block.name ?? 'unknown'}]`;
            return '';
          })
          .filter(Boolean)
          .join(' ')
          .slice(0, 500);
      }
      if (text) {
        parts.push(`[${role}]: ${text}`);
      }
    } catch {
      // skip malformed lines
    }
  }
  return parts.join('\n');
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildL1Prompt(excerpt: string): string {
  return `You are analyzing a Claude Code conversation log.

CONVERSATION EXCERPT:
${excerpt}

Summarize this conversation in 1-2 sentences. Extract 1-5 topic tags (single words or short phrases).

Reply ONLY with valid JSON matching this schema:
{"summary": "...", "tags": ["tag1", "tag2"]}`;
}

function buildL2Prompt(excerpt: string): string {
  return `You are analyzing a Claude Code conversation log.

CONVERSATION EXCERPT:
${excerpt}

Provide:
1. A 1-2 sentence quick summary
2. A detailed summary (3-5 sentences) describing what was done, what decisions were made, and what files were affected
3. 5-10 topic tags

Reply ONLY with valid JSON matching this schema:
{"summary": "...", "summaryDetailed": "...", "tags": ["tag1", "tag2"]}`;
}

function buildL3Prompt(excerpt: string): string {
  return `You are analyzing a full Claude Code conversation log.

CONVERSATION:
${excerpt}

Provide a comprehensive analysis including:
1. A 1-2 sentence quick summary
2. A detailed summary (5-8 sentences) covering: what problem was solved, what approach was taken, what files/components were modified, and any key decisions or tradeoffs
3. 5-15 descriptive topic tags

Reply ONLY with valid JSON matching this schema:
{"summary": "...", "summaryDetailed": "...", "tags": ["tag1", "tag2"]}`;
}

// ─── Provider-aware Messages API call ─────────────────────────────────────────

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

function resolveEnrichmentModel(model: string): string {
  const { config } = loadYamlConfig();
  return applyFallback(model as ModelId, config.enabledProviders);
}

function getProviderApiKey(providerName: string, configuredKey?: string): string | undefined {
  if (providerName === 'anthropic') {
    return process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
  }
  return configuredKey;
}

export async function callClaudeApi(
  model: string,
  prompt: string,
): Promise<EnrichmentResponse> {
  const effectiveModel = resolveEnrichmentModel(model);
  const provider = getProviderForModel(effectiveModel);
  const { config } = loadYamlConfig();
  const configuredKey = config.apiKeys[provider.name as keyof typeof config.apiKeys];
  const apiKey = getProviderApiKey(provider.name, configuredKey);
  if (!apiKey) {
    throw new Error(`${provider.displayName} API key is not set — cannot enrich sessions with ${effectiveModel}`);
  }

  const providerEnv = provider.name === 'anthropic' ? {} : getProviderEnv(provider, apiKey);
  const baseUrl = provider.name === 'anthropic'
    ? DEFAULT_ANTHROPIC_BASE_URL
    : providerEnv.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL;
  const authToken = providerEnv.ANTHROPIC_AUTH_TOKEN ?? apiKey;

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': authToken,
      authorization: `Bearer ${authToken}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: effectiveModel,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };

  const text = data.content.find((b) => b.type === 'text')?.text ?? '';

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as EnrichmentResponse;
    if (data.usage) {
      const usage: TokenUsage = {
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
        cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
      };
      const pricingProvider = provider.name === 'anthropic' || provider.name === 'openai' || provider.name === 'google'
        ? provider.name
        : 'custom';
      const pricing = getPricing(pricingProvider, effectiveModel);
      if (pricing) parsed.usage = { ...usage, cost: calculateCost(usage, pricing) };
    }
    return parsed;
  } catch {
    throw new Error(`Failed to parse enrichment JSON: ${cleaned.slice(0, 200)}`);
  }
}

// ─── Main enrichment function ─────────────────────────────────────────────────

/**
 * Enrich a single session at the given tier.
 * Reads JSONL, calls API, writes to DB, syncs FTS.
 */
export async function enrichSession(opts: EnrichSessionOptions): Promise<EnrichSessionResult> {
  const { sessionId, jsonlPath, tier, config } = opts;
  const requestedModel = opts.modelOverride ?? selectEnrichmentModelForTier(tier, config);
  let model = requestedModel;

  const apiCall = opts.callApi ?? callClaudeApi;

  try {
    model = opts.callApi ? requestedModel : resolveEnrichmentModel(requestedModel);
    const lines = await sampleJsonlLines(jsonlPath, tier, { fullTranscript: opts.fullTranscript });
    if (lines.length === 0) {
      return { sessionId, tier, model, error: 'No readable messages in JSONL' };
    }

    // Build conversation excerpt
    const excerpt = buildConversationExcerpt(lines);
    if (!excerpt.trim()) {
      return { sessionId, tier, model, error: 'No text content extractable from JSONL' };
    }

    // Build tier-appropriate prompt
    let prompt =
      tier === 1 ? buildL1Prompt(excerpt) :
      tier === 2 ? buildL2Prompt(excerpt) :
      buildL3Prompt(excerpt);
    if (opts.promptSuffix) prompt = `${prompt}\n\n${opts.promptSuffix}`;

    // Call API
    const response = await apiCall(model, prompt);

    const existing = getDiscoveredSessionById(sessionId);
    const preserveQuickSummary = tier === 2 && existing?.enrichmentLevel === 1 && Boolean(existing.summary);

    // Persist to DB (syncFts is called inside updateEnrichment)
    updateEnrichment(sessionId, {
      summary: preserveQuickSummary ? undefined : response.summary,
      summaryDetailed: response.summaryDetailed ?? null,
      tags: response.tags,
      enrichmentLevel: tier,
      enrichmentModel: model,
    });

    return {
      sessionId,
      tier,
      model,
      tokensUsed: response.usage ? response.usage.inputTokens + response.usage.outputTokens + (response.usage.cacheReadTokens ?? 0) + (response.usage.cacheWriteTokens ?? 0) : undefined,
      cost: response.usage?.cost,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark as failed in DB
    markEnrichmentFailed(sessionId);
    return { sessionId, tier, model, error: message };
  }
}
