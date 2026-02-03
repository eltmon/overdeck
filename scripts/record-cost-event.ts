#!/usr/bin/env node
/**
 * Record a cost event from Claude Code tool usage
 * Called by heartbeat-hook with JSON input on stdin
 */

import { readFileSync } from 'fs';
import { calculateCost, getPricing, AIProvider } from '../src/lib/cost.js';
import { appendCostEvent } from '../src/lib/costs/events.js';

// ============== Types ==============

interface UsageData {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ToolInfo {
  model?: string;
  usage?: UsageData;
  message?: {
    model?: string;
    usage?: UsageData;
  };
}

// ============== Main ==============

// Read tool info from stdin
let toolInfo: ToolInfo;
try {
  const input = readFileSync(0, 'utf-8');
  toolInfo = JSON.parse(input) as ToolInfo;
} catch (err) {
  // Silent failure - don't break Claude Code execution
  process.exit(0);
}

// Extract usage data from tool info
const usage: UsageData | undefined = toolInfo?.usage || toolInfo?.message?.usage;
if (!usage) {
  // No usage data - not a Claude API call
  process.exit(0);
}

// Extract token counts
const inputTokens = usage.input_tokens || 0;
const outputTokens = usage.output_tokens || 0;
const cacheReadTokens = usage.cache_read_input_tokens || 0;
const cacheWriteTokens = usage.cache_creation_input_tokens || 0;

// Must have at least some tokens to record
if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) {
  process.exit(0);
}

// Extract model name
const model: string = toolInfo?.model || toolInfo?.message?.model || 'claude-sonnet-4';

// Determine provider from model name
let provider: AIProvider = 'anthropic';
if (model.includes('gpt')) {
  provider = 'openai';
} else if (model.includes('gemini')) {
  provider = 'google';
}

// Get pricing and calculate cost
const pricing = getPricing(provider, model);
if (!pricing) {
  console.warn(`No pricing found for ${provider}/${model}`);
  process.exit(0);
}

const cost = calculateCost({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  cacheTTL: '5m',
}, pricing);

// Get agent and issue context from environment
// PANOPTICON_AGENT_ID should always be set by pan work or heartbeat-hook
// If not set, use a fallback that makes it clear costs are unattributed
const agentId: string = process.env.PANOPTICON_AGENT_ID || 'unattributed';
const issueId: string = process.env.PANOPTICON_ISSUE_ID || 'UNKNOWN';
const sessionType: string = process.env.PANOPTICON_SESSION_TYPE || 'implementation';

// Record cost event
try {
  appendCostEvent({
    ts: new Date().toISOString(),
    type: 'cost',
    agentId,
    issueId,
    sessionType,
    provider,
    model,
    input: inputTokens,
    output: outputTokens,
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
    cost,
  });
} catch (err) {
  // Silent failure - don't break Claude Code execution
  console.error('Failed to record cost event:', err);
}

process.exit(0);
