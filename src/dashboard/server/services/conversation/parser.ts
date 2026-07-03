import { open, readFile, stat } from 'node:fs/promises';
import type { ChatMessage, CompactBoundary, ProposedPlan, WorkLogEntry } from '@overdeck/contracts';
import { calculateCostSync, getPricingSync } from '../../../../lib/cost.js';
import { summarizeToolInputForWorkLog } from '../format-tool-input.js';
import { findLastCompactBoundary } from './compact-boundary.js';
import { renderableUserText } from './message-filters.js';
import { providerFromModel } from './provider.js';
import {
  MAX_FALLBACK_BYTES,
  MAX_READ_BYTES,
  type ContentBlock,
  type JsonlEntry,
  type ParseResult,
  type ParseState,
} from './types.js';

// ─── JSONL parsing ────────────────────────────────────────────────────────────

/**
 * Parse JSONL session file from a byte offset.
 *
 * Returns parsed messages, work log entries, new byte offset, and streaming status.
 * Safe to call repeatedly — incremental reads avoid re-parsing.
 */
export async function parseConversationMessages(
  sessionFile: string,
  fromByteOffset = 0,
  priorState?: ParseState,
): Promise<ParseResult> {
  // Read only new content from the byte offset — avoids re-reading the entire JSONL every tick
  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    fileStats = await stat(sessionFile);
  } catch {
    // The transcript file does not exist yet — a freshly-spawned conversation
    // whose runtime has not written its first JSONL line. Treat this as an empty
    // transcript (0 messages) instead of throwing, so a live subscriber can
    // attach the instant the conversation row exists and self-populate once the
    // file appears (watchConversation polls until it does). Mirrors the empty
    // result the truncation branch below returns.
    return {
      messages: [],
      workLog: [],
      byteOffset: 0,
      streaming: false,
      totalCost: 0,
      totalTokens: 0,
      latestAssistantUsage: null,
      contextBoundaryOffset: 0,
      contextActiveBytes: 0,
      pendingToolUse: priorState?.pendingToolUse ?? new Map(),
      unresolvedResults: priorState?.unresolvedResults ?? new Map(),
      lastSequence: priorState?.lastSequence ?? 0,
      mtimeMs: 0,
      permissionMode: priorState?.permissionMode,
      fileEditsByAssistantId: new Map(),
    };
  }
  const fileSize = fileStats.size;

  // File was truncated or rotated since last read — signal reset to caller
  if (fromByteOffset > fileSize) {
    return {
      messages: [],
      workLog: [],
      byteOffset: 0,
      streaming: false,
      totalCost: 0,
      totalTokens: 0,
      latestAssistantUsage: null,
      contextBoundaryOffset: 0,
      contextActiveBytes: fileStats.size,
      pendingToolUse: priorState?.pendingToolUse ?? new Map(),
      unresolvedResults: priorState?.unresolvedResults ?? new Map(),
      lastSequence: priorState?.lastSequence ?? 0,
      mtimeMs: fileStats.mtimeMs,
      permissionMode: priorState?.permissionMode,
      fileEditsByAssistantId: new Map(),
    };
  }

  if (fromByteOffset === 0 && !priorState && fileSize > MAX_READ_BYTES) {
    return parseEntireConversation(sessionFile);
  }

  const toRead = Math.max(0, Math.min(fileSize - fromByteOffset, MAX_READ_BYTES));
  const isIncremental = fromByteOffset > 0;

  let newText = '';
  let newByteOffset = fromByteOffset;

  if (toRead > 0) {
    const fh = await open(sessionFile, 'r');
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, fromByteOffset);

      if (bytesRead > 0) {
        const lastNewline = buf.lastIndexOf('\n', bytesRead - 1);

        if (lastNewline !== -1) {
          // At least one complete line — advance only past complete lines
          newText = buf.toString('utf-8', 0, lastNewline + 1);
          newByteOffset = fromByteOffset + lastNewline + 1;
        } else if (!isIncremental && fromByteOffset + bytesRead >= fileSize) {
          // Full parse at EOF with no trailing newline — include trailing bytes
          newText = buf.toString('utf-8', 0, bytesRead);
          newByteOffset = fromByteOffset + bytesRead;
        } else if (fromByteOffset + bytesRead >= fileSize) {
          // Incremental parse at EOF with no newline — don't advance, wait for completion
          newByteOffset = fromByteOffset;
        } else {
          // No newline in a full chunk and more file remains (line exceeds MAX_READ_BYTES).
          // Read more to find a newline boundary, but cap to avoid OOM on pathological files.
          const remaining = Math.min(fileSize - fromByteOffset, MAX_FALLBACK_BYTES);
          const fullBuf = Buffer.alloc(remaining);
          const { bytesRead: fullBytesRead } = await fh.read(fullBuf, 0, remaining, fromByteOffset);
          const fullLastNewline = fullBuf.lastIndexOf('\n', fullBytesRead - 1);
          if (fullLastNewline !== -1) {
            newText = fullBuf.toString('utf-8', 0, fullLastNewline + 1);
            newByteOffset = fromByteOffset + fullLastNewline + 1;
          } else if (!isIncremental) {
            newText = fullBuf.toString('utf-8', 0, fullBytesRead);
            newByteOffset = fromByteOffset + fullBytesRead;
          } else {
            newByteOffset = fromByteOffset;
          }
        }
      }
    } finally {
      await fh.close();
    }
  }

  const lines = newText.split('\n');

  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  let latestAssistantUsage = priorState?.latestAssistantUsage ?? null;
  let maxObservedInputTokens = latestAssistantUsage?.maxObservedInputTokens ?? 0;
  let contextBoundaryOffset = priorState?.contextBoundaryOffset ?? 0;

  // Pending assistant message being assembled from content blocks
  let pendingAssistant: ChatMessage | null = null;
  // Track last user message timestamp for duration calculation
  let lastUserTimestamp: string | null = null;
  // Map tool_use id → WorkLogEntry (waiting for tool_result)
  const pendingToolUse = priorState?.pendingToolUse ?? new Map<string, WorkLogEntry>();
  // Map tool_use id → pre-arrived tool_result (waiting for tool_use)
  const unresolvedResults = priorState?.unresolvedResults ?? new Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>();
  // Monotonic sequence counter per JSONL line
  let sequence = priorState?.lastSequence ?? 0;
  // Plan mode: track ExitPlanMode tool_use id → ProposedPlan
  let proposedPlan: ProposedPlan | undefined = priorState?.proposedPlan;
  // Set of ExitPlanMode tool_use IDs so we can match tool_results to plans
  const planToolUseIds = priorState?.planToolUseIds ?? new Set<string>();
  // Compact boundary markers
  const compactBoundaries: CompactBoundary[] = [];
  // Track permission mode across incremental parses
  let permissionMode: string | undefined = priorState?.permissionMode;
  // Track file-modifying tool_use calls per assistant message for diff computation
  const fileEditsByAssistantId = new Map<string, Array<{ tool: string; filePath: string }>>();
  const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
  // Tool_use entries arrive with their own UUID, separate from the text entry that follows.
  // We track these UUIDs so we can re-key edits when the text entry merges them into one message.
  const orphanToolUseIds = priorState?.orphanToolUseIds
    ? new Set(priorState.orphanToolUseIds)
    : new Set<string>();
  // Request/message IDs whose usage has already been counted, so a response spread across
  // multiple JSONL lines (or across incremental read boundaries) is counted exactly once.
  const countedUsageIds = priorState?.countedUsageIds ?? new Set<string>();
  // Carry the prior assistant ID for file-edit association only. Do not
  // materialize it as a ChatMessage: a later flush before user/tool-result lines
  // would emit an invalid ID-only assistant delta.
  const pendingAssistantIdForEdits = priorState?.pendingAssistantId;

  let lineByteOffset = fromByteOffset;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const currentLineByteOffset = lineByteOffset;
    lineByteOffset += Buffer.byteLength(line, 'utf-8') + (i < lines.length - 1 ? 1 : 0);
    if (!line.trim()) continue;

    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line.replace(/\r$/, '')) as JsonlEntry;
    } catch {
      continue;
    }
    const lineSequence = sequence++;

    if (entry.type === 'user' && entry.message) {
      const msg = entry.message;
      const rawContent = msg.content;

      // Flush any pending assistant message
      if (pendingAssistant) {
        messages.push(pendingAssistant);
        pendingAssistant = null;
      }

      // Content can be a string (plain text) or array of content blocks
      if (typeof rawContent === 'string' && rawContent.trim()) {
        const text = renderableUserText(rawContent);
        if (text !== null) {
          const ts = entry.timestamp ?? new Date().toISOString();
          lastUserTimestamp = ts;
          messages.push({
            id: entry.uuid ?? `user-${messages.length}`,
            role: 'user',
            text,
            createdAt: ts,
            sequence: lineSequence,
          });
        }
      } else if (Array.isArray(rawContent)) {
        // Collect tool_result blocks first (they complete pending WorkLogEntries)
        for (const block of rawContent as ContentBlock[]) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            let resultText: string | undefined;
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = (block.content as Array<{ type?: string; text?: string }>)
                .filter(b => b.type === 'text' && b.text)
                .map(b => b.text)
                .join('\n');
            }
            if (planToolUseIds.has(block.tool_use_id)) {
              if (proposedPlan && proposedPlan.id === block.tool_use_id) {
                const text = resultText ?? '';
                if (text.includes('approved')) {
                  proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
                } else if (text.includes("doesn't want to proceed") || text.includes('does not want')) {
                  proposedPlan = { ...proposedPlan, status: 'rejected', resolvedAt: entry.timestamp ?? new Date().toISOString() };
                }
              }
            } else {
              const pending = pendingToolUse.get(block.tool_use_id);
              if (pending) {
                pendingToolUse.delete(block.tool_use_id);
                workLog.push({
                  ...pending,
                  detail: block.is_error
                    ? `Error: ${resultText ?? JSON.stringify(block.content)}`
                    : pending.detail,
                  result: resultText,
                  tone: block.is_error ? 'error' : pending.tone,
                });
              } else {
                unresolvedResults.set(block.tool_use_id, {
                  resultText,
                  isError: block.is_error ?? false,
                  rawContent: block.content,
                });
              }
            }
          }
        }

        // Collect all text blocks, joining with newlines to preserve multiline input
        const textBlocks: string[] = [];
        for (const block of rawContent as ContentBlock[]) {
          if (block.type === 'text' && block.text) {
            const text = renderableUserText(block.text);
            if (text !== null) textBlocks.push(text);
          }
        }
        if (textBlocks.length > 0) {
          const ts = entry.timestamp ?? new Date().toISOString();
          lastUserTimestamp = ts;
          messages.push({
            id: entry.uuid ?? `user-${messages.length}`,
            role: 'user',
            text: textBlocks.join('\n'),
            createdAt: ts,
            sequence: lineSequence,
          });
        }
      }
    } else if (entry.type === 'assistant' && entry.message) {
      const msg = entry.message;
      const content = Array.isArray(msg.content) ? msg.content : [];

      if (msg.usage) {
        const input = msg.usage.input_tokens ?? 0;
        const cacheRead = msg.usage.cache_read_input_tokens ?? 0;
        const cacheCreate = msg.usage.cache_creation_input_tokens ?? 0;
        const turnInput = input + cacheRead + cacheCreate;
        if (turnInput > maxObservedInputTokens) maxObservedInputTokens = turnInput;
        latestAssistantUsage = {
          lastInputTokens: input,
          lastCacheReadTokens: cacheRead,
          lastCacheCreationTokens: cacheCreate,
          maxObservedInputTokens,
          lastModel: msg.model ?? null,
          lastTimestamp: entry.timestamp ?? null,
        };
      }

      // Accumulate cost and token throughput from usage data.
      // Claude Code repeats the same `usage` on every JSONL line of one API response
      // (the text line, each tool_use line, …); dedup on requestId/message.id so each
      // response is counted once, otherwise multi-block turns inflate cost ~2-3×.
      const usageId = entry.requestId ?? msg.id;
      if (msg.usage && (usageId === undefined || !countedUsageIds.has(usageId))) {
        if (usageId !== undefined) countedUsageIds.add(usageId);
        totalTokens +=
          (msg.usage.input_tokens ?? 0) +
          (msg.usage.output_tokens ?? 0) +
          (msg.usage.cache_read_input_tokens ?? 0) +
          (msg.usage.cache_creation_input_tokens ?? 0);
        if (msg.model) {
          const pricing = getPricingSync(providerFromModel(msg.model), msg.model);
          if (pricing) {
            totalCost += calculateCostSync({
              inputTokens: msg.usage.input_tokens ?? 0,
              outputTokens: msg.usage.output_tokens ?? 0,
              cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
            }, pricing);
          }
        }
      }

      let assistantText = '';
      let blockIndex = 0;
      for (const block of content as ContentBlock[]) {
        if (block.type === 'text' && block.text) {
          assistantText += block.text;
        } else if (block.type === 'thinking' && block.thinking) {
          workLog.push({
            id: `${entry.uuid ?? msg.id ?? `asst-${messages.length}`}-thinking-${blockIndex}`,
            createdAt: entry.timestamp ?? new Date().toISOString(),
            label: 'thinking',
            detail: block.thinking,
            tone: 'thinking',
            sequence: lineSequence,
          });
        } else if (block.type === 'tool_use' && block.id) {
          if (block.name === 'ExitPlanMode') {
            const input = block.input as Record<string, unknown> | undefined;
            const planText = typeof input?.plan === 'string' ? input.plan : '';
            const planFilePath = typeof input?.planFilePath === 'string' ? input.planFilePath : undefined;
            proposedPlan = {
              id: block.id,
              plan: planText,
              planFilePath,
              status: 'pending',
              createdAt: entry.timestamp ?? new Date().toISOString(),
            };
            planToolUseIds.add(block.id);
            const unresolved = unresolvedResults.get(block.id);
            if (unresolved) {
              unresolvedResults.delete(block.id);
              const resultText = unresolved.resultText ?? '';
              if (resultText.includes('approved')) {
                proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
              } else if (resultText.includes("doesn't want to proceed") || resultText.includes('does not want')) {
                proposedPlan = { ...proposedPlan, status: 'rejected', resolvedAt: entry.timestamp ?? new Date().toISOString() };
              }
            }
          } else if (block.name === 'EnterPlanMode') {
            // Skip — don't add to workLog
          } else {
            // Track file-modifying tools for diff computation
            if (block.name && FILE_EDIT_TOOLS.has(block.name) && block.input) {
              const input = block.input as Record<string, unknown>;
              const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
              if (filePath) {
                const asstId = pendingAssistant?.id ?? pendingAssistantIdForEdits ?? entry.uuid ?? msg.id ?? `asst-${messages.length}`;
                // If no pendingAssistant, this tool_use UUID is orphaned — the text entry
                // will merge it into the final message with a different UUID.
                if (!pendingAssistant) {
                  orphanToolUseIds.add(asstId);
                }
                let edits = fileEditsByAssistantId.get(asstId);
                if (!edits) {
                  edits = [];
                  fileEditsByAssistantId.set(asstId, edits);
                }
                if (!edits.some(e => e.filePath === filePath)) {
                  edits.push({ tool: block.name!, filePath });
                }
              }
            }
            // WorkLogEntry for the tool call. We pass the raw input dict
            // through as `toolInput` so the frontend can render per-tool
            // (Bash command as a fenced shell block, file tools as chips,
            // etc.) and pre-compute a short one-line summary for the
            // collapsed row via summarizeToolInputForWorkLog. See PAN-1459.
            const inputDict =
              block.input && typeof block.input === 'object' && !Array.isArray(block.input)
                ? (block.input as Record<string, unknown>)
                : undefined;
            const toolEntry: WorkLogEntry = {
              id: block.id,
              createdAt: entry.timestamp ?? new Date().toISOString(),
              label: block.name ?? 'tool',
              tone: 'tool',
              toolTitle: block.name,
              detail: summarizeToolInputForWorkLog(block.name, inputDict),
              toolInput: inputDict,
              sequence: lineSequence,
            };
            const unresolved = unresolvedResults.get(block.id);
            if (unresolved) {
              unresolvedResults.delete(block.id);
              workLog.push({
                ...toolEntry,
                detail: unresolved.isError
                  ? `Error: ${unresolved.resultText ?? JSON.stringify(unresolved.rawContent)}`
                  : toolEntry.detail,
                result: unresolved.resultText,
                tone: unresolved.isError ? 'error' : toolEntry.tone,
              });
            } else {
              pendingToolUse.set(block.id, toolEntry);
            }
          }
        }
        blockIndex++;
      }

      if (assistantText) {
        const newId = entry.uuid ?? msg.id ?? `asst-${messages.length}`;
        // Flush previous pending assistant
        if (pendingAssistant) {
          messages.push(pendingAssistant);
          // Re-key file edits from old pendingAssistant UUID
          const oldId = pendingAssistant.id;
          if (oldId !== newId) {
            const edits = fileEditsByAssistantId.get(oldId);
            if (edits) {
              fileEditsByAssistantId.delete(oldId);
              fileEditsByAssistantId.set(newId, edits);
            }
          }
        }
        // Re-key orphaned tool_use UUIDs into the merged message's UUID
        for (const orphanId of orphanToolUseIds) {
          if (orphanId !== newId) {
            const edits = fileEditsByAssistantId.get(orphanId);
            if (edits) {
              fileEditsByAssistantId.delete(orphanId);
              const existing = fileEditsByAssistantId.get(newId);
              if (existing) {
                for (const e of edits) {
                  if (!existing.some(x => x.filePath === e.filePath)) existing.push(e);
                }
              } else {
                fileEditsByAssistantId.set(newId, edits);
              }
            }
          }
        }
        orphanToolUseIds.clear();
        pendingAssistant = {
          id: entry.uuid ?? msg.id ?? `asst-${messages.length}`,
          role: 'assistant',
          text: assistantText,
          // createdAt = when the assistant response was generated (preserves
          // chronological order for interleaving with work log entries).
          // Duration start is computed separately in session-logic.ts.
          createdAt: entry.timestamp ?? new Date().toISOString(),
          // Any terminal stop reason (end_turn, max_tokens, stop_sequence) marks the response as done.
          // tool_use means more exchanges are coming, so leave completedAt unset.
          // Use || fallback in case entry.timestamp is null (not just undefined).
          completedAt: (msg.stop_reason && msg.stop_reason !== 'tool_use')
            ? (entry.timestamp || new Date().toISOString())
            : undefined,
          streaming: !msg.stop_reason,
          sequence: lineSequence,
        };
      }
    } else if (entry.type === 'system' && (entry as Record<string, unknown>).subtype === 'compact_boundary') {
      contextBoundaryOffset = currentLineByteOffset;
      latestAssistantUsage = null;
      maxObservedInputTokens = 0;
      const meta = (entry as Record<string, unknown>).compactMetadata as Record<string, unknown> | undefined;
      compactBoundaries.push({
        id: (entry as Record<string, unknown>).uuid as string ?? `compact-${lineSequence}`,
        timestamp: entry.timestamp ?? new Date().toISOString(),
        trigger: typeof meta?.trigger === 'string' ? meta.trigger : undefined,
        preTokens: typeof meta?.preTokens === 'number' ? meta.preTokens : undefined,
        model: typeof meta?.model === 'string' ? meta.model : undefined,
      });
    } else if (entry.type === 'permission-mode') {
      // Track permission mode transitions. Exiting 'plan' mode is an approval
      // signal when no explicit plan_mode_exit attachment was emitted.
      const newMode = (entry as Record<string, unknown>).permissionMode as string | undefined;
      if (newMode && permissionMode === 'plan' && newMode !== 'plan') {
        if (proposedPlan && proposedPlan.status === 'pending') {
          proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
        }
      }
      permissionMode = newMode;
    } else if (entry.type === 'attachment') {
      // Claude Code 2.1.121+ attachment-based plan mode protocol.
      // The agent writes the plan to ~/.claude/plans/<slug>.md and the runtime
      // emits a `plan_file_reference` attachment with the full content. Approval
      // is signalled by a subsequent `plan_mode_exit` attachment.
      const attachment = (entry as Record<string, unknown>).attachment as Record<string, unknown> | undefined;
      if (attachment?.type === 'plan_file_reference') {
        const planContent = typeof attachment.planContent === 'string' ? attachment.planContent : '';
        if (planContent) {
          const planFilePath = typeof attachment.planFilePath === 'string' ? attachment.planFilePath : undefined;
          const id = ((entry as Record<string, unknown>).uuid as string | undefined) ?? `plan-${lineSequence}`;
          // If permission mode has already exited 'plan', auto-approve since the
          // user already approved before this attachment arrived (or no exit was emitted).
          const alreadyApproved = permissionMode !== 'plan' && permissionMode !== undefined;
          proposedPlan = {
            id,
            plan: planContent,
            planFilePath,
            status: alreadyApproved ? 'approved' : 'pending',
            createdAt: entry.timestamp ?? new Date().toISOString(),
            ...(alreadyApproved ? { resolvedAt: entry.timestamp ?? new Date().toISOString() } : {}),
          };
        }
      } else if (attachment?.type === 'plan_mode_exit') {
        if (proposedPlan && proposedPlan.status === 'pending') {
          proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
        }
      } else if (attachment?.type === 'plan_mode') {
        // Claude Code plan_mode attachment: agent called EnterPlanMode, plan written
        // to an external file. Always start as 'pending' — the permission-mode
        // transition handler (plan → other) will mark it approved when that fires.
        const planFilePath = typeof attachment.planFilePath === 'string' ? attachment.planFilePath : undefined;
        if (planFilePath) {
          try {
            const planContent = (await readFile(planFilePath, 'utf-8')).trim();
            if (planContent) {
              const id = ((entry as Record<string, unknown>).uuid as string | undefined) ?? `plan-${lineSequence}`;
              proposedPlan = {
                id,
                plan: planContent,
                planFilePath,
                status: 'pending',
                createdAt: entry.timestamp ?? new Date().toISOString(),
              };
            }
          } catch {
            // Plan file not yet written — will show once the agent finishes planning
          }
        }
      } else if (attachment?.type === 'queued_command' && attachment?.commandMode === 'prompt') {
        // User message sent as an interrupt while Claude was running — stored as
        // queued_command instead of a regular user entry. Render it in the timeline.
        const prompt = attachment.prompt;
        let text = '';
        if (typeof prompt === 'string') {
          text = prompt;
        } else if (Array.isArray(prompt)) {
          text = (prompt as Array<{ type?: string; text?: string }>)
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text)
            .join('\n');
        }
        const renderableText = text ? renderableUserText(text) : null;
        if (renderableText !== null) {
          if (pendingAssistant) {
            messages.push(pendingAssistant);
            pendingAssistant = null;
          }
          const ts = entry.timestamp ?? new Date().toISOString();
          lastUserTimestamp = ts;
          messages.push({
            id: ((entry as Record<string, unknown>).uuid as string | undefined) ?? `queued-${lineSequence}`,
            role: 'user',
            text: renderableText,
            createdAt: ts,
            sequence: lineSequence,
          });
        }
      } else if (attachment?.type === 'command_permissions') {
        // Session start / resume record — contains the allowedTools list.
        // Render as a system message so the user can see what permissions are in effect.
        const rawTools = Array.isArray(attachment.allowedTools)
          ? (attachment.allowedTools as unknown[]).filter((t) => typeof t === 'string') as string[]
          : [];
        const tools = rawTools.length > 0 ? rawTools.join(', ') : 'None';
        const ts = entry.timestamp ?? new Date().toISOString();
        messages.push({
          id: ((entry as Record<string, unknown>).uuid as string | undefined) ?? `perm-${lineSequence}`,
          role: 'system',
          text: tools,
          createdAt: ts,
          sequence: lineSequence,
        });
      }
    }
  }

  // Push any remaining pending assistant
  if (pendingAssistant) {
    messages.push(pendingAssistant);
  }

  // Flush any tool_use entries that never got a result (still running).
  // Only flush on non-incremental parses; incremental callers pass priorState
  // and will receive pendingToolUse back for the next call.
  if (!priorState) {
    for (const [id, entry] of pendingToolUse) {
      if (!planToolUseIds.has(id)) {
        workLog.push(entry);
      }
    }
    pendingToolUse.clear();
  }

  // Sort by (createdAt, sequence) so the conversation view matches terminal order.
  // Use direct string comparison (not localeCompare) — ISO 8601 timestamps sort lexicographically.
  // For incremental parses (the hot path), messages arrive in file order and are already
  // sorted — skip the O(n log n) sort entirely.
  if (!isIncremental) {
    messages.sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
    workLog.sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
  }

  // Streaming detection: agent is active if the last assistant message is incomplete,
  // or if there are pending/unresolved tools (mid-turn), or a user message arrived
  // (agent is about to respond), and the file was modified recently.
  let streaming = false;
  const lastMsg = messages[messages.length - 1];
  const assistantIncomplete = lastMsg?.role === 'assistant' && !lastMsg.completedAt;
  const fileRecent = Date.now() - fileStats.mtimeMs < 5000;
  if (assistantIncomplete && fileRecent) {
    streaming = true;
  } else if (lastMsg?.role === 'user' && fileRecent) {
    streaming = true;
  }

  return {
    messages,
    workLog,
    byteOffset: newByteOffset,
    streaming,
    totalCost,
    totalTokens,
    latestAssistantUsage,
    contextBoundaryOffset,
    contextActiveBytes: Math.max(0, fileStats.size - contextBoundaryOffset),
    pendingToolUse,
    unresolvedResults,
    lastSequence: sequence,
    mtimeMs: fileStats.mtimeMs,
    proposedPlan,
    planToolUseIds,
    compactBoundaries,
    permissionMode,
    fileEditsByAssistantId,
    pendingAssistantId: pendingAssistant?.id ?? pendingAssistantIdForEdits,
    orphanToolUseIds: orphanToolUseIds.size > 0 ? orphanToolUseIds : undefined,
    countedUsageIds,
  };
}

/**
 * Parse an ENTIRE JSONL transcript, regardless of size.
 *
 * `parseConversationMessages(file, offset, state)` reads at most MAX_READ_BYTES
 * (10 MB) in a single incremental call. This helper loops the same parser in
 * bounded chunks for callers that need a complete transcript snapshot.
 *
 * ParseState is threaded from the first chunk so tool_use/tool_result pairs can
 * span chunk boundaries. Per-chunk totals are safe to sum because
 * `countedUsageIds` is threaded, so a response split across a read boundary is
 * counted once.
 */
export async function parseEntireConversation(
  sessionFile: string,
  options: { flushPendingToolUse?: boolean } = {},
): Promise<ParseResult> {
  let offset = 0;
  let priorState: ParseState = {
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: 0,
  };
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  const compactBoundaries: CompactBoundary[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  let last: ParseResult | null = null;

  // Bounded loop: at 10 MB/chunk this covers a 10 GB transcript. The real exit
  // is "byteOffset stopped advancing" (EOF or an incomplete trailing line).
  for (let guard = 0; guard < 1024; guard++) {
    const result = await parseConversationMessages(sessionFile, offset, priorState);
    messages.push(...result.messages);
    workLog.push(...result.workLog);
    if (result.compactBoundaries?.length) compactBoundaries.push(...result.compactBoundaries);
    totalCost += result.totalCost;
    totalTokens += result.totalTokens;
    last = result;

    if (result.byteOffset <= offset) break; // no progress → EOF
    offset = result.byteOffset;
    priorState = {
      pendingToolUse: result.pendingToolUse,
      unresolvedResults: result.unresolvedResults,
      lastSequence: result.lastSequence,
      planToolUseIds: result.planToolUseIds,
      proposedPlan: result.proposedPlan,
      latestAssistantUsage: result.latestAssistantUsage,
      contextBoundaryOffset: result.contextBoundaryOffset,
      permissionMode: result.permissionMode,
      fileEditsByAssistantId: result.fileEditsByAssistantId,
      pendingAssistantId: result.pendingAssistantId,
      orphanToolUseIds: result.orphanToolUseIds,
      countedUsageIds: result.countedUsageIds,
    };
  }

  if (!last) return parseConversationMessages(sessionFile, 0);

  if (options.flushPendingToolUse ?? true) {
    for (const [id, entry] of last.pendingToolUse) {
      if (!last.planToolUseIds?.has(id)) {
        workLog.push(entry);
      }
    }
    last.pendingToolUse.clear();
  }

  // Take terminal state (byteOffset, boundary offsets, pending maps, mtime, …)
  // from the final chunk; replace the accumulating fields with the full totals.
  return { ...last, messages, workLog, compactBoundaries, totalCost, totalTokens };
}

export async function parseFromLastCompactBoundary(
  sessionFile: string,
  priorState?: ParseState,
): Promise<ParseResult> {
  const boundaryOffset = await findLastCompactBoundary(sessionFile);
  return parseConversationMessages(sessionFile, boundaryOffset, priorState);
}
