/**
 * Preset apply and undo (PAN-4400 D1-D3, D11, D12): a path-scoped write door
 * for config.yaml. It never goes through saveSettingsApi, which rewrites
 * roles/workhorses wholesale, writes environment API keys back in plaintext
 * and drops sub-keys. Here only the plan's `change` paths are edited with
 * `setIn`/`deleteIn`; every other node keeps its text.
 *
 * Each write: plan against the file text → edit the document → validate the
 * candidate → re-read and compare-and-swap (a CLI and the dashboard do not
 * share the in-process queue) → atomic write → clear the config cache →
 * record the undo state.
 */
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { isCollection, isMap, isScalar, type Document } from 'yaml';
import { effortConfigErrors } from '../agents/effort-support.js';
import { clearConfigCache, getGlobalConfigPath } from '../config-yaml/load.js';
import { mergeConfigs } from '../config-yaml/merge.js';
import { derefWorkhorse, resolveModel } from '../config-yaml/roles.js';
import type { NormalizedConfig, Role, YamlConfig } from '../config-yaml/schema.js';
import { runSettingsWriteSerialized } from '../settings-api.js';
import {
  ABSENT,
  defaultPresetPlanDeps,
  isAbsentValue,
  isRemovedValue,
  parseConfigDocument,
  planPresetApplyFromText,
  readRawValue,
  UnknownPresetError,
  type PresetPlan,
  type PresetPlanDeps,
  type PresetPlanRow,
} from './plan.js';
import { MODEL_PRESETS, getPreset, type ModelPreset } from './presets.js';
import {
  readPresetState,
  writeFileAtomic,
  writePresetState,
  type PresetState,
  type PresetUndoChange,
  type PresetUndoContainer,
} from './state.js';

export class PresetBlockedError extends Error {
  readonly code = 'preset-blocked';
  constructor(reason: string) {
    super(reason);
    this.name = 'PresetBlockedError';
  }
}

export class PresetPlanStaleError extends Error {
  readonly code = 'preset-plan-stale';
  constructor() {
    super('config.yaml changed since this preview; review the changes again and re-apply.');
    this.name = 'PresetPlanStaleError';
  }
}

export class ConfigChangedError extends Error {
  readonly code = 'config-changed';
  constructor() {
    super('config.yaml changed while applying; run the command again.');
    this.name = 'ConfigChangedError';
  }
}

export class PresetValidationError extends Error {
  readonly code = 'preset-invalid';
  constructor(readonly errors: string[]) {
    super(`The preset would leave config.yaml invalid: ${errors.join('; ')}`);
    this.name = 'PresetValidationError';
  }
}

export class NoPresetUndoError extends Error {
  readonly code = 'no-preset-undo';
  constructor() {
    super('No preset apply to undo.');
    this.name = 'NoPresetUndoError';
  }
}

export interface PresetApplyDeps extends PresetPlanDeps {
  writeConfigText(text: string): Promise<void>;
}

/** Read/write deps for one config file; the defaults bind the global config.yaml. */
export function configFileDeps(configPath: string): Pick<PresetApplyDeps, 'readConfigText' | 'writeConfigText'> {
  return {
    async readConfigText() {
      try {
        return await readFile(configPath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw err;
      }
    },
    writeConfigText: (text) => writeFileAtomic(configPath, text, 0o600),
  };
}

function defaultApplyDeps(): PresetApplyDeps {
  return { ...defaultPresetPlanDeps, ...configFileDeps(getGlobalConfigPath()) };
}

function stringifyDocument(doc: Document): string {
  // lineWidth 0: never fold long scalars, so untouched lines keep their text.
  return doc.toString({ lineWidth: 0 });
}

function isEmptyNode(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (isScalar(value)) return value.value === null || value.value === undefined;
  if (isCollection(value)) return value.items.every((item) => isEmptyNode(isMap(value) ? (item as { value: unknown }).value : item));
  return false;
}

/**
 * Makes every ancestor of `segments` a map. An absent or null ancestor is
 * created and recorded, so undo can revert it once it is empty again.
 */
function ensureContainers(doc: Document, segments: readonly string[], created: PresetUndoContainer[]): void {
  for (let depth = 1; depth < segments.length; depth++) {
    const prefix = segments.slice(0, depth);
    const node: unknown = doc.getIn(prefix, true);
    if (isMap(node)) continue;
    if (node === undefined || (isScalar(node) && node.value === null)) {
      created.push({ segments: [...prefix], before: node === undefined ? ABSENT : null });
      doc.setIn(prefix, doc.createNode({}));
      continue;
    }
    throw new PresetValidationError([`${prefix.join('.')} is not a map, so ${segments.join('.')} cannot be set`]);
  }
}

function writeRawValue(doc: Document, segments: readonly string[], value: unknown): void {
  if (isAbsentValue(value) || isRemovedValue(value)) {
    doc.deleteIn(segments);
  } else {
    doc.setIn(segments, doc.createNode(value));
  }
}

function tryMerge(candidate: unknown): { config?: NormalizedConfig; error?: string } {
  try {
    return { config: mergeConfigs((candidate ?? {}) as YamlConfig).config };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function effortModels(config: NormalizedConfig, segments: readonly string[]): string[] {
  if (segments[0] === 'roles') {
    const role = segments[1] as Role;
    if (segments[2] === 'sub') return [resolveModel(role, segments[3], config)];
    const model = config.roles?.[role]?.model;
    if (Array.isArray(model)) return model.map((entry, i) => derefWorkhorse(entry.model, config, `roles.${role}.model[${i}].model`));
    return [resolveModel(role, undefined, config)];
  }
  if (segments[0] === 'tiered_execution' && segments[1] === 'tiers') {
    const tier = config.tieredExecution?.tiers?.[segments[2]!];
    return tier ? [tier.model] : [];
  }
  return [];
}

/** D3: the candidate must load, must not newly invalidate tiered execution, and every written effort must fit its model. */
function validateCandidate(originalText: string, doc: Document, changes: readonly { segments: readonly string[]; path: string; after: unknown }[]): void {
  const current = tryMerge(parseConfigDocument(originalText).toJS());
  const candidate = tryMerge(doc.toJS());
  if (!candidate.config) throw new PresetValidationError([candidate.error ?? 'config.yaml does not load']);
  const errors: string[] = [];
  if (current.config && !current.config.tieredExecutionInvalid && candidate.config.tieredExecutionInvalid) {
    errors.push(`tiered_execution: ${candidate.config.tieredExecutionInvalid.reason}`);
  }
  for (const change of changes) {
    if (change.segments[change.segments.length - 1] !== 'effort' || isAbsentValue(change.after) || isRemovedValue(change.after)) continue;
    try {
      errors.push(...effortConfigErrors(change.path, change.after, effortModels(candidate.config, change.segments)));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length > 0) throw new PresetValidationError(errors);
}

async function compareAndSwap(deps: PresetApplyDeps, plannedText: string, nextText: string): Promise<void> {
  if ((await deps.readConfigText()) !== plannedText) throw new ConfigChangedError();
  await deps.writeConfigText(nextText);
  clearConfigCache();
}

export interface PresetApplyResult {
  plan: PresetPlan;
  applied: PresetPlanRow[];
  skipped: PresetPlanRow[];
}

export function applyPreset(presetId: string, options: { expectedDigest: string }, deps: PresetApplyDeps = defaultApplyDeps()): Promise<PresetApplyResult> {
  const preset = getPreset(presetId);
  if (!preset) return Promise.reject(new UnknownPresetError(presetId));
  return runSettingsWriteSerialized(async () => {
    const text = await deps.readConfigText();
    const plan = await planPresetApplyFromText(preset, text, deps);
    if (plan.blocked) throw new PresetBlockedError(plan.blocked.reason);
    if (options.expectedDigest !== plan.digest) throw new PresetPlanStaleError();

    const applied = plan.rows.filter((row) => row.status === 'change');
    const doc = parseConfigDocument(text);
    const containers: PresetUndoContainer[] = [];
    for (const row of applied) {
      if (!isRemovedValue(row.after)) ensureContainers(doc, row.segments, containers);
      writeRawValue(doc, row.segments, row.after);
    }
    validateCandidate(text, doc, applied);
    await compareAndSwap(deps, text, stringifyDocument(doc));

    const appliedAt = new Date().toISOString();
    const changes: PresetUndoChange[] = applied.map((row) => ({ path: row.path, segments: [...row.segments], before: row.before, after: row.after }));
    await writePresetState({
      lastApplied: { presetId: preset.id, version: preset.version, appliedAt },
      undo: { presetId: preset.id, version: preset.version, appliedAt, changes, containers },
    });
    return { plan, applied, skipped: plan.rows.filter((row) => row.status === 'skipped') };
  });
}

export interface PresetUndoResult {
  restored: string[];
  leftAsIs: { path: string; reason: string }[];
}

export function undoLastPresetApply(deps: PresetApplyDeps = defaultApplyDeps()): Promise<PresetUndoResult> {
  return runSettingsWriteSerialized(async () => {
    const state = await readPresetState();
    const undo = state.undo;
    if (!undo) throw new NoPresetUndoError();

    const text = await deps.readConfigText();
    const doc = parseConfigDocument(text);
    const restored: string[] = [];
    const leftAsIs: PresetUndoResult['leftAsIs'] = [];
    const restoredChanges: { segments: readonly string[]; path: string; after: unknown }[] = [];
    for (const change of undo.changes) {
      const expected = isRemovedValue(change.after) ? ABSENT : change.after;
      if (!isDeepStrictEqual(readRawValue(doc, change.segments), expected)) {
        leftAsIs.push({ path: change.path, reason: 'changed since apply; left as is' });
        continue;
      }
      if (!isAbsentValue(change.before)) ensureContainers(doc, change.segments, []);
      writeRawValue(doc, change.segments, change.before);
      restored.push(change.path);
      restoredChanges.push({ segments: change.segments, path: change.path, after: change.before });
    }
    // Deepest first, so a nested created map is reverted before its parent is checked.
    for (const container of [...undo.containers].sort((a, b) => b.segments.length - a.segments.length)) {
      if (!doc.hasIn(container.segments) || !isEmptyNode(doc.getIn(container.segments, true))) continue;
      writeRawValue(doc, container.segments, container.before);
    }
    validateCandidate(text, doc, restoredChanges);
    await compareAndSwap(deps, text, stringifyDocument(doc));
    await writePresetState({});
    return { restored, leftAsIs };
  });
}

export interface PresetStatus {
  id: ModelPreset['id'];
  label: string;
  provider: ModelPreset['provider'];
  version: number;
  date: string;
  pilot: boolean;
  evidence: ModelPreset['evidence'];
  lastApplied?: PresetState['lastApplied'];
  updateAvailable: boolean;
}

export interface PresetStatusList {
  presets: PresetStatus[];
  undoAvailable: boolean;
}

export async function listPresetStatus(): Promise<PresetStatusList> {
  const state = await readPresetState();
  const lastApplied = state.lastApplied;
  return {
    presets: MODEL_PRESETS.map((preset) => {
      const applied = lastApplied?.presetId === preset.id ? lastApplied : undefined;
      return {
        id: preset.id,
        label: preset.label,
        provider: preset.provider,
        version: preset.version,
        date: preset.date,
        pilot: preset.pilot,
        evidence: preset.evidence,
        ...(applied ? { lastApplied: applied } : {}),
        updateAvailable: applied !== undefined && applied.version < preset.version,
      };
    }),
    undoAvailable: state.undo !== undefined,
  };
}
