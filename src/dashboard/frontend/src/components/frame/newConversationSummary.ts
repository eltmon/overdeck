/**
 * newConversationSummary — the New conversation button's second line
 * (PAN-5335 WI-8/D-7): the default model, harness (when not Claude Code) and
 * effort it will spawn with, e.g. "Opus 5.5 · High" or "GPT-5.5 · Codex · High".
 */

import { getProviderForPickerModel, pickerEffortLevels, type Harness, type ModelGroup } from '../shared/ModelPicker';
import { MODEL_EFFORT_SUPPORT } from '../chat/ModelPicker';
import { SHORT_LABELS, type EffortLevel } from '../chat/EffortPicker';
import { shortHarness } from '../CommandDeck/conversationMeta';
import { compactModelName } from '../../lib/model-names';

export interface NewConversationSummary {
  provider: string | undefined;
  providerLabel: string;
  fullLabel: string;
  shortName: string;
  harnessLabel: string | null;
  effortLabel: string | null;
}

/** "Claude Opus 5.5 (1M context)" -> "Opus 5.5". */
export function shortModelLabel(label: string): string {
  return label.replace(/^Claude /, '').replace(/ \([^)]*\)$/, '');
}

export function newConversationSummary(input: {
  model: string;
  harness: Harness;
  effort: EffortLevel;
  groups: ModelGroup[];
}): NewConversationSummary {
  const { model, harness, effort, groups } = input;
  const group = groups.find((g) => g.models.some((m) => m.id === model));
  const pickerModel = group?.models.find((m) => m.id === model);
  const provider = getProviderForPickerModel(model, groups);
  const fullLabel = pickerModel?.label ?? compactModelName(model);
  const providerLabel = group?.label ?? provider ?? model;
  const shortName = pickerModel ? shortModelLabel(fullLabel) : compactModelName(model);
  const harnessLabel = harness !== 'claude-code' ? shortHarness(harness) : null;

  // Same rule useCreateConversation uses to decide whether to send effort at
  // all — the line names exactly what quick create sends.
  const levels = pickerEffortLevels(model) ?? MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT];
  const effortLabel = levels?.length === 0 ? null : SHORT_LABELS[effort];

  return { provider, providerLabel, fullLabel, shortName, harnessLabel, effortLabel };
}

export function newConversationTitle(summary: NewConversationSummary): string {
  const parts = [summary.fullLabel, summary.harnessLabel, summary.effortLabel].filter(Boolean);
  return `New conversation with ${parts.join(' · ')} (N)`;
}
