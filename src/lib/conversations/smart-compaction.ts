import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { getProviderEnvForModel } from '../agents.js';

const SUMMARY_TIMEOUT_MS = 60_000;
const FORK_SUMMARY_TIMEOUT_MS = 300_000;

const DEFAULT_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

export interface CompactionOptions {
  jsonlPath: string;
  model?: string;
  keepRecentTokens?: number;
  reserveTokens?: number;
  richMode?: boolean;
  /** 'compact' = native compaction (returns stub if nothing to summarize). 'fork' = always produce a real summary for conversation forks. */
  mode?: 'compact' | 'fork';
}

export interface CompactionResult {
  summary: string;
  tokensBefore: number;
  firstKeptEntryIndex: number;
  summaryModel: string | null;
  readFiles: string[];
  modifiedFiles: string[];
}

interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

interface CutPointResult {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

// ============================================================================
// Entry parsing
// ============================================================================

async function parseEntries(jsonlPath: string): Promise<any[]> {
  const content = await readFile(jsonlPath, 'utf-8');
  const entries: any[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return entries;
}

// ============================================================================
// Token estimation (chars/4 heuristic, conservative)
// ============================================================================

function estimateTokens(entry: any): number {
  if (!entry) return 0;

  // Compact boundary / system entries
  if (entry.type === 'system' || entry.subtype === 'compact_boundary') {
    const text = entry.content || '';
    return Math.ceil(text.length / 4);
  }

  // User entries (including compact summaries and tool results)
  if (entry.type === 'user' && entry.message) {
    const content = entry.message.content;
    if (typeof content === 'string') {
      return Math.ceil(content.length / 4);
    }
    if (Array.isArray(content)) {
      let chars = 0;
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          chars += block.text.length;
        } else if (block.type === 'tool_result') {
          // Estimate tool result content
          if (typeof block.content === 'string') {
            chars += block.content.length;
          } else if (Array.isArray(block.content)) {
            for (const b of block.content) {
              if (b.text) chars += b.text.length;
            }
          }
        } else if (block.type === 'image') {
          chars += 4800; // ~1200 tokens
        }
      }
      return Math.ceil(chars / 4);
    }
  }

  // Assistant entries
  if (entry.type === 'assistant' && entry.message) {
    const content = entry.message.content;
    if (Array.isArray(content)) {
      let chars = 0;
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          chars += block.text.length;
        } else if (block.type === 'thinking' && block.thinking) {
          chars += block.thinking.length;
        } else if (block.type === 'tool_use') {
          chars += block.name?.length || 0;
          chars += JSON.stringify(block.input || {}).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    if (typeof content === 'string') {
      return Math.ceil(content.length / 4);
    }
  }

  return 0;
}

function estimateContextTokens(entries: any[]): number {
  // Use the last assistant usage if available, otherwise heuristic
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'assistant' && entry.message?.usage) {
      const u = entry.message.usage;
      if (typeof u.input_tokens === 'number') {
        let total = u.input_tokens || 0;
        if (typeof u.output_tokens === 'number') total += u.output_tokens;
        if (typeof u.cache_creation_input_tokens === 'number') total += u.cache_creation_input_tokens;
        if (typeof u.cache_read_input_tokens === 'number') total += u.cache_read_input_tokens;
        // Add trailing entries after this assistant
        for (let j = i + 1; j < entries.length; j++) {
          total += estimateTokens(entries[j]);
        }
        return total;
      }
      if (typeof u.inputTokens === 'number') {
        let total = u.inputTokens || 0;
        if (typeof u.outputTokens === 'number') total += u.outputTokens;
        if (typeof u.cacheCreationInputTokens === 'number') total += u.cacheCreationInputTokens;
        if (typeof u.cacheReadInputTokens === 'number') total += u.cacheReadInputTokens;
        for (let j = i + 1; j < entries.length; j++) {
          total += estimateTokens(entries[j]);
        }
        return total;
      }
    }
  }

  // Fallback: sum all heuristics
  return entries.reduce((sum, e) => sum + estimateTokens(e), 0);
}

// ============================================================================
// File operation tracking
// ============================================================================

function createFileOps(): FileOperations {
  return { read: new Set(), written: new Set(), edited: new Set() };
}

function extractFileOpsFromEntries(entries: any[]): FileOperations {
  const fileOps = createFileOps();
  for (const entry of entries) {
    if (entry.type !== 'assistant' || !entry.message?.content) continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use' || !block.input) continue;
      const path = block.input.file_path || block.input.path;
      if (!path) continue;
      switch (block.name) {
        case 'Read':
        case 'read':
          fileOps.read.add(path);
          break;
        case 'Write':
        case 'write':
          fileOps.written.add(path);
          break;
        case 'Edit':
        case 'edit':
          fileOps.edited.add(path);
          break;
      }
    }
  }
  return fileOps;
}

function computeFileLists(fileOps: FileOperations): { readFiles: string[]; modifiedFiles: string[] } {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readOnly = [...fileOps.read].filter(f => !modified.has(f)).sort();
  return { readFiles: readOnly, modifiedFiles: [...modified].sort() };
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join('\n')}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join('\n')}\n</modified-files>`);
  }
  if (sections.length === 0) return '';
  return '\n\n' + sections.join('\n\n');
}

// ============================================================================
// Previous compact boundary detection
// ============================================================================

function findPreviousCompactBoundary(entries: any[]): { index: number; summary: string } | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    // Panopticon native compaction writes compact_boundary then a user summary entry
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      // Look immediately after for the summary user message
      if (i + 1 < entries.length) {
        const next = entries[i + 1];
        if (next.type === 'user' && next.isCompactSummary && next.message?.content) {
          return { index: i, summary: next.message.content };
        }
      }
    }
    // Also detect older compact summary entries
    if (entry.type === 'user' && entry.isCompactSummary && entry.message?.content) {
      return { index: i, summary: entry.message.content };
    }
  }
  return null;
}

// ============================================================================
// Cut point detection (inspired by Pi agent)
// ============================================================================

function isUserMessageEntry(entry: any): boolean {
  if (entry.type !== 'user' || !entry.message) return false;
  const content = entry.message.content;
  // A pure tool_result user entry is not a turn-starting user message
  if (Array.isArray(content)) {
    const hasText = content.some((b: any) => b.type === 'text' && b.text?.trim());
    return hasText;
  }
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  return false;
}

function isAssistantEntry(entry: any): boolean {
  return entry.type === 'assistant' && !!entry.message;
}

function findValidCutPoints(entries: any[], startIndex: number, endIndex: number): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    if (isUserMessageEntry(entries[i]) || isAssistantEntry(entries[i])) {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

function findTurnStartIndex(entries: any[], entryIndex: number, startIndex: number): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    if (isUserMessageEntry(entries[i])) {
      return i;
    }
  }
  return -1;
}

function findCutPoint(
  entries: any[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }

  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const tokens = estimateTokens(entries[i]);
    accumulatedTokens += tokens;

    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }

  // Scan backwards to include non-message metadata entries after a boundary.
  // Never scan past the previous valid cut point (or the original cut point
  // itself if it's the first valid one).
  const originalCutIndex = cutIndex;
  const cutPointArrayIndex = cutPoints.findIndex((cp) => cp === originalCutIndex);
  const minCutIndex = cutPointArrayIndex > 0 ? cutPoints[cutPointArrayIndex - 1]! + 1 : originalCutIndex;

  while (cutIndex > startIndex && cutIndex > minCutIndex) {
    const prev = entries[cutIndex - 1];
    if (prev.type === 'system' && prev.subtype === 'compact_boundary') break;
    if (isUserMessageEntry(prev) || isAssistantEntry(prev)) break;
    cutIndex--;
  }

  const isUser = isUserMessageEntry(entries[cutIndex]);
  const turnStartIndex = isUser ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUser && turnStartIndex !== -1,
  };
}

// ============================================================================
// Conversation serialization
// ============================================================================

const TOOL_RESULT_MAX_CHARS = 2000;

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... ${text.length - maxChars} more characters truncated]`;
}

function serializeEntry(entry: any): string | undefined {
  if (entry.type === 'user' && entry.message) {
    const content = entry.message.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          parts.push(block.text);
        } else if (block.type === 'tool_result') {
          let resultText = '';
          if (typeof block.content === 'string') {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter((b: any) => b.type === 'text' && b.text)
              .map((b: any) => b.text)
              .join('\n');
          }
          if (resultText) {
            parts.push(`[Tool result]: ${truncateForSummary(resultText, TOOL_RESULT_MAX_CHARS)}`);
          }
        }
      }
      text = parts.join('\n');
    }
    if (text.trim()) {
      return `[User]: ${text.trim()}`;
    }
  }

  if (entry.type === 'assistant' && entry.message) {
    const content = entry.message.content;
    const parts: string[] = [];
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      const toolCalls: string[] = [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'thinking' && block.thinking) {
          textParts.push(`[thinking]: ${block.thinking}`);
        } else if (block.type === 'tool_use') {
          const args = block.input || {};
          const argsStr = Object.entries(args)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ');
          toolCalls.push(`${block.name}(${argsStr})`);
        }
      }
      if (textParts.length) parts.push(`[Assistant]: ${textParts.join('\n')}`);
      if (toolCalls.length) parts.push(`[Assistant tool calls]: ${toolCalls.join('; ')}`);
    } else if (typeof content === 'string') {
      parts.push(`[Assistant]: ${content}`);
    }
    if (parts.length) {
      return parts.join('\n\n');
    }
  }

  if (entry.type === 'system' && entry.subtype === 'compact_boundary' && entry.content) {
    return `[Context checkpoint]: ${entry.content}`;
  }

  return undefined;
}

function serializeConversation(entries: any[]): string {
  const parts: string[] = [];
  for (const entry of entries) {
    const serialized = serializeEntry(entry);
    if (serialized) parts.push(serialized);
  }
  return parts.join('\n\n');
}

// ============================================================================
// Summarization prompts
// ============================================================================

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

// ============================================================================
// Rich summarization prompts (9-section format, more verbose)
// ============================================================================

const RICH_SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a comprehensive continuation summary that another LLM will use to continue the work without losing context.

Use this EXACT format:

## Primary Request and Intent
[What is the user trying to accomplish? Include explicit asks, constraints, and intended outcome.]

## Key Technical Concepts
- [Major technical topics, tools, frameworks, libraries, patterns, and architectural ideas]
- [Or "(none)" if none were mentioned]

## Files and Code Sections
- [File name]: [why it matters, what was examined or changed, include important code snippets in full when applicable]
- [Or "(none)" if not applicable]

## Errors and fixes
- [What went wrong and how it was fixed or addressed]
- [Or "(none)" if none occurred]

## Problem Solving
[Problems resolved and any ongoing troubleshooting]

## All user messages
- [Every user message in the conversation that was not a tool result. Do not omit any.]
- [Or "(none)" if not applicable]

## Pending Tasks
- [All unfinished work the user has explicitly asked for]
- [Or "(none)" if not applicable]

## Current Work
[Exactly what was being worked on immediately before this summarization request. Focus on the latest messages.]

## Optional Next Step
[The next action that should be taken, but only if it directly follows from the user's most recent request. Include exact quoted lines where useful.]

Be thorough, specific, and technically accurate. Preserve exact file paths, function names, error messages, and code snippets.`;

const RICH_UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, user messages, and context from the new messages
- UPDATE the "Current Work" section to reflect the latest state
- UPDATE "Pending Tasks" based on what was completed or newly requested
- PRESERVE exact file paths, function names, error messages, and code snippets
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Primary Request and Intent
[Preserve existing intent, add new ones if the task expanded]

## Key Technical Concepts
- [Preserve existing, add new ones discovered]

## Files and Code Sections
- [Preserve existing files, add new ones, update changed ones with full code snippets]

## Errors and fixes
- [Preserve existing, add new ones, mark resolved if appropriate]

## Problem Solving
[Update with new resolutions and ongoing troubleshooting]

## All user messages
- [Preserve existing user messages, add new ones from the recent conversation]

## Pending Tasks
- [Update based on what was completed or newly requested]

## Current Work
[Update to reflect the latest state immediately before this request]

## Optional Next Step
[Update based on current state]

Be thorough. Preserve exact file paths, function names, error messages, and code snippets.`;

// ============================================================================
// LLM call
// ============================================================================

export async function runModelSummary(prompt: string, model?: string, timeoutMs?: number): Promise<string> {
  const useModel = model || DEFAULT_SUMMARY_MODEL;
  const args = [
    '-p',
    '--model', useModel,
    '--dangerously-skip-permissions',
    '--permission-mode', 'bypassPermissions',
  ];

  let providerEnv: Record<string, string> = {};
  try {
    providerEnv = getProviderEnvForModel(useModel);
    const injectedKeys = Object.keys(providerEnv);
    if (injectedKeys.length > 0) {
      console.log(`[smart-compaction] Spawning claude -p for summary with model ${useModel}, injecting provider env: ${injectedKeys.join(', ')}`);
    } else {
      console.log(`[smart-compaction] Spawning claude -p for summary with model ${useModel} (anthropic, no provider env needed)`);
    }
  } catch (err) {
    console.warn(`[smart-compaction] Provider env lookup failed for ${useModel}:`, err instanceof Error ? err.message : String(err));
  }

  const child = spawn('claude', args, {
    env: { ...process.env, ...providerEnv } as Record<string, string>,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const effectiveTimeout = timeoutMs ?? SUMMARY_TIMEOUT_MS;

  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Summary generation timed out after ${effectiveTimeout}ms`));
    }, effectiveTimeout);

    child.stdin.end(prompt);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`Summary generation failed: ${detail}`));
        return;
      }
      const summary = stdout.trim();
      if (!summary) {
        reject(new Error(`Summary generation returned empty output`));
        return;
      }
      resolve(summary);
    });
  });
}

async function generateSummaryFromPrompt(
  serialized: string,
  previousSummary: string | undefined,
  model: string | undefined,
  richMode: boolean,
  timeoutMs?: number,
): Promise<string> {
  const conversationText = `<conversation>\n${serialized}\n</conversation>`;
  let promptText = `${conversationText}\n\n`;

  const updatePrompt = richMode ? RICH_UPDATE_SUMMARIZATION_PROMPT : UPDATE_SUMMARIZATION_PROMPT;
  const initPrompt = richMode ? RICH_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;

  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${updatePrompt}`;
  } else {
    promptText += initPrompt;
  }

  const messages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: promptText }],
    },
  ];

  // Wrap in system prompt via claude -p
  const fullPrompt = `${SUMMARIZATION_SYSTEM_PROMPT}\n\n${messages[0].content[0].text}`;
  return runModelSummary(fullPrompt, model, timeoutMs);
}

async function generateTurnPrefixSummary(
  serialized: string,
  model: string | undefined,
  timeoutMs?: number,
): Promise<string> {
  const promptText = `<conversation>\n${serialized}\n</conversation>\n\n${TURN_PREFIX_PROMPT}`;
  const fullPrompt = `${SUMMARIZATION_SYSTEM_PROMPT}\n\n${promptText}`;
  return runModelSummary(fullPrompt, model, timeoutMs);
}

// ============================================================================
// Chunked incremental summarization
// ============================================================================

// Per-chunk serialized-content budget (in characters). Leaves room in the
// model's context window for the prompt template, the carried-forward
// <previous-summary>, and the generated output. Intentionally conservative
// — code-heavy content tokenizes denser than the 4-chars/token heuristic.
const CHUNK_BUDGET_CHARS_BY_MODEL: Record<string, number> = {
  'claude-haiku-4-5-20251001': 300_000,   // ~75k tokens content, 200k window
  'claude-sonnet-4-6': 1_200_000,         // ~300k tokens content, 1M window
  'claude-opus-4-6': 1_200_000,           // ~300k tokens content, 1M window
};
const DEFAULT_CHUNK_BUDGET_CHARS = 300_000;

function getChunkBudgetChars(model: string | undefined): number {
  if (!model) return DEFAULT_CHUNK_BUDGET_CHARS;
  return CHUNK_BUDGET_CHARS_BY_MODEL[model] ?? DEFAULT_CHUNK_BUDGET_CHARS;
}

function chunkEntriesByBudget(entries: any[], budgetChars: number): any[][] {
  const chunks: any[][] = [];
  let current: any[] = [];
  let currentChars = 0;
  for (const entry of entries) {
    const serialized = serializeEntry(entry);
    const size = serialized ? serialized.length + 2 : 0;
    if (currentChars + size > budgetChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(entry);
    currentChars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function generateChunkedSummary(
  entries: any[],
  initialPreviousSummary: string | undefined,
  model: string | undefined,
  richMode: boolean,
  timeoutMs: number,
): Promise<string> {
  const budget = getChunkBudgetChars(model);
  const chunks = chunkEntriesByBudget(entries, budget);
  if (chunks.length === 0) {
    return initialPreviousSummary ?? '';
  }

  let running: string | undefined = initialPreviousSummary;
  for (let i = 0; i < chunks.length; i++) {
    const serialized = serializeConversation(chunks[i]);
    if (!serialized.trim()) continue;
    console.log(
      `[smart-compaction] Summarizing chunk ${i + 1}/${chunks.length} ` +
      `(${serialized.length} chars, ${chunks[i].length} entries) with ${model ?? DEFAULT_SUMMARY_MODEL}`,
    );
    running = await generateSummaryFromPrompt(serialized, running, model, richMode, timeoutMs);
  }

  return running ?? '';
}

// ============================================================================
// Main smart compaction
// ============================================================================

export async function generateSmartSummary(options: CompactionOptions): Promise<CompactionResult> {
  const entries = await parseEntries(options.jsonlPath);
  if (entries.length === 0) {
    throw new Error(`Session file is empty: ${options.jsonlPath}`);
  }

  const isFork = options.mode === 'fork';
  // Forks summarize the entire conversation (no "kept" recent portion);
  // compaction keeps recent entries verbatim and only summarizes older history.
  const keepRecentTokens = options.keepRecentTokens ?? (isFork ? Number.MAX_SAFE_INTEGER : 20000);
  const reserveTokens = options.reserveTokens ?? 16384;
  const model = options.model || DEFAULT_SUMMARY_MODEL;
  const richMode = options.richMode ?? false;
  const tokensBefore = estimateContextTokens(entries);

  // Detect previous compact boundary for incremental summarization
  const prevBoundary = findPreviousCompactBoundary(entries);
  let boundaryStart = 0;
  let previousSummary: string | undefined;
  if (prevBoundary) {
    boundaryStart = prevBoundary.index;
    previousSummary = prevBoundary.summary;
  }

  const boundaryEnd = entries.length;
  const cutPoint = findCutPoint(entries, boundaryStart, boundaryEnd, keepRecentTokens);

  // Determine which entries to summarize
  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

  const messagesToSummarize: any[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    messagesToSummarize.push(entries[i]);
  }

  const turnPrefixMessages: any[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      turnPrefixMessages.push(entries[i]);
    }
  }

  // Extract file ops from all relevant entries (summary + prefix + kept boundary)
  const fileOps = extractFileOpsFromEntries(messagesToSummarize);
  if (cutPoint.isSplitTurn) {
    const prefixOps = extractFileOpsFromEntries(turnPrefixMessages);
    prefixOps.read.forEach(f => fileOps.read.add(f));
    prefixOps.written.forEach(f => fileOps.written.add(f));
    prefixOps.edited.forEach(f => fileOps.edited.add(f));
  }
  // Also include file ops from entries AFTER the cut point up to the end
  // so the summary captures files touched in the "kept" recent work too
  const recentOps = extractFileOpsFromEntries(entries.slice(cutPoint.firstKeptEntryIndex));
  recentOps.read.forEach(f => fileOps.read.add(f));
  recentOps.written.forEach(f => fileOps.written.add(f));
  recentOps.edited.forEach(f => fileOps.edited.add(f));

  // Generate summaries
  const llmTimeoutMs = isFork ? FORK_SUMMARY_TIMEOUT_MS : undefined;
  let summary: string;
  let serializedHistory = serializeConversation(messagesToSummarize);
  let hasHistory = serializedHistory.trim().length > 0;

  // For forks, always produce a real summary. If the selected history slice is
  // empty (e.g. only metadata entries before the first valid cut point), fall
  // back to serializing the entire conversation.
  if (isFork && !hasHistory && !cutPoint.isSplitTurn) {
    const allMessages = entries.slice(boundaryStart, cutPoint.firstKeptEntryIndex);
    if (allMessages.length > 0) {
      serializedHistory = serializeConversation(allMessages);
      hasHistory = serializedHistory.trim().length > 0;
    }
  }

  const hasPrefix = cutPoint.isSplitTurn && turnPrefixMessages.length > 0;

  if (!hasHistory && !hasPrefix) {
    // Nothing to summarize — return previous summary or a minimal stub.
    // For forks, summarize the entire conversation via chunked incremental
    // passes (carrying <previous-summary> forward) so arbitrarily large
    // JSONL files fit the selected model's context window.
    if (isFork) {
      const forkTimeoutMs = llmTimeoutMs ?? FORK_SUMMARY_TIMEOUT_MS;
      // Summarize from the previous compact boundary (if any) forward — the
      // previousSummary already covers everything before boundaryStart.
      const forkEntries = boundaryStart > 0 ? entries.slice(boundaryStart) : entries;
      const anyContent = forkEntries.some((e) => serializeEntry(e));
      if (anyContent) {
        try {
          summary = await generateChunkedSummary(forkEntries, previousSummary, model, richMode, forkTimeoutMs);
        } catch (error) {
          throw new Error(`Smart summary generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!summary.trim()) {
          throw new Error('Smart summary generation failed: chunked summarization produced empty output');
        }
      } else {
        summary = previousSummary || '## Goal\nContinue the current task.\n\n## Constraints & Preferences\n- (none)\n\n## Progress\n### Done\n- (none)\n\n### In Progress\n- [ ] Awaiting next instruction\n\n### Blocked\n- (none)\n\n## Key Decisions\n- (none)\n\n## Next Steps\n1. Await user instruction\n\n## Critical Context\n- (none)';
      }
    } else {
      const minimalStub = richMode
        ? '## Primary Request and Intent\nContinue the current task.\n\n## Key Technical Concepts\n- (none)\n\n## Files and Code Sections\n- (none)\n\n## Errors and fixes\n- (none)\n\n## Problem Solving\nNo issues encountered.\n\n## All user messages\n- (none)\n\n## Pending Tasks\n- (none)\n\n## Current Work\nAwaiting next instruction.\n\n## Optional Next Step\nAwait user instruction.'
        : '## Goal\nContinue the current task.\n\n## Constraints & Preferences\n- (none)\n\n## Progress\n### Done\n- (none)\n\n### In Progress\n- [ ] Awaiting next instruction\n\n### Blocked\n- (none)\n\n## Key Decisions\n- (none)\n\n## Next Steps\n1. Await user instruction\n\n## Critical Context\n- (none)';
      summary = previousSummary || minimalStub;
    }
  } else {
    try {
      if (hasPrefix) {
        const [historyResult, turnPrefixResult] = await Promise.all([
          hasHistory
            ? generateSummaryFromPrompt(serializedHistory, previousSummary, model, richMode, llmTimeoutMs)
            : Promise.resolve('No prior history.'),
          generateTurnPrefixSummary(serializeConversation(turnPrefixMessages), model, llmTimeoutMs),
        ]);
        summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
      } else {
        summary = await generateSummaryFromPrompt(
          serializedHistory,
          previousSummary,
          model,
          richMode,
          llmTimeoutMs,
        );
      }
    } catch (error) {
      throw new Error(`Smart summary generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Append file operations
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  return {
    summary,
    tokensBefore,
    firstKeptEntryIndex: cutPoint.firstKeptEntryIndex,
    summaryModel: model,
    readFiles,
    modifiedFiles,
  };
}
