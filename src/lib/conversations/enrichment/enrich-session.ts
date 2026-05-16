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

import { updateEnrichment, markEnrichmentFailed } from '../../database/discovered-sessions-db.js';
import { selectModelForTier, maxMessagesForTier } from './model-fallback.js';
import type { EnrichmentTier, TierConfig } from './model-fallback.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnrichmentResponse {
  summary: string;
  summaryDetailed?: string;
  tags: string[];
}

export interface EnrichSessionOptions {
  sessionId: number;
  jsonlPath: string;
  tier: EnrichmentTier;
  config: TierConfig;
  /** Override the model used (ignores tier-based selection) */
  modelOverride?: string;
  /** Append custom text to the enrichment prompt */
  promptSuffix?: string;
  /** Injected for testing — skips real API call */
  callApi?: (model: string, prompt: string) => Promise<EnrichmentResponse>;
}

export interface EnrichSessionResult {
  sessionId: number;
  tier: EnrichmentTier;
  model: string;
  tokensUsed?: number;
  error?: string;
}

// ─── JSONL message reader ─────────────────────────────────────────────────────

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b(?:sk-ant|sk-proj|sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(?:ghp|github_pat|glpat|xox[baprs])-?[A-Za-z0-9_\-]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

/**
 * Read up to `maxLines` lines from a JSONL file.
 * Returns raw line strings (not parsed) for prompt construction.
 */
async function readJsonlLines(filePath: string, maxLines: number | null): Promise<string[]> {
  const lines: string[] = [];
  try {
    await fs.access(filePath);
  } catch {
    return lines;
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    let count = 0;
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      lines.push(trimmed);
      count++;
      if (maxLines !== null && count >= maxLines) {
        rl.close();
      }
    });

    rl.on('close', () => resolve(lines));
    rl.on('error', () => resolve(lines));
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
        text = content.slice(0, 500);
      } else if (Array.isArray(content)) {
        text = content
          .filter((b: unknown) => (b as { type?: string }).type === 'text')
          .map((b: unknown) => (b as { text?: string }).text ?? '')
          .join(' ')
          .slice(0, 500);
      }
      if (text) {
        parts.push(`[${role}]: ${redactSensitiveText(text)}`);
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

// ─── Claude API call ──────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function callClaudeApi(
  model: string,
  prompt: string,
): Promise<EnrichmentResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — cannot enrich sessions');
  }

  const resp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
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
  };

  const text = data.content.find((b) => b.type === 'text')?.text ?? '';

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    return JSON.parse(cleaned) as EnrichmentResponse;
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
  const model = opts.modelOverride ?? selectModelForTier(tier, config);
  const maxLines = maxMessagesForTier(tier);

  const apiCall = opts.callApi ?? callClaudeApi;

  try {
    // Read JSONL lines up to tier context limit
    const lines = await readJsonlLines(jsonlPath, maxLines);
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

    // Persist to DB (syncFts is called inside updateEnrichment)
    updateEnrichment(sessionId, {
      summary: response.summary,
      summaryDetailed: response.summaryDetailed ?? null,
      tags: response.tags,
      enrichmentLevel: tier,
      enrichmentModel: model,
    });

    return { sessionId, tier, model };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark as failed in DB
    markEnrichmentFailed(sessionId);
    return { sessionId, tier, model, error: message };
  }
}
