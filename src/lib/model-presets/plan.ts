/**
 * Preset plan engine (PAN-4400): the per-setting diff one preset would make
 * against the global config.yaml. The CLI, the HTTP route and the Settings UI
 * all render this one object, and apply refuses unless the operator's digest
 * matches a fresh plan. Planning never writes.
 *
 * Rows come from three sources: the static PRESET_SETTINGS registry, the
 * user-named tiers and supervisor under `tiered_execution` (D9), and the
 * preset provider's `models.providers.<p>` node (D10). Two gates can turn
 * `change` rows into `skipped` rows: missing provider credentials block the
 * whole plan (D8), and a harness the policy denies skips that row — or blocks
 * the plan when the row is a workhorse slot, because roles reference slots.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { isNode, parseDocument, type Document } from 'yaml';
import { getGlobalConfigPath } from '../config-yaml/load.js';
import { canUseHarness, type HarnessPolicyContext } from '../harness-policy.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { AuthMode } from '../subscription-types.js';
import { PRESET_SETTINGS, getPreset, type ModelPreset, type PresetSettingGroup, type PresetTierBand } from './presets.js';

export interface PresetPlanRow {
  /** Dotted display path; `segments` is the exact YAML path (tier names may contain dots). */
  path: string;
  segments: readonly string[];
  label: string;
  group: PresetSettingGroup;
  /** Raw JS value, or `{ absent: true }` for a missing key. */
  before: unknown;
  /** Raw JS value, `{ absent: true }`, or `{ removed: true }` for a node the apply deletes. */
  after: unknown;
  status: 'change' | 'same' | 'skipped';
  reason?: string;
}

export interface PresetPlan {
  presetId: ModelPreset['id'];
  version: number;
  date: string;
  provider: ModelPreset['provider'];
  label: string;
  pilot: boolean;
  evidence: ModelPreset['evidence'];
  blocked?: { reason: string };
  rows: PresetPlanRow[];
  notes: string[];
  digest: string;
}

export interface PresetPlanDeps {
  readConfigText(): Promise<string>;
  getAuthMode(model: string): Promise<AuthMode | undefined>;
  resolveCodexContext(harness: RuntimeName, model: string, authMode: AuthMode | undefined): Promise<HarnessPolicyContext>;
}

export class UnknownPresetError extends Error {
  constructor(readonly presetId: string) {
    super(`Unknown model preset '${presetId}'. Run \`pan models preset list\` to see the presets.`);
    this.name = 'UnknownPresetError';
  }
}

export const ABSENT = Object.freeze({ absent: true as const });
export const REMOVED = Object.freeze({ removed: true as const });

export function isAbsentValue(value: unknown): value is { absent: true } {
  return typeof value === 'object' && value !== null && (value as { absent?: unknown }).absent === true && Object.keys(value).length === 1;
}

export function isRemovedValue(value: unknown): value is { removed: true } {
  return typeof value === 'object' && value !== null && (value as { removed?: unknown }).removed === true && Object.keys(value).length === 1;
}

/** Reads the global config.yaml; a missing file is an empty config. */
async function readGlobalConfigText(): Promise<string> {
  try {
    return await readFile(getGlobalConfigPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

// runtime-command.js and codex/policy-context.js pull in the agent runtime;
// load them only when a real plan is computed.
export const defaultPresetPlanDeps: PresetPlanDeps = {
  readConfigText: readGlobalConfigText,
  async getAuthMode(model) {
    const { getProviderAuthMode } = await import('../agents/runtime-command.js');
    return getProviderAuthMode(model);
  },
  async resolveCodexContext(harness, model, authMode) {
    const { resolveCodexPolicyContext } = await import('../codex/policy-context.js');
    return resolveCodexPolicyContext(harness, model, authMode);
  },
};

export function parseConfigDocument(text: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(`config.yaml does not parse: ${doc.errors.map((error) => error.message).join('; ')}`);
  }
  return doc;
}

export function readRawValue(doc: Document, segments: readonly string[]): unknown {
  if (!doc.hasIn(segments)) return ABSENT;
  const value: unknown = doc.getIn(segments);
  return isNode(value) ? value.toJSON() : value;
}

const DIFFICULTY_ORDER = ['trivial', 'simple', 'medium', 'complex', 'expert'] as const;
type Band = keyof ModelPreset['tierBands'];

function bandForDifficulties(difficulties: unknown): Band | undefined {
  if (!Array.isArray(difficulties)) return undefined;
  const hardest = Math.max(...difficulties.map((d) => DIFFICULTY_ORDER.indexOf(d as (typeof DIFFICULTY_ORDER)[number])));
  if (hardest < 0) return undefined;
  if (hardest === 0) return 'trivial';
  return hardest <= 2 ? 'simple-medium' : 'complex';
}

/** Resolves a model ref through the preset's own values: workhorse slots, and `parent` → the review model. */
function concreteModels(preset: ModelPreset, ref: unknown): string[] {
  if (Array.isArray(ref)) return ref.flatMap((entry) => concreteModels(preset, (entry as { model?: unknown }).model));
  if (typeof ref !== 'string') return [];
  if (ref === 'parent') return concreteModels(preset, presetSetValue(preset, 'roles.review.model'));
  if (ref.startsWith('workhorse:')) return concreteModels(preset, presetSetValue(preset, `workhorses.${ref.slice('workhorse:'.length)}`));
  return [ref];
}

function presetSetValue(preset: ModelPreset, key: string): unknown {
  const value = preset.values[key];
  return value && 'set' in value ? value.set : undefined;
}

interface DraftRow extends Omit<PresetPlanRow, 'status'> {
  status?: PresetPlanRow['status'];
  /** Models and harness the row puts to work; checked by the harness gate. */
  gate?: { models: string[]; harness: RuntimeName; blocksPlan: boolean; siblings?: string[] };
}

function row(segments: readonly string[], label: string, group: PresetSettingGroup, before: unknown, after: unknown): DraftRow {
  return { path: segments.join('.'), segments, label, group, before, after };
}

function registryRows(preset: ModelPreset, doc: Document): DraftRow[] {
  const rows: DraftRow[] = [];
  for (const entry of PRESET_SETTINGS) {
    const key = entry.path.join('.');
    const value = preset.values[key];
    const before = readRawValue(doc, entry.path);
    if (!value || 'keep' in value) {
      rows.push({ ...row(entry.path, entry.label, entry.group, before, before), status: 'skipped', reason: value?.keep ?? 'Not covered by this preset.' });
      continue;
    }
    const draft = row(entry.path, entry.label, entry.group, before, value.set);
    if (entry.kind === 'model') {
      const roleHarness = entry.path[0] === 'roles' ? doc.getIn(['roles', entry.path[1], 'harness']) : undefined;
      draft.gate = {
        models: concreteModels(preset, value.set),
        harness: typeof roleHarness === 'string' ? (roleHarness as RuntimeName) : preset.harness,
        blocksPlan: entry.group === 'workhorses',
        // A denied role or lane model also skips its effort row.
        siblings: entry.path[0] === 'roles' ? [[...entry.path.slice(0, -1), 'effort'].join('.')] : undefined,
      };
    }
    rows.push(draft);
  }
  return rows;
}

function tierRows(preset: ModelPreset, doc: Document, notes: string[]): DraftRow[] {
  const rows: DraftRow[] = [];
  const tiers = readRawValue(doc, ['tiered_execution', 'tiers']);
  const tierNames = typeof tiers === 'object' && tiers !== null && !isAbsentValue(tiers) ? Object.keys(tiers) : [];
  if (tierNames.length === 0) notes.push('tiered execution has no tiers; nothing to set');

  for (const name of tierNames) {
    const base = ['tiered_execution', 'tiers', name];
    const band = bandForDifficulties(readRawValue(doc, [...base, 'difficulties']));
    if (!band) {
      notes.push(`tier ${name} lists no known difficulties; left as is`);
      continue;
    }
    const tierBand: PresetTierBand = preset.tierBands[band];
    const gateKey = `${base.join('.')}.model`;
    const siblings: string[] = [];
    const tierRowsForName: DraftRow[] = [];
    const push = (field: string, after: unknown): void => {
      const segments = [...base, field];
      tierRowsForName.push(row(segments, `Tier ${name}: ${field}`, 'tiers', readRawValue(doc, segments), after));
      if (field !== 'model') siblings.push(segments.join('.'));
    };
    push('model', tierBand.model);
    push('harness', preset.harness);
    if (tierBand.effort) push('effort', tierBand.effort);
    if (doc.hasIn([...base, 'distribution'])) push('distribution', REMOVED);
    const modelRow = tierRowsForName.find((r) => r.path === gateKey)!;
    modelRow.gate = { models: concreteModels(preset, tierBand.model), harness: preset.harness, blocksPlan: false, siblings };
    rows.push(...tierRowsForName);
  }

  if (doc.hasIn(['tiered_execution', 'supervisor'])) {
    const modelSegments = ['tiered_execution', 'supervisor', 'model'];
    const harnessSegments = ['tiered_execution', 'supervisor', 'harness'];
    const modelRow = row(modelSegments, 'Tier supervisor: model', 'tiers', readRawValue(doc, modelSegments), preset.supervisorModel);
    modelRow.gate = { models: concreteModels(preset, preset.supervisorModel), harness: preset.harness, blocksPlan: false, siblings: [harnessSegments.join('.')] };
    rows.push(modelRow, row(harnessSegments, 'Tier supervisor: harness', 'tiers', readRawValue(doc, harnessSegments), preset.harness));
  }
  return rows;
}

/** D10: the provider node is written whole; a boolean or absent node becomes an object only when a harness must be set. */
function providerRow(preset: ModelPreset, doc: Document): DraftRow {
  const { provider, harness } = preset.providerNode;
  const segments = ['models', 'providers', provider];
  const before = readRawValue(doc, segments);
  let after: unknown;
  if (typeof before === 'object' && before !== null && !isAbsentValue(before)) {
    after = { ...(before as Record<string, unknown>), enabled: true, ...(harness ? { harness } : {}) };
  } else if (harness) {
    after = { enabled: true, harness };
  } else if (before === false) {
    after = true;
  } else {
    // An absent anthropic node is already enabled (defaults.ts enabledProviders).
    after = before;
  }
  return row(segments, `Provider ${provider}`, 'providers', before, after);
}

function digestRows(rows: readonly PresetPlanRow[]): string {
  return createHash('sha256').update(JSON.stringify(rows.map((r) => [r.path, r.before, r.after, r.status]))).digest('hex');
}

function providerDisplayName(provider: ModelPreset['provider']): string {
  return provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
}

export async function planPresetApplyFromText(preset: ModelPreset, configText: string, deps: PresetPlanDeps): Promise<PresetPlan> {
  const doc = parseConfigDocument(configText);
  const notes: string[] = [];
  const drafts = [...registryRows(preset, doc), ...tierRows(preset, doc, notes), providerRow(preset, doc)];
  for (const draft of drafts) {
    draft.status ??= isDeepStrictEqual(draft.before, draft.after) ? 'same' : 'change';
  }

  let blocked: { reason: string } | undefined;
  const midModel = concreteModels(preset, 'workhorse:mid')[0]!;
  const authMode = await deps.getAuthMode(midModel);
  if (authMode === undefined) {
    const login = preset.provider === 'anthropic' ? 'claude' : 'codex login';
    blocked = { reason: `${providerDisplayName(preset.provider)} has no credentials. Sign in (${login}) or set an API key in Settings → Providers.` };
  } else {
    const contexts = new Map<string, Promise<HarnessPolicyContext>>();
    const skipReasons = new Map<string, string>();
    for (const draft of drafts) {
      if (!draft.gate || draft.status === 'skipped') continue;
      for (const model of draft.gate.models) {
        const key = `${draft.gate.harness}\u0000${model}`;
        if (!contexts.has(key)) contexts.set(key, deps.resolveCodexContext(draft.gate.harness, model, authMode));
        const decision = canUseHarness(draft.gate.harness, model, authMode, await contexts.get(key));
        if (decision.allowed) continue;
        const reason = decision.reason ?? `${draft.gate.harness} cannot run ${model}.`;
        if (draft.gate.blocksPlan) blocked ??= { reason: `${draft.label}: ${reason}` };
        skipReasons.set(draft.path, reason);
        for (const sibling of draft.gate.siblings ?? []) skipReasons.set(sibling, reason);
        break;
      }
    }
    for (const draft of drafts) {
      const reason = skipReasons.get(draft.path);
      if (reason && draft.status === 'change') {
        draft.status = 'skipped';
        draft.reason = reason;
      }
    }
  }

  if (blocked) {
    for (const draft of drafts) {
      if (draft.status === 'change') {
        draft.status = 'skipped';
        draft.reason = blocked.reason;
      }
    }
  }

  const rows: PresetPlanRow[] = drafts.map(({ gate: _gate, ...rest }) => ({ ...rest, status: rest.status! }));
  return {
    presetId: preset.id,
    version: preset.version,
    date: preset.date,
    provider: preset.provider,
    label: preset.label,
    pilot: preset.pilot,
    evidence: preset.evidence,
    ...(blocked ? { blocked } : {}),
    rows,
    notes,
    digest: digestRows(rows),
  };
}

export async function planPresetApply(presetId: string, deps: PresetPlanDeps = defaultPresetPlanDeps): Promise<PresetPlan> {
  const preset = getPreset(presetId);
  if (!preset) throw new UnknownPresetError(presetId);
  return planPresetApplyFromText(preset, await deps.readConfigText(), deps);
}
