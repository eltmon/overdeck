import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { findLastCompactBoundary } from './conversation-service.js';
import { generateSummary } from '../../../lib/conversations/summary-fork.js';
import { loadConfig } from '../../../lib/config-yaml.js';
import { getAgentRuntimeBaseCommand, getProviderExportsForModel } from '../../../lib/agents.js';

const COMPACT_TOKEN_THRESHOLD = 100_000;

export interface NativeCompactionResult {
  summary: string;
  tokensBefore: number;
  boundaryUuid: string;
  model: string;
}

export interface MaybeCompactBeforeRespawnOptions {
  sessionFile: string | null | undefined;
  cwd: string;
  modelChanged: boolean;
}

export function getConversationCompactionSettings() {
  const { config } = loadConfig();
  return {
    model: config.conversations.compactionModel,
    manualCompactMode: config.conversations.manualCompactMode,
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
          return (usage.input_tokens ?? 0)
            + (usage.cache_creation_input_tokens ?? 0)
            + (usage.cache_read_input_tokens ?? 0);
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

export async function compactConversationNative(sessionFile: string): Promise<NativeCompactionResult> {
  if (!existsSync(sessionFile)) {
    throw new Error(`Session file not found: ${sessionFile}`);
  }

  const settings = getConversationCompactionSettings();
  const tokensBefore = await estimateContextTokens(sessionFile);
  const summary = await generateSummary(sessionFile);
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

  await appendFile(sessionFile, `${entries.join('\n')}\n`, 'utf-8');

  return {
    summary: continuation,
    tokensBefore,
    boundaryUuid,
    model: settings.model,
  };
}

export async function maybeCompactBeforeRespawn(opts: MaybeCompactBeforeRespawnOptions): Promise<void> {
  if (!opts.sessionFile || !existsSync(opts.sessionFile)) return;

  const tokens = await estimateContextTokens(opts.sessionFile);
  const overThreshold = tokens > COMPACT_TOKEN_THRESHOLD;
  if (!opts.modelChanged && !overThreshold) {
    console.log(`[conversation-compaction] Skipping compact (modelChanged=false, tokens=${tokens})`);
    return;
  }

  console.log(`[conversation-compaction] Compacting before respawn (modelChanged=${opts.modelChanged}, tokens=${tokens})`);
  await compactConversationNative(opts.sessionFile);
}

export function buildCompactionRuntimeInfo(model: string): { command: string; exports: string } {
  return {
    command: getAgentRuntimeBaseCommand(model),
    exports: getProviderExportsForModel(model),
  };
}
