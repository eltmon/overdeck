/** Discover the installed OpenCode catalog without accessing its private stores. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OpenCodeModelId } from './settings.js';
import { resolveHarnessBinary } from './harness-binary.js';

const execFileAsync = promisify(execFile);
export interface OpenCodeModel {
  id: OpenCodeModelId;
  name: string;
  costPer1MTokens: number;
  contextWindow?: number;
  harness: 'opencode';
  effortLevels: string[];
}

export function parseOpenCodeModels(output: string): OpenCodeModel[] {
  const models: OpenCodeModel[] = [];
  // `models --verbose` emits a provider/model line followed by a pretty JSON object.
  const records = output.split(/^(?=[a-zA-Z0-9_-]+\/[^\s]+\r?$)/m);
  for (const record of records) {
    const newline = record.indexOf('\n');
    if (newline < 0) continue;
    const id = record.slice(0, newline).trim();
    if (!/^opencode(?:-go)?\/[^\s/]+$/.test(id)) continue;
    const model = JSON.parse(record.slice(newline + 1)) as {
      name?: string; status?: string; cost?: { input?: number; output?: number };
      limit?: { context?: number };
      variants?: Record<string, unknown>;
    };
    if (model.status === 'deprecated') continue;
    models.push({
      id: id as OpenCodeModelId,
      name: model.name ?? id,
      costPer1MTokens: ((model.cost?.input ?? 0) + (model.cost?.output ?? 0)) / 2,
      ...(model.limit?.context ? { contextWindow: model.limit.context } : {}),
      harness: 'opencode',
      effortLevels: Object.keys(model.variants ?? {}),
    });
  }
  return models;
}

let cached: { expiresAt: number; models: OpenCodeModel[] } | undefined;
let pending: Promise<OpenCodeModel[]> | undefined;

export async function discoverOpenCodeModels(): Promise<OpenCodeModel[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  if (pending) return pending;
  pending = (async () => {
    const binary = await resolveHarnessBinary('opencode');
    if (!binary) return [];
    const { stdout } = await execFileAsync(binary, ['models', '--verbose'], {
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
    });
    const models = parseOpenCodeModels(stdout);
    cached = { expiresAt: Date.now() + 60_000, models };
    return models;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
