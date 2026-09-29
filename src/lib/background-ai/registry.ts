/**
 * Background AI feature registry — pure data, no dependencies (PAN-1583).
 *
 * Kept dependency-free so `config-yaml.ts` can import the feature list and
 * defaults without creating an import cycle with the enablement gate in
 * `features.ts` (which imports `config-yaml`).
 */

/** Every background AI feature Overdeck can run automatically. */
export const BACKGROUND_AI_FEATURES = [
  'conversationTitles',
  'titleRefinement',
  'memoryExtraction',
  'memoryQueryExpansion',
  'conversationEnrichment',
  'sessionEmbeddings',
  'summaryFork',
  'ttsSummarizer',
  'jevTurnEndAssessment',
  'jevAcceptanceCriteriaReview',
  'jevMemoryRelevance',
] as const;

export type BackgroundAiFeature = (typeof BACKGROUND_AI_FEATURES)[number];

export interface BackgroundAiFeatureMeta {
  key: BackgroundAiFeature;
  /** Human-readable label for the settings UI. */
  label: string;
  /** One-line description of what the feature does. */
  description: string;
  /** Default enabled state (preserves pre-PAN-1583 behavior). */
  defaultEnabled: boolean;
}

/**
 * Feature metadata. The `defaultEnabled` values mirror the historical
 * behavior of each subsystem so introducing the registry changes nothing
 * until the user flips a toggle:
 *   - sessionEmbeddings defaults OFF  (conversations.embeddings default false)
 *   - ttsSummarizer defaults OFF      (ttsSummarizer.enabled default false)
 *   - jev* features default OFF       (optional third-party judgment calls, PAN-4369)
 *   - everything else defaults ON.
 */
export const BACKGROUND_AI_FEATURE_META: readonly BackgroundAiFeatureMeta[] = [
  {
    key: 'conversationTitles',
    label: 'Conversation titles',
    description: 'Generate a title for a new conversation from its first message.',
    defaultEnabled: true,
  },
  {
    key: 'titleRefinement',
    label: 'Title refinement',
    description: 'Refine a conversation title once the first assistant reply arrives.',
    defaultEnabled: true,
  },
  {
    key: 'memoryExtraction',
    label: 'Memory extraction',
    description: 'Extract structured observations from running agent transcripts.',
    defaultEnabled: true,
  },
  {
    key: 'memoryQueryExpansion',
    label: 'Memory query expansion',
    description: 'Expand memory search queries into related terms for better recall.',
    defaultEnabled: true,
  },
  {
    key: 'conversationEnrichment',
    label: 'Conversation enrichment',
    description: 'Summarize and tag discovered sessions for search and display.',
    defaultEnabled: true,
  },
  {
    key: 'sessionEmbeddings',
    label: 'Session embeddings',
    description: 'Build embedding vectors for semantic conversation search.',
    defaultEnabled: false,
  },
  {
    key: 'summaryFork',
    label: 'Summary fork / compaction',
    description: 'Summarize a transcript on compaction or handoff fallback.',
    defaultEnabled: true,
  },
  {
    key: 'ttsSummarizer',
    label: 'TTS activity narration',
    description: 'Summarize recent activity into spoken narration utterances.',
    defaultEnabled: false,
  },
  {
    key: 'jevTurnEndAssessment',
    label: 'Jev: turn-end classification',
    description:
      "Sends an agent's last message (trimmed to about 6,000 characters) and its role to TypeSafe to classify why the agent stopped.",
    defaultEnabled: false,
  },
  {
    key: 'jevAcceptanceCriteriaReview',
    label: 'Jev: acceptance-criteria review',
    description:
      "Sends the id and title text of each acceptance criterion of the plan's non-cancelled items to TypeSafe at plan finalize, for advisory warnings.",
    defaultEnabled: false,
  },
  {
    key: 'jevMemoryRelevance',
    label: 'Jev: memory relevance filter',
    description:
      'Sends your prompt and up to 20 memory snippets (about 600 characters each) to TypeSafe to drop irrelevant memories before injection.',
    defaultEnabled: false,
  },
] as const;

/** The default per-feature enablement map (used by config normalization). */
export function defaultBackgroundAiFeatures(): Record<BackgroundAiFeature, boolean> {
  const out = {} as Record<BackgroundAiFeature, boolean>;
  for (const meta of BACKGROUND_AI_FEATURE_META) {
    out[meta.key] = meta.defaultEnabled;
  }
  return out;
}
