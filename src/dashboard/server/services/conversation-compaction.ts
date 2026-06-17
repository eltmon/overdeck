import { Effect } from 'effect';
import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { findLastCompactBoundary } from './conversation-service.js';
import { generateSmartSummary } from '../../../lib/conversations/smart-compaction.js';
import { generateFallbackSummary } from '../../../lib/conversations/summary-fork.js';
import { loadConfigSync } from '../../../lib/config-yaml.js';
import { getAgentRuntimeBaseCommand, getProviderExportsForModel } from '../../../lib/agents.js';
import { getEventStore } from '../event-store.js';
import { isBackgroundFeatureEnabled } from '../../../lib/background-ai/features.js';

const activeCompactions = new Set<string>();
export function isCompacting(sessionFile: string): boolean {
  return activeCompactions.has(sessionFile);
}

export interface NativeCompactionResult {
  summary: string;
  tokensBefore: number;
  boundaryUuid: string;
  model: string;
  forkedSessionId: string;
  forkedSessionFile: string;
}

export interface MaybeCompactBeforeRespawnOptions {
  sessionFile: string | null | undefined;
  cwd: string;
  shouldCompact: boolean;
}

export function getConversationCompactionSettings() {
  const { config } = loadConfigSync();
  return {
    model: config.conversations.compactionModel,
    manualCompactMode: config.conversations.manualCompactMode,
    richCompaction: config.conversations.richCompaction,
  };
}

export function shouldInterceptManualCompact(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed !== '/compact') return false;
  return getConversationCompactionSettings().manualCompactMode === 'panopticon-native';
}

export async function estimateContextTokens(sessionFile: string | null | undefined): Promise<number> {
  if (!sessionFile || !existsSync(sessionFile)) return 0;
  try {
    const content = await readFile(sessionFile, 'utf-8');
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        const usage = entry?.message?.usage ?? entry?.usage;
        if (usage && typeof usage.input_tokens === 'number') {
          const total = (usage.input_tokens ?? 0)
            + (usage.cache_creation_input_tokens ?? 0)
            + (usage.cache_read_input_tokens ?? 0);
          if (total > 0) return total;
        }
      } catch {
        // Skip malformed line
      }
    }
  } catch (err) {
    console.warn(`[conversation-compaction] estimateContextTokens failed for ${sessionFile}:`, err);
  }
  return 0;
}

function buildContinuationSummary(summary: string, model: string): string {
  return [
    'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
    '',
    summary,
    '',
    `Panopticon native compaction model: ${model}`,
    '',
    'Continue from this summary without redoing already-completed work.',
  ].join('\n');
}

export async function compactConversationNative(sessionFile: string, conversationName?: string): Promise<NativeCompactionResult> {
  if (!existsSync(sessionFile)) {
    throw new Error(`Session file not found: ${sessionFile}`);
  }
  activeCompactions.add(sessionFile);
  if (conversationName) {
    getEventStore().emitOnly({ type: 'conversation.compacting_changed', timestamp: new Date().toISOString(), payload: { conversationName, compacting: true } });
  }
  try {
    return await doCompact(sessionFile);
  } finally {
    activeCompactions.delete(sessionFile);
    if (conversationName) {
      getEventStore().emitOnly({ type: 'conversation.compacting_changed', timestamp: new Date().toISOString(), payload: { conversationName, compacting: false } });
    }
  }
}

async function doCompact(sessionFile: string): Promise<NativeCompactionResult> {

  const settings = getConversationCompactionSettings();
  const tokensBefore = await estimateContextTokens(sessionFile);

  let summary: string;
  let summaryModel: string | null;
  try {
    const result = await Effect.runPromise(generateSmartSummary({
      jsonlPath: sessionFile,
      model: settings.model,
      richMode: settings.richCompaction,
      mode: 'fork',
    }));
    summary = result.summary;
    summaryModel = result.summaryModel;
  } catch (error) {
    console.warn(`[conversation-compaction] Smart summary failed, falling back to heuristic:`, error);
    summary = await Effect.runPromise(generateFallbackSummary(sessionFile));
    summaryModel = null;
  }

  const continuation = buildContinuationSummary(summary, settings.model);
  const boundaryUuid = randomUUID();
  const timestamp = new Date().toISOString();
  const boundaryOffset = await findLastCompactBoundary(sessionFile);

  const entries = [
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      isMeta: false,
      timestamp,
      uuid: boundaryUuid,
      level: 'info',
      compactMetadata: {
        trigger: 'panopticon-native',
        preTokens: tokensBefore,
        model: settings.model,
        previousBoundaryOffset: boundaryOffset,
      },
    }),
    JSON.stringify({
      parentUuid: boundaryUuid,
      isSidechain: false,
      type: 'user',
      message: {
        role: 'user',
        content: continuation,
      },
      isVisibleInTranscriptOnly: true,
      isCompactSummary: true,
      uuid: randomUUID(),
      timestamp,
    }),
  ];

  const forkedSessionId = randomUUID();
  const forkedSessionFile = join(dirname(sessionFile), `${forkedSessionId}.jsonl`);
  await writeFile(forkedSessionFile, `${entries.join('\n')}\n`, 'utf-8');

  return {
    summary: continuation,
    tokensBefore,
    boundaryUuid,
    model: settings.model,
    forkedSessionId,
    forkedSessionFile,
  };
}

export async function maybeCompactBeforeRespawn(
  opts: MaybeCompactBeforeRespawnOptions,
): Promise<{ forkedSessionId: string; forkedSessionFile: string } | null> {
  if (!opts.sessionFile || !existsSync(opts.sessionFile)) return null;
  if (!opts.shouldCompact) {
    console.log('[conversation-compaction] Skipping compact (shouldCompact=false)');
    return null;
  }
  // Background AI gate: low-cost mode (or the summaryFork toggle) skips
  // automatic LLM compaction before respawn.
  if (!isBackgroundFeatureEnabled('summaryFork')) return null;

  const tokens = await estimateContextTokens(opts.sessionFile);
  console.log(`[conversation-compaction] Compacting before respawn (shouldCompact=true, tokens=${tokens})`);
  const result = await compactConversationNative(opts.sessionFile);
  return { forkedSessionId: result.forkedSessionId, forkedSessionFile: result.forkedSessionFile };
}

export async function buildCompactionRuntimeInfo(model: string): Promise<{ command: string; exports: string }> {
  return {
    command: await getAgentRuntimeBaseCommand(model),
    exports: await getProviderExportsForModel(model),
  };
}
