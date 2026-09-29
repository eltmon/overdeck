/**
 * PAN-4400 WI-1: preset data covers every registry path, writes only known,
 * non-deprecated model ids, and uses `high` effort that each resolved model
 * accepts.
 */
import { describe, expect, it } from 'vitest';

import { effortConfigErrors } from '../../../../src/lib/agents/effort-support.js';
import { MODEL_DEPRECATIONS, hasModelCapability, resolveModelId } from '../../../../src/lib/model-capabilities.js';
import {
  MODEL_PRESETS,
  PRESET_SETTINGS,
  getPreset,
  presetModelIds,
  unknownPresetModelIds,
  type ModelPreset,
  type PresetValue,
} from '../../../../src/lib/model-presets/presets.js';

const D7_BACKGROUND_PATHS = [
  'models.status_review_model',
  'models.provider_fallback_model',
  'conversations.compaction_model',
  'conversations.title_model',
  'conversations.fork_summary_model',
  'conversations.handoff_author_model',
  'tts.summarizer.model',
  'memory.extraction.provider',
  'memory.extraction.model',
];

function setValue(preset: ModelPreset, path: string): unknown {
  const value: PresetValue | undefined = preset.values[path];
  return value && 'set' in value ? value.set : undefined;
}

/** Resolves a model ref through the preset's own workhorses; `parent` resolves to the review model. */
function derefModels(preset: ModelPreset, ref: unknown): string[] {
  if (Array.isArray(ref)) return ref.flatMap((entry) => derefModels(preset, (entry as { model: string }).model));
  if (ref === 'parent') return derefModels(preset, setValue(preset, 'roles.review.model'));
  if (typeof ref !== 'string') throw new Error(`not a model ref: ${JSON.stringify(ref)}`);
  if (ref.startsWith('workhorse:')) return derefModels(preset, setValue(preset, `workhorses.${ref.slice('workhorse:'.length)}`));
  return [ref];
}

describe('model presets', () => {
  it('ships the anthropic, anthropic-cost-saver and openai presets', () => {
    expect(MODEL_PRESETS.map((preset) => preset.id)).toEqual(['anthropic', 'anthropic-cost-saver', 'openai']);
    expect(getPreset('openai')?.evidence.status).toBe('research');
    expect(getPreset('anthropic-cost-saver')?.pilot).toBe(true);
    expect(getPreset('nope')).toBeUndefined();
  });

  it('every preset covers every registry path', () => {
    for (const preset of MODEL_PRESETS) {
      for (const entry of PRESET_SETTINGS) {
        const key = entry.path.join('.');
        const value = preset.values[key];
        expect(value, `${preset.id} ${key}`).toBeDefined();
        if (value && 'keep' in value) expect(value.keep.trim(), `${preset.id} ${key} keep reason`).not.toBe('');
      }
      // No stray values outside the registry.
      const registryKeys = new Set(PRESET_SETTINGS.map((entry) => entry.path.join('.')));
      expect(Object.keys(preset.values).filter((key) => !registryKeys.has(key)), preset.id).toEqual([]);
    }
  });

  it('every model id is known', () => {
    for (const preset of MODEL_PRESETS) {
      const ids = presetModelIds(preset);
      expect(ids.length, preset.id).toBeGreaterThan(0);
      for (const id of ids) {
        expect(hasModelCapability(resolveModelId(id)), `${preset.id} ${id}`).toBe(true);
        expect(id in MODEL_DEPRECATIONS, `${preset.id} ${id} deprecated`).toBe(false);
      }
      expect(unknownPresetModelIds(preset), preset.id).toEqual([]);
    }
  });

  it('an unknown model id fails the catalog check', () => {
    const anthropic = getPreset('anthropic')!;
    const broken: ModelPreset = {
      ...anthropic,
      values: { ...anthropic.values, 'workhorses.mid': { set: 'not-a-model' } },
    };
    expect(unknownPresetModelIds(broken)).toEqual(['not-a-model']);
  });

  it('effort is high and valid', () => {
    for (const preset of MODEL_PRESETS) {
      for (const entry of PRESET_SETTINGS.filter((setting) => setting.kind === 'effort')) {
        const path = entry.path.join('.');
        const effort = setValue(preset, path);
        expect(effort, `${preset.id} ${path}`).toBe('high');
        const modelPath = [...entry.path.slice(0, -1), 'model'].join('.');
        const models = derefModels(preset, setValue(preset, modelPath));
        expect(models, `${preset.id} ${modelPath}`).not.toContain('claude-haiku-4-5');
        expect(effortConfigErrors(path, effort, models), `${preset.id} ${path}`).toEqual([]);
      }
      for (const [band, tier] of Object.entries(preset.tierBands)) {
        if (tier.effort === undefined) continue;
        expect(tier.effort, `${preset.id} tier ${band}`).toBe('high');
        const models = derefModels(preset, tier.model);
        expect(models, `${preset.id} tier ${band}`).not.toContain('claude-haiku-4-5');
        expect(effortConfigErrors(`tier.${band}`, tier.effort, models), `${preset.id} tier ${band}`).toEqual([]);
      }
    }
    expect(getPreset('anthropic')!.tierBands.trivial.effort).toBeUndefined();
    expect(getPreset('anthropic-cost-saver')!.tierBands.trivial.effort).toBeUndefined();
  });

  it('no preset is a hardcoded fallback', () => {
    for (const preset of MODEL_PRESETS) {
      for (const slot of ['expensive', 'mid', 'cheap']) {
        expect('set' in preset.values[`workhorses.${slot}`]!, `${preset.id} workhorses.${slot}`).toBe(true);
      }
    }
    const openai = getPreset('openai')!;
    for (const path of D7_BACKGROUND_PATHS) {
      expect('keep' in openai.values[path]!, `openai ${path}`).toBe(true);
    }
    for (const id of ['anthropic', 'anthropic-cost-saver'] as const) {
      expect('keep' in getPreset(id)!.values['tts.summarizer.model']!, `${id} tts.summarizer.model`).toBe(true);
    }
  });

  it('the cost-saver splits work 70/30 between mid and Sonnet 5.5', () => {
    expect(setValue(getPreset('anthropic-cost-saver')!, 'roles.work.model')).toEqual([
      { model: 'workhorse:mid', weight: 70 },
      { model: 'claude-sonnet-5-5', weight: 30 },
    ]);
    expect(setValue(getPreset('anthropic-cost-saver')!, 'roles.review.model')).toBe('workhorse:expensive');
    expect(setValue(getPreset('anthropic')!, 'roles.work.model')).toBe('workhorse:mid');
  });
});
