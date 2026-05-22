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
import { execFileSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { calculateCost, getPricing, AIProvider } from '../../src/lib/cost.js';
import { appendCostEvent } from '../../src/lib/costs/events.js';
import { captureTldrMetrics, type TldrSessionMetrics } from '../../src/lib/tldr-daemon.js';

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

// Load persisted seen requestIds to guard against crash-before-write duplicates (PAN-238)
// Claude Code's transcript can have multiple entries per requestId — we emit exactly one event per requestId.
const seenFile = join(stateDir, `${sessionId}.seen`);
const seenRequestIds = new Set<string>();
if (existsSync(seenFile)) {
  try {
    const seenContent = readFileSync(seenFile, 'utf-8').trim();
    if (seenContent) {
      for (const id of seenContent.split('\n')) {
        if (id.trim()) seenRequestIds.add(id.trim());
      }
    }
  } catch { /* start fresh */ }
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

// Get agent/issue context from environment, with git branch fallback
const agentId: string = process.env.PANOPTICON_AGENT_ID || 'unattributed';
let issueId: string = process.env.PANOPTICON_ISSUE_ID || '';
const sessionType: string = process.env.PANOPTICON_SESSION_TYPE || 'implementation';
// Caveman A/B test variant — set by agent launcher when agents.caveman.ab_test is active (PAN-611)
const cavemanVariant = process.env.PANOPTICON_CAVEMAN_VARIANT as 'enabled' | 'disabled' | 'off' | undefined;

// Infer issue ID from git branch if not set (covers ad-hoc Claude sessions)
if (!issueId || issueId === 'UNKNOWN') {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const branchMatch = branch.match(/(pan|min|aud|krux|cli)[-](\d+)/i);
    if (branchMatch) {
      issueId = `${branchMatch[1].toUpperCase()}-${branchMatch[2]}`;
    }
  } catch {
    // Git not available or not in a repo — that's fine
  }
}

// Final fallback
if (!issueId) {
  issueId = 'UNKNOWN';
}

// Capture TLDR metrics for this batch (PAN-236)
// Find workspace root via git (same process already used for branch detection above)
let tldrMetrics: TldrSessionMetrics | null = null;
try {
  const workspaceRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
    timeout: 2000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  if (workspaceRoot) {
    tldrMetrics = captureTldrMetrics(workspaceRoot);
  }
} catch { /* git not available or no workspace — skip TLDR metrics */ }

// Process new transcript lines looking for assistant messages with usage
let tldrAttachedToFirstEvent = false;
for (const line of lines) {
  if (!line.trim()) continue;

  try {
    const entry = JSON.parse(line) as TranscriptEntry;

    // Only process assistant messages that have usage data
    if (entry.type !== 'assistant' || !entry.message?.usage) {
      continue;
    }

    // Skip already-seen requestIds — transcript has multiple entries per API request (PAN-238)
    const requestId = entry.requestId;
    if (requestId) {
      if (seenRequestIds.has(requestId)) {
        continue; // Duplicate entry for this request — already emitted a cost event
      }
      seenRequestIds.add(requestId);
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
    } else if (model.includes('kimi') || model.toLowerCase().startsWith('minimax')) {
      provider = 'custom';
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

    // Attach TLDR metrics to the first event in each batch (delta since last batch)
    const tldrFields = tldrMetrics && !tldrAttachedToFirstEvent && tldrMetrics.interceptions + tldrMetrics.bypasses > 0
      ? {
          tldrInterceptions: tldrMetrics.interceptions,
          tldrBypasses: tldrMetrics.bypasses,
          tldrTokensSaved: tldrMetrics.estimatedTokensSaved,
          tldrBypassReasons: Object.keys(tldrMetrics.bypassReasons).length > 0
            ? tldrMetrics.bypassReasons
            : undefined,
        }
      : {};

    if (tldrMetrics && !tldrAttachedToFirstEvent) {
      tldrAttachedToFirstEvent = true;
    }

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
      ...(requestId ? { requestId } : {}),
      sessionId,
      ...tldrFields,
      ...(cavemanVariant ? { cavemanVariant } : {}),
    });
  } catch {
    // Skip malformed lines silently
  }
}

// Save new byte offset and seen requestIds for next invocation
writeFileSync(stateFile, String(stat.size), 'utf-8');
if (seenRequestIds.size > 0) {
  writeFileSync(seenFile, Array.from(seenRequestIds).join('\n') + '\n', 'utf-8');
}

process.exit(0);
