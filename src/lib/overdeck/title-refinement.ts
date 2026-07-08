/**
 * Hook-driven progressive conversation title refinement.
 *
 * Replaces the old polling-based refinement scheduler with an event-driven
 * turn-complete handler. First refinement happens as soon as a completed
 * assistant message is available; later refinements are debounced by turn count
 * and wall-clock interval.
 */
import { existsSync } from 'node:fs';

import { isBackgroundFeatureEnabled as defaultIsBackgroundFeatureEnabled } from '../background-ai/features.js';
import {
  serializeConversationTranscript,
  summarizeTranscriptTitle as defaultSummarizeTranscriptTitle,
} from '../conversations/transcript-summary.js';
import {
  canRefineTitle,
  getConversationByName,
  updateConversationTitle,
  type LegacyConversation,
} from './conversations.js';
import {
  configuredTitleModel as defaultConfiguredTitleModel,
  getCachedMessages as defaultGetCachedMessages,
} from './conversation-reads.js';

const LATER_REFINE_MIN_TURNS = 5;
const LATER_REFINE_MIN_INTERVAL_MS = 10 * 60 * 1000;

interface RefinementCadence {
  turnsSinceRefine: number;
  lastRefinedAtMs: number;
}

const cadenceByConversation = new Map<string, RefinementCadence>();
const inFlight = new Set<string>();

export interface HandleTurnCompleteDependencies {
  resolveSessionFile(conv: LegacyConversation): Promise<string | null>;
  getCachedMessages?: typeof defaultGetCachedMessages;
  configuredTitleModel?: typeof defaultConfiguredTitleModel;
  summarizeTranscriptTitle?: typeof defaultSummarizeTranscriptTitle;
  isBackgroundFeatureEnabled?: typeof defaultIsBackgroundFeatureEnabled;
}

export async function handleTurnComplete(
  conv: LegacyConversation,
  deps: HandleTurnCompleteDependencies,
): Promise<void> {
  const isEnabled = deps.isBackgroundFeatureEnabled ?? defaultIsBackgroundFeatureEnabled;
  if (!isEnabled('titleRefinement')) return;
  if (!canRefineTitle(conv)) return;

  const name = conv.name;

  let cadence = cadenceByConversation.get(name);
  if (!cadence) {
    // For an already-ai-refined conversation (e.g. after a dashboard restart),
    // seed the cadence from now so that the 10-minute debounce is not satisfied
    // immediately by Date.now() - 0.
    cadence = {
      turnsSinceRefine: 0,
      lastRefinedAtMs: conv.titleSource === 'ai-refined' ? Date.now() : 0,
    };
    cadenceByConversation.set(name, cadence);
  }
  cadence.turnsSinceRefine += 1;

  const isFirstRefinement = conv.titleSource === 'default' || conv.titleSource === 'auto' || conv.titleSource === 'ai';
  if (!isFirstRefinement) {
    const laterRefineEligible =
      cadence.turnsSinceRefine >= LATER_REFINE_MIN_TURNS &&
      Date.now() - cadence.lastRefinedAtMs >= LATER_REFINE_MIN_INTERVAL_MS;
    if (!laterRefineEligible) return;
  }

  if (inFlight.has(name)) return;
  inFlight.add(name);

  const getCachedMessages = deps.getCachedMessages ?? defaultGetCachedMessages;
  const configuredTitleModel = deps.configuredTitleModel ?? defaultConfiguredTitleModel;
  const summarizeTranscriptTitle = deps.summarizeTranscriptTitle ?? defaultSummarizeTranscriptTitle;

  try {
    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) return;

    const { messages } = await getCachedMessages(sessionFile, false);
    const firstCompleteAssistant = messages.find(
      (m) => m.role === 'assistant' && m.completedAt,
    );
    if (!firstCompleteAssistant) return;

    const transcript = serializeConversationTranscript(messages);
    if (!transcript.trim()) return;

    console.log(`[claude-invoke] purpose=conversation-title-refine | model=${configuredTitleModel()} | conversation=${name} | transcriptChars=${transcript.length}`);
    const refined = await summarizeTranscriptTitle(transcript, configuredTitleModel());
    if (!refined) {
      console.warn(`[title-refine] Model returned empty refined title for "${name}"`);
      return;
    }

    const freshConv = getConversationByName(name);
    if (!freshConv || !canRefineTitle(freshConv)) {
      console.log(`[title-refine] Conversation "${name}" no longer eligible (source=${freshConv?.titleSource ?? 'missing'}); skipping`);
      return;
    }

    updateConversationTitle(name, refined, 'ai-refined');
    console.log(`[claude-invoke] SUCCESS purpose=conversation-title-refine | conversation=${name} | title="${refined}"`);
    cadence.turnsSinceRefine = 0;
    cadence.lastRefinedAtMs = Date.now();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[title-refine] failed for "${name}":`, msg);
  } finally {
    inFlight.delete(name);
  }
}

/** Resets module-level refinement state. Exported for tests only. */
export function resetTitleRefinementState(): void {
  cadenceByConversation.clear();
  inFlight.clear();
}
