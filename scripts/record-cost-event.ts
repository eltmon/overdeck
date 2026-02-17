#!/usr/bin/env node
/**
 * Record cost events from Claude Code transcript data
 * Called by heartbeat-hook with PostToolUse JSON on stdin
 *
 * Claude Code's PostToolUse events do NOT include token usage.
 * Instead, we read usage from the transcript JSONL file
 * (available via the transcript_path field in the event).
 *
 * Uses byte-offset tracking to efficiently process only new
 * transcript entries on each invocation.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { calculateCost, getPricing, AIProvider } from '../src/lib/cost.js';
import { appendCostEvent } from '../src/lib/costs/events.js';

// ============== Types ==============

interface PostToolUseEvent {
  session_id?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_use_id?: string;
}

interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface TranscriptEntry {
  type?: string;
  message?: {
    model?: string;
    usage?: TranscriptUsage;
  };
  requestId?: string;
}

// ============== Main ==============

// Read PostToolUse event from stdin
let event: PostToolUseEvent;
try {
  const input = readFileSync(0, 'utf-8');
  event = JSON.parse(input) as PostToolUseEvent;
} catch {
  process.exit(0);
}

// Need transcript path to read usage data
const transcriptPath = event?.transcript_path;
if (!transcriptPath || !existsSync(transcriptPath)) {
  process.exit(0);
}

const sessionId = event?.session_id || 'unknown';

// State tracking: byte offset per session to avoid re-processing
const stateDir = join(process.env.HOME || homedir(), '.panopticon', 'costs', 'state');
mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, `${sessionId}.offset`);

let lastOffset = 0;
if (existsSync(stateFile)) {
  try {
    lastOffset = parseInt(readFileSync(stateFile, 'utf-8').trim(), 10) || 0;
  } catch { /* start from 0 */ }
}

// Read only NEW content from the transcript (efficient for large files)
let fd: number;
try {
  fd = openSync(transcriptPath, 'r');
} catch {
  process.exit(0);
}

const stat = fstatSync(fd);
if (stat.size <= lastOffset) {
  closeSync(fd);
  // Save current size even if no new content (handles file truncation)
  writeFileSync(stateFile, String(stat.size), 'utf-8');
  process.exit(0);
}

const bytesToRead = stat.size - lastOffset;
const buffer = Buffer.alloc(bytesToRead);
readSync(fd, buffer, 0, bytesToRead, lastOffset);
closeSync(fd);

const newContent = buffer.toString('utf-8');
const lines = newContent.split('\n');

// Get agent/issue context from environment
const agentId: string = process.env.PANOPTICON_AGENT_ID || 'unattributed';
const issueId: string = process.env.PANOPTICON_ISSUE_ID || 'UNKNOWN';
const sessionType: string = process.env.PANOPTICON_SESSION_TYPE || 'implementation';

// Process new transcript lines looking for assistant messages with usage
for (const line of lines) {
  if (!line.trim()) continue;

  try {
    const entry = JSON.parse(line) as TranscriptEntry;

    // Only process assistant messages that have usage data
    if (entry.type !== 'assistant' || !entry.message?.usage) {
      continue;
    }

    const usage = entry.message.usage;
    const model: string = entry.message.model || 'claude-sonnet-4';

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;

    // Skip entries with zero tokens
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) {
      continue;
    }

    // Determine provider from model name
    let provider: AIProvider = 'anthropic';
    if (model.includes('gpt')) {
      provider = 'openai';
    } else if (model.includes('gemini')) {
      provider = 'google';
    }

    // Get pricing and calculate cost
    const pricing = getPricing(provider, model);
    if (!pricing) continue;

    const cost = calculateCost({
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheTTL: '5m',
    }, pricing);

    // Record the cost event
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
  } catch {
    // Skip malformed lines silently
  }
}

// Save new byte offset for next invocation
writeFileSync(stateFile, String(stat.size), 'utf-8');

process.exit(0);
