/**
 * Cost Tracking System
 *
 * Track AI usage costs per feature, issue, and project.
 * Supports multiple AI providers with configurable pricing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { COSTS_DIR } from './paths.js';

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
  // Anthropic - 4.5 series
  { provider: 'anthropic', model: 'claude-opus-4.5', inputPer1k: 0.005, outputPer1k: 0.025, cacheReadPer1k: 0.0005, cacheWrite5mPer1k: 0.00625, cacheWrite1hPer1k: 0.01, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-sonnet-4.5', inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003, cacheWrite5mPer1k: 0.00375, cacheWrite1hPer1k: 0.006, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-haiku-4.5', inputPer1k: 0.001, outputPer1k: 0.005, cacheReadPer1k: 0.0001, cacheWrite5mPer1k: 0.00125, cacheWrite1hPer1k: 0.002, currency: 'USD' },
  // Anthropic - 4.x series
  { provider: 'anthropic', model: 'claude-opus-4-1', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 0.0015, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-opus-4', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 0.0015, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03, currency: 'USD' },
  { provider: 'anthropic', model: 'claude-sonnet-4', inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003, cacheWrite5mPer1k: 0.00375, cacheWrite1hPer1k: 0.006, currency: 'USD' },
  // Anthropic - Legacy
  { provider: 'anthropic', model: 'claude-haiku-3', inputPer1k: 0.00025, outputPer1k: 0.00125, cacheReadPer1k: 0.00003, cacheWrite5mPer1k: 0.0003, cacheWrite1hPer1k: 0.0005, currency: 'USD' },
  // OpenAI
  { provider: 'openai', model: 'gpt-4-turbo', inputPer1k: 0.01, outputPer1k: 0.03, currency: 'USD' },
  { provider: 'openai', model: 'gpt-4o', inputPer1k: 0.005, outputPer1k: 0.015, currency: 'USD' },
  { provider: 'openai', model: 'gpt-4o-mini', inputPer1k: 0.00015, outputPer1k: 0.0006, currency: 'USD' },
  // Google
  { provider: 'google', model: 'gemini-1.5-pro', inputPer1k: 0.00125, outputPer1k: 0.005, currency: 'USD' },
  { provider: 'google', model: 'gemini-1.5-flash', inputPer1k: 0.000075, outputPer1k: 0.0003, currency: 'USD' },
];

// ============== Cost Calculation ==============

/**
 * Calculate cost for token usage
 */
export function calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
  let cost = 0;
  let inputMultiplier = 1;
  let outputMultiplier = 1;

  // Long-context pricing for Sonnet 4/4.5 (>200K total input tokens)
  // Total input includes: inputTokens + cacheReadTokens + cacheWriteTokens
  const totalInputTokens = usage.inputTokens
    + (usage.cacheReadTokens || 0)
    + (usage.cacheWriteTokens || 0);

  if ((pricing.model === 'claude-sonnet-4' || pricing.model === 'claude-sonnet-4.5')
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
export function getPricing(provider: AIProvider, model: string): ModelPricing | null {
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
export function logCost(entry: Omit<CostEntry, 'id' | 'timestamp'>): CostEntry {
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
export function logUsage(
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
  const pricing = getPricing(provider, model);
  if (!pricing) {
    console.warn(`No pricing found for ${provider}/${model}`);
    return null;
  }

  const cost = calculateCost(usage, pricing);

  return logCost({
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
export function readCosts(startDate: string, endDate: string): CostEntry[] {
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
export function readTodayCosts(): CostEntry[] {
  const today = getCurrentDateString();
  return readCosts(today, today);
}

/**
 * Read costs for an issue
 */
export function readIssueCosts(issueId: string, days: number = 30): CostEntry[] {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const allCosts = readCosts(
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  );

  return allCosts.filter(entry => entry.issueId === issueId);
}

// ============== Cost Aggregation ==============

/**
 * Calculate cost summary for a set of entries
 */
export function summarizeCosts(entries: CostEntry[]): CostSummary {
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
export function getDailySummary(date?: string): CostSummary {
  const targetDate = date || getCurrentDateString();
  const entries = readCosts(targetDate, targetDate);
  return summarizeCosts(entries);
}

/**
 * Get weekly cost summary
 */
export function getWeeklySummary(): CostSummary {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const entries = readCosts(
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  );

  return summarizeCosts(entries);
}

/**
 * Get monthly cost summary
 */
export function getMonthlySummary(): CostSummary {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const entries = readCosts(
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  );

  return summarizeCosts(entries);
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
export function createBudget(budget: Omit<CostBudget, 'id' | 'spent'>): CostBudget {
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
export function getBudget(id: string): CostBudget | null {
  const budgets = loadBudgets();
  return budgets.find(b => b.id === id) || null;
}

/**
 * Get all budgets
 */
export function getAllBudgets(): CostBudget[] {
  return loadBudgets();
}

/**
 * Update budget spent amount
 */
export function updateBudgetSpent(id: string, spent: number): boolean {
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
export function checkBudget(id: string): {
  budget: CostBudget | null;
  remaining: number;
  percentUsed: number;
  exceeded: boolean;
  alert: boolean;
} {
  const budget = getBudget(id);

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
export function deleteBudget(id: string): boolean {
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
export function generateReport(startDate: string, endDate: string): string {
  const entries = readCosts(startDate, endDate);
  const summary = summarizeCosts(entries);

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
export function formatCost(cost: number, currency: string = 'USD'): string {
  if (currency === 'USD') {
    return `$${cost.toFixed(4)}`;
  }
  return `${cost.toFixed(4)} ${currency}`;
}
