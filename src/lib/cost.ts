/**
 * Cost Tracking System
 *
 * Track AI usage costs per feature, issue, and project.
 * Supports multiple AI providers with configurable pricing.
 */

import { Effect } from 'effect';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { COSTS_DIR } from './paths.js';
import { FsError } from './errors.js';

// ============== Types ==============

export type AIProvider = 'anthropic' | 'openai' | 'google' | 'custom';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTTL?: '5m' | '1h';  // Cache write TTL (default: '5m')
}

export interface CostEntry {
  id: string;
  timestamp: string;
  provider: AIProvider;
  model: string;
  issueId?: string;
  featureId?: string;
  agentId?: string;
  operation: string;
  usage: TokenUsage;
  cost: number;
  currency: string;
  metadata?: Record<string, any>;
}

export interface CostSummary {
  totalCost: number;
  currency: string;
  period: {
    start: string;
    end: string;
  };
  byProvider: Record<AIProvider, number>;
  byModel: Record<string, number>;
  byIssue: Record<string, number>;
  byFeature: Record<string, number>;
  entryCount: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface CostBudget {
  id: string;
  name: string;
  type: 'issue' | 'feature' | 'project' | 'daily' | 'monthly';
  limit: number;
  currency: string;
  spent: number;
  alertThreshold: number; // e.g., 0.8 = alert at 80%
  enabled: boolean;
}

export interface ModelPricing {
  provider: AIProvider;
  model: string;
  inputPer1k: number;
  outputPer1k: number;
  cacheReadPer1k?: number;
  cacheWrite5mPer1k?: number;  // 5-minute TTL (default)
  cacheWrite1hPer1k?: number;  // 1-hour TTL
  currency: string;
}

// ============== Pricing Data ==============

export const DEFAULT_PRICING: ModelPricing[] = [
  // Anthropic - Fable 5 (Mythos-class flagship): $10/M input, $50/M output. Cache
  // rates mirror Anthropic's standard ratios (read 0.1×, write-5m 1.25×, write-1h 2× of input).
  { provider: 'anthropic', model: 'claude-fable-5', inputPer1k: 0.010, outputPer1k: 0.050, cacheReadPer1k: 0.001, cacheWrite5mPer1k: 0.0125, cacheWrite1hPer1k: 0.020, currency: 'USD' },
  // Anthropic - 4.8 series (current flagship; same pricing tier as 4.7/4.6 — verify at launch)
  { provider: 'anthropic', model: 'claude-opus-4-8', inputPer1k: 0.005, outputPer1k: 0.025, cacheReadPer1k: 0.0005, cacheWrite5mPer1k: 0.00625, cacheWrite1hPer1k: 0.01, currency: 'USD' },
  // Anthropic - 4.7 series
  { provider: 'anthropic', model: 'claude-opus-4-7', inputPer1k: 0.005, outputPer1k: 0.025, cacheReadPer1k: 0.0005, cacheWrite5mPer1k: 0.00625, cacheWrite1hPer1k: 0.01, currency: 'USD' },
  // Anthropic - Sonnet 5 introductory pricing through 2026-08-31.
  // Standard pricing starts 2026-09-01: input 0.003, output 0.015,
  // cache read 0.0003, 5m write 0.00375, 1h write 0.006 per 1K tokens.
  { provider: 'anthropic', model: 'claude-sonnet-5', inputPer1k: 0.002, outputPer1k: 0.010, cacheReadPer1k: 0.0002, cacheWrite5mPer1k: 0.0025, cacheWrite1hPer1k: 0.004, currency: 'USD' },
  // Anthropic - 4.6 series (API IDs use dashes: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5)
  { provider: 'anthropic', model: 'claude-opus-4-6', inputPer1k: 0.005, outputPer1k: 0.025, cacheReadPer1k: 0.0005, cacheWrite5mPer1k: 0.00625, cacheWrite1hPer1k: 0.01, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003, cacheWrite5mPer1k: 0.00375, cacheWrite1hPer1k: 0.006, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-haiku-4-5', inputPer1k: 0.001, outputPer1k: 0.005, cacheReadPer1k: 0.0001, cacheWrite5mPer1k: 0.00125, cacheWrite1hPer1k: 0.002, currency: 'USD' },
  // Anthropic - 4.x series
  { provider: 'anthropic', model: 'claude-opus-4-1', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 0.0015, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-opus-4', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 0.0015, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-sonnet-4', inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003, cacheWrite5mPer1k: 0.00375, cacheWrite1hPer1k: 0.006, currency: 'USD' },
  // Anthropic - Legacy
  { provider: 'anthropic', model: 'claude-haiku-3', inputPer1k: 0.00025, outputPer1k: 0.00125, cacheReadPer1k: 0.00003, cacheWrite5mPer1k: 0.0003, cacheWrite1hPer1k: 0.0005, currency: 'USD' },
  // OpenAI — prices per developers.openai.com/api/docs/pricing (May 2026)
  { provider: 'openai', model: 'gpt-5.5', inputPer1k: 0.005, outputPer1k: 0.030, cacheReadPer1k: 0.0005, currency: 'USD' },
  { provider: 'openai', model: 'gpt-5.5-pro', inputPer1k: 0.030, outputPer1k: 0.180, currency: 'USD' },
  { provider: 'openai', model: 'gpt-5.4', inputPer1k: 0.0025, outputPer1k: 0.015, cacheReadPer1k: 0.00025, currency: 'USD' },
  { provider: 'openai', model: 'gpt-5.4-mini', inputPer1k: 0.00075, outputPer1k: 0.0045, cacheReadPer1k: 0.000075, currency: 'USD' },
  { provider: 'openai', model: 'gpt-5.4-pro', inputPer1k: 0.030, outputPer1k: 0.180, currency: 'USD' },
  { provider: 'openai', model: 'gpt-5.3-codex', inputPer1k: 0.00175, outputPer1k: 0.014, cacheReadPer1k: 0.000175, currency: 'USD' },
  { provider: 'openai', model: 'codex-4o', inputPer1k: 0.00175, outputPer1k: 0.014, cacheReadPer1k: 0.000175, currency: 'USD' },
  { provider: 'openai', model: 'codex-4o-mini', inputPer1k: 0.00075, outputPer1k: 0.0045, cacheReadPer1k: 0.000075, currency: 'USD' },
  { provider: 'openai', model: 'gpt-5.2', inputPer1k: 0.00125, outputPer1k: 0.010, currency: 'USD' },
  { provider: 'openai', model: 'o3', inputPer1k: 0.002, outputPer1k: 0.008, currency: 'USD' },
  { provider: 'openai', model: 'o4-mini', inputPer1k: 0.004, outputPer1k: 0.016, cacheReadPer1k: 0.001, currency: 'USD' },
  // Google
  { provider: 'google', model: 'gemini-3.1-pro-preview', inputPer1k: 0.002, outputPer1k: 0.012, currency: 'USD' },
  { provider: 'google', model: 'gemini-3-flash-preview', inputPer1k: 0.00015, outputPer1k: 0.0006, currency: 'USD' },
  { provider: 'google', model: 'gemini-3.1-flash-lite-preview', inputPer1k: 0.00025, outputPer1k: 0.0015, currency: 'USD' },
  // Moonshot AI (Kimi)
  { provider: 'custom', model: 'kimi-for-coding', inputPer1k: 0.0006, outputPer1k: 0.002, cacheReadPer1k: 0.00006, cacheWrite5mPer1k: 0.00075, currency: 'USD' },
  { provider: 'custom', model: 'kimi-k2.6', inputPer1k: 0.0006, outputPer1k: 0.002, cacheReadPer1k: 0.00006, cacheWrite5mPer1k: 0.00075, currency: 'USD' },
  { provider: 'custom', model: 'kimi-k2.5', inputPer1k: 0.0006, outputPer1k: 0.002, cacheReadPer1k: 0.00006, cacheWrite5mPer1k: 0.00075, currency: 'USD' },
  // MiniMax ($0.30/M input, $1.20/M output)
  { provider: 'custom', model: 'minimax-m2.7', inputPer1k: 0.0003, outputPer1k: 0.0012, currency: 'USD' },
  { provider: 'custom', model: 'minimax-m2.7-highspeed', inputPer1k: 0.0003, outputPer1k: 0.0012, currency: 'USD' },
  { provider: 'custom', model: 'MiniMax-M2.7', inputPer1k: 0.0003, outputPer1k: 0.0012, currency: 'USD' },
  { provider: 'custom', model: 'MiniMax-M2.7-highspeed', inputPer1k: 0.0003, outputPer1k: 0.0012, currency: 'USD' },
  { provider: 'custom', model: 'MiniMax-M3', inputPer1k: 0.0003, outputPer1k: 0.0012, currency: 'USD' },
  // Z.AI (GLM) — PAN-1935: previously absent, so pi-harness GLM agents recorded $0 cost.
  // GLM-5.x: $1.4/M in, $4.4/M out (docs.z.ai/guides/overview/pricing). cacheRead set to
  // ~7% of input to approximate Z.AI's context-cache discount — verify upstream and refine.
  { provider: 'custom', model: 'glm-5.2', inputPer1k: 0.0014, outputPer1k: 0.0044, cacheReadPer1k: 0.0001, currency: 'USD' },
  { provider: 'custom', model: 'glm-5.1', inputPer1k: 0.0014, outputPer1k: 0.0044, cacheReadPer1k: 0.0001, currency: 'USD' },
  // GLM-4.7: approximate in/out split of the $1.5/M blended average — verify upstream.
  { provider: 'custom', model: 'glm-4.7', inputPer1k: 0.0005, outputPer1k: 0.002, cacheReadPer1k: 0.00005, currency: 'USD' },
  { provider: 'custom', model: 'glm-4.7-flash', inputPer1k: 0.0001, outputPer1k: 0.0005, currency: 'USD' },
  // Moonshot Kimi K2.7 Code (platform.moonshot.ai/docs/pricing/chat):
  // $0.95/M in (cache-miss), $4.00/M out, $0.19/M in (cache-hit). PAN-1935.
  { provider: 'custom', model: 'kimi-k2.7-code', inputPer1k: 0.00095, outputPer1k: 0.004, cacheReadPer1k: 0.00019, currency: 'USD' },
];

// ============== Cost Calculation ==============

/**
 * Calculate cost for token usage
 */
export function calculateCostSync(usage: TokenUsage, pricing: ModelPricing): number {
  let cost = 0;
  let inputMultiplier = 1;
  let outputMultiplier = 1;

  // Long-context pricing for retired Sonnet 4 (>200K total input tokens).
  // Sonnet 4.6 and Sonnet 5 include their full 1M context at standard pricing.
  // Total input includes: inputTokens + cacheReadTokens + cacheWriteTokens
  const totalInputTokens = usage.inputTokens
    + (usage.cacheReadTokens || 0)
    + (usage.cacheWriteTokens || 0);

  if (pricing.model === 'claude-sonnet-4'
      && totalInputTokens > 200000) {
    inputMultiplier = 2;    // $6/MTok vs $3/MTok
    outputMultiplier = 1.5; // $22.50/MTok vs $15/MTok
  }

  // Input tokens
  cost += (usage.inputTokens / 1000) * pricing.inputPer1k * inputMultiplier;

  // Output tokens
  cost += (usage.outputTokens / 1000) * pricing.outputPer1k * outputMultiplier;

  // Cache read tokens (not affected by long-context multiplier)
  if (usage.cacheReadTokens && pricing.cacheReadPer1k) {
    cost += (usage.cacheReadTokens / 1000) * pricing.cacheReadPer1k;
  }

  // Cache write tokens - use TTL-appropriate pricing
  if (usage.cacheWriteTokens) {
    const ttl = usage.cacheTTL || '5m';
    const cacheWritePrice = ttl === '1h'
      ? pricing.cacheWrite1hPer1k
      : pricing.cacheWrite5mPer1k;
    if (cacheWritePrice) {
      cost += (usage.cacheWriteTokens / 1000) * cacheWritePrice;
    }
  }

  return Math.round(cost * 1000000) / 1000000; // Round to 6 decimal places
}

/**
 * Get pricing for a model
 */
export function getPricingSync(provider: AIProvider, model: string): ModelPricing | null {
  // Try exact match first
  let pricing = DEFAULT_PRICING.find(
    p => p.provider === provider && p.model === model
  );

  if (!pricing) {
    // Try partial match (e.g., "claude-sonnet-4-20250101" matches "claude-sonnet-4")
    pricing = DEFAULT_PRICING.find(
      p => p.provider === provider && model.startsWith(p.model)
    );
  }

  return pricing || null;
}

// ============== Cost Logging ==============

function getCostFile(date: string): string {
  return join(COSTS_DIR, `costs-${date}.jsonl`);
}

function getCurrentDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Log a cost entry
 */
export function logCostSync(entry: Omit<CostEntry, 'id' | 'timestamp'>): CostEntry {
  mkdirSync(COSTS_DIR, { recursive: true });

  const fullEntry: CostEntry = {
    ...entry,
    id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };

  const costFile = getCostFile(getCurrentDateString());
  appendFileSync(costFile, JSON.stringify(fullEntry) + '\n');

  return fullEntry;
}

/**
 * Log cost from token usage
 */
export function logUsageSync(
  provider: AIProvider,
  model: string,
  usage: TokenUsage,
  options: {
    issueId?: string;
    featureId?: string;
    agentId?: string;
    operation?: string;
    metadata?: Record<string, any>;
  } = {}
): CostEntry | null {
  const pricing = getPricingSync(provider, model);
  if (!pricing) {
    console.warn(`No pricing found for ${provider}/${model}`);
    return null;
  }

  const cost = calculateCostSync(usage, pricing);

  return logCostSync({
    provider,
    model,
    usage,
    cost,
    currency: pricing.currency,
    operation: options.operation || 'api_call',
    issueId: options.issueId,
    featureId: options.featureId,
    agentId: options.agentId,
    metadata: options.metadata,
  });
}

// ============== Cost Reading ==============

/**
 * Read cost entries for a date range
 */
export function readCostsSync(startDate: string, endDate: string): CostEntry[] {
  const entries: CostEntry[] = [];

  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let date = start; date <= end; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().split('T')[0];
    const costFile = getCostFile(dateStr);

    if (existsSync(costFile)) {
      const content = readFileSync(costFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Skip invalid entries
        }
      }
    }
  }

  return entries;
}

/**
 * Read costs for today
 */
export function readTodayCostsSync(): CostEntry[] {
  const today = getCurrentDateString();
  return readCostsSync(today, today);
}

/**
 * Read costs for an issue
 */
export function readIssueCostsSync(issueId: string, days: number = 30): CostEntry[] {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const allCosts = readCostsSync(
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  );

  return allCosts.filter(entry => entry.issueId === issueId);
}

// ============== Cost Aggregation ==============

/**
 * Calculate cost summary for a set of entries
 */
export function summarizeCostsSync(entries: CostEntry[]): CostSummary {
  const summary: CostSummary = {
    totalCost: 0,
    currency: 'USD',
    period: {
      start: entries[0]?.timestamp || new Date().toISOString(),
      end: entries[entries.length - 1]?.timestamp || new Date().toISOString(),
    },
    byProvider: {} as Record<AIProvider, number>,
    byModel: {},
    byIssue: {},
    byFeature: {},
    entryCount: entries.length,
    totalTokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };

  for (const entry of entries) {
    summary.totalCost += entry.cost;

    // By provider
    summary.byProvider[entry.provider] =
      (summary.byProvider[entry.provider] || 0) + entry.cost;

    // By model
    summary.byModel[entry.model] =
      (summary.byModel[entry.model] || 0) + entry.cost;

    // By issue
    if (entry.issueId) {
      summary.byIssue[entry.issueId] =
        (summary.byIssue[entry.issueId] || 0) + entry.cost;
    }

    // By feature
    if (entry.featureId) {
      summary.byFeature[entry.featureId] =
        (summary.byFeature[entry.featureId] || 0) + entry.cost;
    }

    // Tokens
    summary.totalTokens.input += entry.usage.inputTokens;
    summary.totalTokens.output += entry.usage.outputTokens;
    summary.totalTokens.cacheRead += entry.usage.cacheReadTokens || 0;
    summary.totalTokens.cacheWrite += entry.usage.cacheWriteTokens || 0;
  }

  // Total includes all token types
  summary.totalTokens.total = summary.totalTokens.input
    + summary.totalTokens.output
    + summary.totalTokens.cacheRead
    + summary.totalTokens.cacheWrite;
  summary.totalCost = Math.round(summary.totalCost * 100) / 100;

  return summary;
}

/**
 * Get daily cost summary
 */
export function getDailySummarySync(date?: string): CostSummary {
  const targetDate = date || getCurrentDateString();
  const entries = readCostsSync(targetDate, targetDate);
  return summarizeCostsSync(entries);
}

/**
 * Get weekly cost summary
 */
export function getWeeklySummarySync(): CostSummary {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const entries = readCostsSync(
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  );

  return summarizeCostsSync(entries);
}

/**
 * Get monthly cost summary
 */
export function getMonthlySummarySync(): CostSummary {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const entries = readCostsSync(
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  );

  return summarizeCostsSync(entries);
}

// ============== Cost Budgets ==============

const BUDGETS_FILE = join(COSTS_DIR, 'budgets.json');

function loadBudgets(): CostBudget[] {
  if (!existsSync(BUDGETS_FILE)) {
    return [];
  }

  try {
    const content = readFileSync(BUDGETS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function saveBudgets(budgets: CostBudget[]): void {
  mkdirSync(COSTS_DIR, { recursive: true });
  writeFileSync(BUDGETS_FILE, JSON.stringify(budgets, null, 2));
}

/**
 * Create a cost budget
 */
export function createBudgetSync(budget: Omit<CostBudget, 'id' | 'spent'>): CostBudget {
  const budgets = loadBudgets();

  const newBudget: CostBudget = {
    ...budget,
    id: `budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    spent: 0,
  };

  budgets.push(newBudget);
  saveBudgets(budgets);

  return newBudget;
}

/**
 * Get a budget by ID
 */
export function getBudgetSync(id: string): CostBudget | null {
  const budgets = loadBudgets();
  return budgets.find(b => b.id === id) || null;
}

/**
 * Get all budgets
 */
export function getAllBudgetsSync(): CostBudget[] {
  return loadBudgets();
}

/**
 * Update budget spent amount
 */
export function updateBudgetSpentSync(id: string, spent: number): boolean {
  const budgets = loadBudgets();
  const budget = budgets.find(b => b.id === id);

  if (!budget) return false;

  budget.spent = spent;
  saveBudgets(budgets);

  return true;
}

/**
 * Check budget status
 */
export function checkBudgetSync(id: string): {
  budget: CostBudget | null;
  remaining: number;
  percentUsed: number;
  exceeded: boolean;
  alert: boolean;
} {
  const budget = getBudgetSync(id);

  if (!budget) {
    return {
      budget: null,
      remaining: 0,
      percentUsed: 0,
      exceeded: false,
      alert: false,
    };
  }

  const remaining = budget.limit - budget.spent;
  const percentUsed = budget.spent / budget.limit;

  return {
    budget,
    remaining,
    percentUsed,
    exceeded: percentUsed >= 1,
    alert: percentUsed >= budget.alertThreshold,
  };
}

/**
 * Delete a budget
 */
export function deleteBudgetSync(id: string): boolean {
  const budgets = loadBudgets();
  const index = budgets.findIndex(b => b.id === id);

  if (index === -1) return false;

  budgets.splice(index, 1);
  saveBudgets(budgets);

  return true;
}

// ============== Reports ==============

/**
 * Generate a cost report
 */
export function generateReportSync(startDate: string, endDate: string): string {
  const entries = readCostsSync(startDate, endDate);
  const summary = summarizeCostsSync(entries);

  const lines: string[] = [
    '# Cost Report',
    '',
    `**Period:** ${startDate} to ${endDate}`,
    '',
    '## Summary',
    '',
    `- **Total Cost:** $${summary.totalCost.toFixed(2)}`,
    `- **Total Entries:** ${summary.entryCount}`,
    `- **Total Tokens:** ${summary.totalTokens.total.toLocaleString()}`,
    `  - Input: ${summary.totalTokens.input.toLocaleString()}`,
    `  - Output: ${summary.totalTokens.output.toLocaleString()}`,
    '',
    '## By Provider',
    '',
  ];

  for (const [provider, cost] of Object.entries(summary.byProvider)) {
    lines.push(`- **${provider}:** $${cost.toFixed(2)}`);
  }

  lines.push('');
  lines.push('## By Model');
  lines.push('');

  for (const [model, cost] of Object.entries(summary.byModel)) {
    lines.push(`- **${model}:** $${cost.toFixed(2)}`);
  }

  if (Object.keys(summary.byIssue).length > 0) {
    lines.push('');
    lines.push('## By Issue');
    lines.push('');

    const sortedIssues = Object.entries(summary.byIssue)
      .sort(([, a], [, b]) => b - a);

    for (const [issue, cost] of sortedIssues.slice(0, 10)) {
      lines.push(`- **${issue}:** $${cost.toFixed(2)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format cost for display
 */
export function formatCostSync(cost: number, currency: string = 'USD'): string {
  if (currency === 'USD') {
    return `$${cost.toFixed(4)}`;
  }
  return `${cost.toFixed(4)} ${currency}`;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Cost-tracking helpers — sync FS by design (CLI / cron scripts). Read paths
// are Effect.sync; write paths surface FsError via Effect.try.

/** Compute the cost of one token-usage record at given pricing. Pure. */
export const calculateCost = (
  usage: TokenUsage,
  pricing: ModelPricing,
): Effect.Effect<number> => Effect.sync(() => calculateCostSync(usage, pricing));

/** Look up pricing for a (provider, model) pair. Pure. */
export const getPricing = (
  provider: AIProvider,
  model: string,
): Effect.Effect<ModelPricing | null> => Effect.sync(() => getPricingSync(provider, model));

/** Append a single cost entry to the cost log. */
export const logCost = (
  entry: Omit<CostEntry, 'id' | 'timestamp'>,
): Effect.Effect<CostEntry, FsError> =>
  Effect.try({
    try: () => logCostSync(entry),
    catch: (cause) => new FsError({ path: COSTS_DIR, operation: 'log-cost', cause }),
  });

/** Convenience wrapper: compute cost then log. */
export const logUsage = (
  ...args: Parameters<typeof logUsageSync>
): Effect.Effect<ReturnType<typeof logUsageSync>, FsError> =>
  Effect.try({
    try: () => logUsageSync(...args),
    catch: (cause) => new FsError({ path: COSTS_DIR, operation: 'log-usage', cause }),
  });

/** Read entries across an inclusive date range. Pure-ish. */
export const readCosts = (
  startDate: string,
  endDate: string,
): Effect.Effect<CostEntry[]> => Effect.sync(() => readCostsSync(startDate, endDate));

/** Read today's cost entries. Pure-ish. */
export const readTodayCosts = (): Effect.Effect<CostEntry[]> =>
  Effect.sync(() => readTodayCostsSync());

/** Read recent cost entries scoped to an issue. Pure-ish. */
export const readIssueCosts = (
  issueId: string,
  days: number = 30,
): Effect.Effect<CostEntry[]> => Effect.sync(() => readIssueCostsSync(issueId, days));

/** Summarize a flat list of cost entries. Pure. */
export const summarizeCosts = (
  entries: CostEntry[],
): Effect.Effect<CostSummary> => Effect.sync(() => summarizeCostsSync(entries));

/** Daily / weekly / monthly rollups. Pure-ish. */
export const getDailySummary = (date?: string): Effect.Effect<CostSummary> =>
  Effect.sync(() => getDailySummarySync(date));
export const getWeeklySummary = (): Effect.Effect<CostSummary> =>
  Effect.sync(() => getWeeklySummarySync());
export const getMonthlySummary = (): Effect.Effect<CostSummary> =>
  Effect.sync(() => getMonthlySummarySync());

/** Budget CRUD. */
export const createBudget = (
  budget: Omit<CostBudget, 'id' | 'spent'>,
): Effect.Effect<CostBudget, FsError> =>
  Effect.try({
    try: () => createBudgetSync(budget),
    catch: (cause) =>
      new FsError({ path: COSTS_DIR, operation: 'create-budget', cause }),
  });
export const getBudget = (id: string): Effect.Effect<CostBudget | null> =>
  Effect.sync(() => getBudgetSync(id));
export const getAllBudgets = (): Effect.Effect<CostBudget[]> =>
  Effect.sync(() => getAllBudgetsSync());
export const updateBudgetSpent = (
  id: string,
  spent: number,
): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => updateBudgetSpentSync(id, spent),
    catch: (cause) =>
      new FsError({ path: COSTS_DIR, operation: 'update-budget-spent', cause }),
  });
export const checkBudget = (
  id: string,
): Effect.Effect<ReturnType<typeof checkBudgetSync>> => Effect.sync(() => checkBudgetSync(id));
export const deleteBudget = (id: string): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => deleteBudgetSync(id),
    catch: (cause) =>
      new FsError({ path: COSTS_DIR, operation: 'delete-budget', cause }),
  });

/** Render a human-readable cost report. Pure-ish. */
export const generateReport = (
  startDate: string,
  endDate: string,
): Effect.Effect<string> => Effect.sync(() => generateReportSync(startDate, endDate));

/** Format a cost number for display. Pure. */
export const formatCost = (
  cost: number,
  currency: string = 'USD',
): Effect.Effect<string> => Effect.sync(() => formatCostSync(cost, currency));
