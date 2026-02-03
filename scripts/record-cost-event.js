#!/usr/bin/env node
/**
 * Record a cost event from Claude Code tool usage
 * Called by heartbeat-hook with JSON input on stdin
 */

import { readFileSync } from 'fs';
import { calculateCost, getPricing } from '../src/lib/cost.js';
import { appendCostEvent } from '../src/lib/costs/events.js';

// Read tool info from stdin
let toolInfo;
try {
  const input = readFileSync(0, 'utf-8');
  toolInfo = JSON.parse(input);
} catch (err) {
  // Silent failure - don't break Claude Code execution
  process.exit(0);
}

// Extract usage data from tool info
const usage = toolInfo?.usage || toolInfo?.message?.usage;
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
const model = toolInfo?.model || toolInfo?.message?.model || 'claude-sonnet-4';

// Determine provider from model name
let provider = 'anthropic';
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
const agentId = process.env.PANOPTICON_AGENT_ID ||
                process.env.TMUX_PANE?.replace(/^%/, '') ||
                'main-cli';

const issueId = process.env.PANOPTICON_ISSUE_ID || 'UNKNOWN';
const sessionType = process.env.PANOPTICON_SESSION_TYPE || 'implementation';

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
