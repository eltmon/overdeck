/**
 * Preset state (PAN-4400 D12): what was last applied and the values it
 * replaced. Both are facts no other source can derive, so they live in
 * `~/.overdeck/model-presets-state.json`, never in config.yaml (the retired
 * `models.preset` key must stay retired).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import type { PresetId } from './presets.js';

export interface PresetUndoChange {
  path: string;
  segments: string[];
  /** Raw value before the apply, or `{ absent: true }`. */
  before: unknown;
  /** Value the apply wrote, or `{ removed: true }`. */
  after: unknown;
}

/** A parent node the apply created (it was absent or null); undo reverts it once it is empty again. */
export interface PresetUndoContainer {
  segments: string[];
  before: unknown;
}

export interface PresetUndoRecord {
  presetId: PresetId;
  version: number;
  appliedAt: string;
  changes: PresetUndoChange[];
  containers: PresetUndoContainer[];
}

export interface PresetState {
  lastApplied?: { presetId: PresetId; version: number; appliedAt: string };
  undo?: PresetUndoRecord;
}

export function presetStatePath(): string {
  return join(getOverdeckHome(), 'model-presets-state.json');
}

/** A missing or unparsable state file reads as no state. */
export async function readPresetState(): Promise<PresetState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(presetStatePath(), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as PresetState) : {};
  } catch {
    return {};
  }
}

export async function writePresetState(state: PresetState): Promise<void> {
  await writeFileAtomic(presetStatePath(), `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

/**
 * Writes via a sibling temp file and `rename`, so a reader never sees a
 * half-written file. An existing file keeps its mode; a new one gets `mode`.
 */
export async function writeFileAtomic(path: string, text: string, mode: number): Promise<void> {
  let fileMode = mode;
  try {
    fileMode = (await stat(path)).mode & 0o777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await mkdir(dirname(path), { recursive: true });
  }
  const tempPath = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    await writeFile(tempPath, text, { mode: fileMode });
    await rename(tempPath, path);
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }
}
