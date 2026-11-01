/**
 * Operator placement settings for this machine (PAN-4651 FR-7, D-4651-8), read
 * raw from `${OVERDECK_HOME}/config.yaml` like `directory-config.ts`:
 *
 *   anywhere:
 *     machine:
 *       tags: [payments, big-disk]   # appended to the detected capability tags
 *       placement: on-request        # Auto skips this machine; default `auto`
 *
 * The block is not part of the typed config schema; a Settings save keeps it.
 * A missing, unreadable or malformed file reads as no tags and `auto`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MachinePlacementMode } from '@overdeck/contracts';
import yaml from 'js-yaml';

import { getOverdeckHome } from '../paths.js';

export interface MachineConfig {
  /** Operator tags as written; `machine-capabilities.ts` validates them. */
  tags: string[];
  placement: MachinePlacementMode;
}

export const DEFAULT_MACHINE_CONFIG: MachineConfig = { tags: [], placement: 'auto' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The `anywhere.machine` block of a parsed config document. */
export function parseMachineConfig(doc: unknown): MachineConfig {
  const machine = asRecord(asRecord(asRecord(doc)?.['anywhere'])?.['machine']);
  if (!machine) return DEFAULT_MACHINE_CONFIG;
  const rawTags = machine['tags'];
  const tags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === 'string') : [];
  const placement: MachinePlacementMode = machine['placement'] === 'on-request' ? 'on-request' : 'auto';
  return { tags, placement };
}

export async function readMachineConfig(): Promise<MachineConfig> {
  try {
    return parseMachineConfig(yaml.load(await readFile(join(getOverdeckHome(), 'config.yaml'), 'utf8')));
  } catch {
    return DEFAULT_MACHINE_CONFIG;
  }
}
