/**
 * Provider model presets (PAN-4400): versioned, named bundles of explicit
 * values for Overdeck's model settings, all from one provider. Applying a
 * preset writes these values into the global config.yaml once; a preset is
 * never a live config key (the retired `models.preset` key stays retired).
 *
 * PRESET_SETTINGS is the registry of every static model-valued or
 * effort-valued config path. Every preset maps every registry path to either
 * `{ set }` or `{ keep: reason }`. Tier rows and provider nodes depend on the
 * current config, so the plan engine computes them from `tierBands`,
 * `supervisorModel` and `providerNode` instead of registry entries.
 *
 * Leaf module: runtime imports are limited to model-capabilities.js so the
 * plan and apply modules (which import settings-api) cannot form a cycle.
 */
import type { EffortLevel } from '@overdeck/contracts';
import { MODEL_DEPRECATIONS, hasModelCapability, resolveModelId } from '../model-capabilities.js';
import type { Role } from '../config-yaml/schema.js';

export type PresetId = 'anthropic' | 'anthropic-cost-saver' | 'openai';
export type PresetSettingGroup = 'workhorses' | 'roles' | 'review-lanes' | 'tiers' | 'conversation' | 'background' | 'providers';

export interface PresetSetting {
  path: readonly string[];
  label: string;
  group: PresetSettingGroup;
  kind: 'model' | 'effort' | 'provider-node' | 'enum';
}

export type PresetValue = { set: unknown } | { keep: string };

export interface PresetTierBand {
  model: string;
  effort?: EffortLevel;
}

export interface ModelPreset {
  id: PresetId;
  label: string;
  provider: 'anthropic' | 'openai';
  harness: 'claude-code' | 'codex';
  version: number;
  date: string;
  pilot: boolean;
  evidence: { status: 'eval' | 'research'; reportPath: string; summary: string };
  /** Key = `path.join('.')` for every PRESET_SETTINGS entry. */
  values: Record<string, PresetValue>;
  tierBands: { trivial: PresetTierBand; 'simple-medium': PresetTierBand; complex: PresetTierBand };
  supervisorModel: string;
  providerNode: { provider: 'anthropic' | 'openai'; harness?: 'codex' };
}

/** Same order as ROLE_NAMES in settings-api.ts; kept local so this module stays a leaf. */
const PRESET_ROLES: readonly Role[] = ['plan', 'work', 'review', 'test', 'ship', 'flywheel', 'strike', 'sequencer', 'knowledge', 'worker'];
/** Same lanes as REVIEW_SUB_ROLES in cloister/review-monitor.ts (which imports tmux). */
const PRESET_REVIEW_LANES = ['security', 'correctness', 'performance', 'requirements'] as const;

const WORKHORSE = { expensive: 'workhorse:expensive', mid: 'workhorse:mid', cheap: 'workhorse:cheap' } as const;
const HIGH: EffortLevel = 'high';

function setting(path: string, label: string, group: PresetSettingGroup, kind: PresetSetting['kind']): PresetSetting {
  return { path: path.split('.'), label, group, kind };
}

export const PRESET_SETTINGS: readonly PresetSetting[] = [
  setting('workhorses.expensive', 'Workhorse: expensive', 'workhorses', 'model'),
  setting('workhorses.mid', 'Workhorse: mid', 'workhorses', 'model'),
  setting('workhorses.cheap', 'Workhorse: cheap', 'workhorses', 'model'),
  ...PRESET_ROLES.flatMap((role) => [
    setting(`roles.${role}.model`, `Role ${role}: model`, 'roles', 'model'),
    setting(`roles.${role}.effort`, `Role ${role}: effort`, 'roles', 'effort'),
  ]),
  ...PRESET_REVIEW_LANES.flatMap((lane) => [
    setting(`roles.review.sub.${lane}.model`, `Review lane ${lane}: model`, 'review-lanes', 'model'),
    setting(`roles.review.sub.${lane}.effort`, `Review lane ${lane}: effort`, 'review-lanes', 'effort'),
  ]),
  setting('models.default_conversation_model', 'Default conversation model', 'conversation', 'model'),
  setting('models.status_review_model', 'Status review model', 'background', 'model'),
  setting('models.provider_fallback_model', 'Provider fallback model', 'background', 'model'),
  setting('conversations.compaction_model', 'Conversation compaction model', 'background', 'model'),
  setting('conversations.title_model', 'Conversation title model', 'background', 'model'),
  setting('conversations.fork_summary_model', 'Fork summary model', 'background', 'model'),
  setting('conversations.handoff_author_model', 'Handoff author model', 'background', 'model'),
  setting('tts.summarizer.model', 'TTS summarizer model', 'background', 'model'),
  setting('memory.extraction.provider', 'Memory extraction provider', 'background', 'enum'),
  setting('memory.extraction.model', 'Memory extraction model', 'background', 'model'),
  setting('registry.classification.model', 'Registry classification model', 'background', 'model'),
  setting('docs.classifier.model', 'Docs classifier model', 'background', 'model'),
  setting('docs.embedding.model', 'Docs embedding model', 'background', 'model'),
  setting('conversations.embedding_model', 'Conversation embedding model', 'background', 'model'),
  setting('conversationSearch.model', 'Conversation search model', 'background', 'model'),
  setting('conversations.enrichment.quick_model', 'Enrichment quick model', 'background', 'model'),
  setting('conversations.enrichment.deep_model', 'Enrichment deep model', 'background', 'model'),
  setting('jev.model', 'Jev model', 'background', 'model'),
  setting('models.gemini_thinking_level', 'Gemini thinking level', 'background', 'enum'),
];

/** Keep entries every preset shares: not chat-role models, or out of scope for v1. */
const SHARED_KEEPS: Record<string, PresetValue> = {
  'tts.summarizer.model': {
    keep: 'The TTS summarizer calls the OpenAI chat API directly with an OpenAI API key (tts-summarizer.ts); it needs an OpenAI model and the E4 summary gate.',
  },
  'registry.classification.model': {
    keep: 'Coupled to registry.classification.provider; out of scope for v1.',
  },
  'docs.classifier.model': { keep: 'Classifier model, not a chat role.' },
  'docs.embedding.model': { keep: 'Embedding model, not a chat role.' },
  'conversations.embedding_model': { keep: 'Embedding model, not a chat role.' },
  'conversationSearch.model': { keep: 'Embedding model, not a chat role.' },
  'conversations.enrichment.quick_model': { keep: 'Unset means "use the default path"; no eval covers it.' },
  'conversations.enrichment.deep_model': { keep: 'Unset means "use the default path"; no eval covers it.' },
  'jev.model': { keep: 'Third-party judgment service, not a provider model.' },
  'models.gemini_thinking_level': { keep: 'Gemini only.' },
};

/** Model roles in the expensive band; every other role runs on `mid`. */
const EXPENSIVE_ROLES: ReadonlySet<Role> = new Set<Role>(['plan', 'review', 'strike', 'sequencer', 'knowledge', 'flywheel']);

function roleValues(workModel: unknown): Record<string, PresetValue> {
  const values: Record<string, PresetValue> = {};
  for (const role of PRESET_ROLES) {
    const model = role === 'work' ? workModel : EXPENSIVE_ROLES.has(role) ? WORKHORSE.expensive : WORKHORSE.mid;
    values[`roles.${role}.model`] = { set: model };
    values[`roles.${role}.effort`] = { set: HIGH };
  }
  for (const lane of PRESET_REVIEW_LANES) {
    values[`roles.review.sub.${lane}.model`] = { set: 'parent' };
    values[`roles.review.sub.${lane}.effort`] = { set: HIGH };
  }
  return values;
}

const ANTHROPIC_BACKGROUND: Record<string, PresetValue> = {
  'models.default_conversation_model': { set: 'claude-sonnet-5-5' },
  'models.status_review_model': { set: 'claude-sonnet-5-5' },
  'models.provider_fallback_model': { set: 'claude-sonnet-5-5' },
  'conversations.compaction_model': { set: 'claude-haiku-4-5' },
  'conversations.title_model': { set: 'claude-haiku-4-5' },
  'conversations.fork_summary_model': { set: 'claude-sonnet-5-5' },
  'conversations.handoff_author_model': { set: 'claude-sonnet-5-5' },
  'memory.extraction.provider': { set: 'anthropic' },
  'memory.extraction.model': { set: 'claude-haiku-4-5' },
};

const OPENAI_BACKGROUND_KEEP =
  'Background AI runs through `claude -p`; GPT-6 Luna is not yet fit for titles, compaction, summaries or memory (routing research).';

const OPENAI_BACKGROUND: Record<string, PresetValue> = {
  'models.default_conversation_model': { set: 'gpt-6-sol' },
  'models.status_review_model': { keep: OPENAI_BACKGROUND_KEEP },
  'models.provider_fallback_model': { keep: 'The provider fallback is an Anthropic model by definition.' },
  'conversations.compaction_model': { keep: OPENAI_BACKGROUND_KEEP },
  'conversations.title_model': { keep: OPENAI_BACKGROUND_KEEP },
  'conversations.fork_summary_model': {
    keep: 'The 272K GPT context pin excludes GPT from the 1M fork-summary slot.',
  },
  'conversations.handoff_author_model': { keep: OPENAI_BACKGROUND_KEEP },
  'memory.extraction.provider': { keep: OPENAI_BACKGROUND_KEEP },
  'memory.extraction.model': { keep: OPENAI_BACKGROUND_KEEP },
};

const ANTHROPIC_EVAL_REPORT = 'docs/model-evals/2026-09-29-opus-5-5-vs-sonnet-5-5.md';

const ANTHROPIC_TIER_BANDS: ModelPreset['tierBands'] = {
  // Haiku 4.5 has no effort control, so the cheap band sets no effort.
  trivial: { model: WORKHORSE.cheap },
  'simple-medium': { model: WORKHORSE.mid, effort: HIGH },
  // D16: expert uses the expensive slot too; no eval covers Fable 5.1.
  complex: { model: WORKHORSE.expensive, effort: HIGH },
};

const ANTHROPIC: ModelPreset = {
  id: 'anthropic',
  label: 'Anthropic defaults',
  provider: 'anthropic',
  harness: 'claude-code',
  version: 1,
  date: '2026-09-29',
  pilot: false,
  evidence: {
    status: 'eval',
    reportPath: ANTHROPIC_EVAL_REPORT,
    summary: 'Opus 5.5 found 30/60 review blockers vs Sonnet 5.5 10/60; keep mid and review on Opus.',
  },
  values: {
    'workhorses.expensive': { set: 'claude-opus-5-5' },
    'workhorses.mid': { set: 'claude-opus-5-5' },
    'workhorses.cheap': { set: 'claude-haiku-4-5' },
    ...roleValues(WORKHORSE.mid),
    ...ANTHROPIC_BACKGROUND,
    ...SHARED_KEEPS,
  },
  tierBands: ANTHROPIC_TIER_BANDS,
  supervisorModel: WORKHORSE.expensive,
  providerNode: { provider: 'anthropic' },
};

const ANTHROPIC_COST_SAVER: ModelPreset = {
  ...ANTHROPIC,
  id: 'anthropic-cost-saver',
  label: 'Anthropic cost-saver (pilot)',
  pilot: true,
  evidence: {
    status: 'eval',
    reportPath: ANTHROPIC_EVAL_REPORT,
    summary: 'Pilot: Sonnet 5.5 matched Opus on delegated execution at ~45% of the cost; 30% of work issues run on Sonnet 5.5.',
  },
  values: {
    ...ANTHROPIC.values,
    ...roleValues([
      { model: WORKHORSE.mid, weight: 70 },
      { model: 'claude-sonnet-5-5', weight: 30 },
    ]),
  },
};

const OPENAI: ModelPreset = {
  id: 'openai',
  label: 'OpenAI defaults',
  provider: 'openai',
  harness: 'codex',
  version: 1,
  date: '2026-09-29',
  pilot: false,
  evidence: {
    status: 'research',
    reportPath: '.pan/drafts/model-routing-2026-09.md',
    summary: 'Research-backed placements; not yet run through Overdeck evals (E2/E6 pending for GPT).',
  },
  values: {
    'workhorses.expensive': { set: 'gpt-6-astra' },
    'workhorses.mid': { set: 'gpt-6-sol' },
    'workhorses.cheap': { set: 'gpt-6-luna' },
    ...roleValues(WORKHORSE.mid),
    ...OPENAI_BACKGROUND,
    ...SHARED_KEEPS,
  },
  tierBands: {
    trivial: { model: WORKHORSE.cheap, effort: HIGH },
    'simple-medium': { model: WORKHORSE.mid, effort: HIGH },
    complex: { model: WORKHORSE.expensive, effort: HIGH },
  },
  supervisorModel: WORKHORSE.expensive,
  providerNode: { provider: 'openai', harness: 'codex' },
};

export const MODEL_PRESETS: readonly ModelPreset[] = [ANTHROPIC, ANTHROPIC_COST_SAVER, OPENAI];

export function getPreset(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((preset) => preset.id === id);
}

function isConcreteModelId(model: unknown): model is string {
  return typeof model === 'string' && model !== 'parent' && !model.startsWith('workhorse:');
}

/**
 * Every concrete model id the preset writes (workhorse refs and `parent` are
 * skipped), deduped in first-seen order.
 */
export function presetModelIds(preset: ModelPreset): string[] {
  const ids: string[] = [];
  const add = (model: unknown): void => {
    if (isConcreteModelId(model) && !ids.includes(model)) ids.push(model);
  };
  for (const entry of PRESET_SETTINGS) {
    if (entry.kind !== 'model') continue;
    const value = preset.values[entry.path.join('.')];
    if (!value || !('set' in value)) continue;
    if (Array.isArray(value.set)) {
      for (const weighted of value.set) add((weighted as { model?: unknown }).model);
    } else {
      add(value.set);
    }
  }
  add(preset.tierBands.trivial.model);
  add(preset.tierBands['simple-medium'].model);
  add(preset.tierBands.complex.model);
  add(preset.supervisorModel);
  return ids;
}

/** Model ids the preset writes that the catalog does not know or has deprecated. */
export function unknownPresetModelIds(preset: ModelPreset): string[] {
  return presetModelIds(preset).filter((id) => !hasModelCapability(resolveModelId(id)) || id in MODEL_DEPRECATIONS);
}
