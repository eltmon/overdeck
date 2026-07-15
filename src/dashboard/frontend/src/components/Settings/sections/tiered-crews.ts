import { MODELS_BY_PROVIDER, type ModelDef } from '../modelCatalog';
import type {
  Harness,
  ModelId,
  SettingsConfig,
  TieredExecutionConfig,
  VBriefDifficulty,
  VBriefItemKind,
} from '../types';

export const DIFFICULTIES: readonly VBriefDifficulty[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

export interface CrewEntry {
  model: ModelId;
  harness: Harness;
  weight: number;
}

export interface Crew {
  /** Form-only identity. Tier names are derived from assignments on save. */
  id: string;
  model: ModelId;
  harness: Harness;
  distribution?: CrewEntry[];
}

export type CrewAssignments = Partial<Record<VBriefDifficulty, string>>;
export type CrewKindOverrides = Partial<Record<VBriefItemKind, string>>;
export type CrewRest = Omit<TieredExecutionConfig, 'tiers' | 'by_kind' | 'byKind' | 'difficultyToTier'> & {
  by_kind: CrewKindOverrides;
};

function sortedDifficulties(difficulties: readonly VBriefDifficulty[]): VBriefDifficulty[] {
  const wanted = new Set(difficulties);
  return DIFFICULTIES.filter((difficulty) => wanted.has(difficulty));
}

function sortedDistribution(entries: readonly CrewEntry[]): CrewEntry[] {
  return [...entries].sort((left, right) =>
    left.model.localeCompare(right.model)
    || left.harness.localeCompare(right.harness)
    || left.weight - right.weight,
  );
}

function staffingKey(crew: Omit<Crew, 'id'>): string {
  if (!crew.distribution) return `single:${crew.model}:${crew.harness}`;
  return `mix:${JSON.stringify(sortedDistribution(crew.distribution))}`;
}

export function deriveTierName(difficulties: readonly VBriefDifficulty[]): string {
  return sortedDifficulties(difficulties).join('-');
}

export function importCrews(config: TieredExecutionConfig): {
  crews: Crew[];
  assign: CrewAssignments;
  rest: CrewRest;
} {
  const crews: Crew[] = [];
  const crewByStaffing = new Map<string, Crew>();
  const sourceTierToCrew = new Map<string, string>();
  const assign: CrewAssignments = {};

  for (const [tierName, tier] of Object.entries(config.tiers ?? {})) {
    const staffing = {
      model: tier.model,
      harness: tier.harness,
      distribution: tier.distribution ? sortedDistribution(tier.distribution) : undefined,
    };
    const key = staffingKey(staffing);
    let crew = crewByStaffing.get(key);
    if (!crew) {
      crew = { id: tierName, ...staffing };
      crewByStaffing.set(key, crew);
      crews.push(crew);
    }
    sourceTierToCrew.set(tierName, crew.id);
    for (const difficulty of sortedDifficulties(tier.difficulties ?? [])) assign[difficulty] = crew.id;
  }

  const byKind = config.by_kind ?? config.byKind ?? {};
  const crewByKind: CrewKindOverrides = {};
  for (const [kind, tierName] of Object.entries(byKind)) {
    const crewId = tierName ? sourceTierToCrew.get(tierName) : undefined;
    if (crewId) crewByKind[kind as VBriefItemKind] = crewId;
  }

  const { tiers: _tiers, by_kind: _byKind, byKind: _byKindAlias, difficultyToTier: _difficultyToTier, ...rest } = config;
  return { crews, assign, rest: { ...rest, by_kind: crewByKind } };
}

export function serializeCrews(
  crews: readonly Crew[],
  assign: CrewAssignments,
  rest: CrewRest,
): TieredExecutionConfig {
  const tiers: TieredExecutionConfig['tiers'] = {};
  const crewToTier = new Map<string, string>();
  const kindsByCrew = new Map<string, VBriefItemKind[]>();

  for (const [kind, crewId] of Object.entries(rest.by_kind)) {
    if (!crewId) continue;
    const kinds = kindsByCrew.get(crewId) ?? [];
    kinds.push(kind as VBriefItemKind);
    kindsByCrew.set(crewId, kinds);
  }

  for (const crew of crews) {
    const difficulties = DIFFICULTIES.filter((difficulty) => assign[difficulty] === crew.id);
    const kinds = kindsByCrew.get(crew.id) ?? [];
    if (difficulties.length === 0) {
      if (kinds.length > 0) throw new Error(`Move or remove ${kinds.sort().join(', ')} kind overrides before unassigning this crew's final difficulty.`);
      continue;
    }
    const tierName = deriveTierName(difficulties);
    crewToTier.set(crew.id, tierName);

    const distribution = crew.distribution ? sortedDistribution(crew.distribution) : undefined;
    const representative = distribution?.reduce<CrewEntry | undefined>(
      (current, entry) => !current || entry.weight > current.weight ? entry : current,
      undefined,
    );
    tiers[tierName] = {
      model: representative?.model ?? crew.model,
      harness: representative?.harness ?? crew.harness,
      difficulties,
      ...(distribution ? { distribution } : {}),
    };
  }

  const by_kind: Partial<Record<VBriefItemKind, string>> = {};
  for (const [kind, crewId] of Object.entries(rest.by_kind)) {
    const tierName = crewId ? crewToTier.get(crewId) : undefined;
    if (tierName) by_kind[kind as VBriefItemKind] = tierName;
  }
  const { by_kind: _crewByKind, ...configRest } = rest;
  return { ...configRest, tiers, by_kind };
}

function modelDefinition(modelId: ModelId, catalog = MODELS_BY_PROVIDER): ModelDef | undefined {
  return Object.values(catalog).flatMap((provider) => provider.models).find((model) => model.id === modelId);
}

export function crewLabel(crew: Crew, catalog = MODELS_BY_PROVIDER): string {
  if (crew.distribution) return `${crew.distribution.length}-model mix`;
  return modelDefinition(crew.model, catalog)?.name ?? crew.model;
}

export function blendedCost(crew: Crew, catalog = MODELS_BY_PROVIDER): number | null {
  const entries = crew.distribution ?? [{ model: crew.model, harness: crew.harness, weight: 100 }];
  let weightedCost = 0;
  let knownWeight = 0;
  for (const entry of entries) {
    const cost = modelDefinition(entry.model, catalog)?.costPer1MTokens;
    if (cost == null) continue;
    weightedCost += cost * entry.weight;
    knownWeight += entry.weight;
  }
  return knownWeight === 0 ? null : weightedCost / knownWeight;
}

export function providerDefaultHarness(modelId: ModelId, settings: Pick<SettingsConfig, 'models'>): Harness {
  const provider = Object.entries(MODELS_BY_PROVIDER).find(([, definition]) =>
    definition.models.some((model) => model.id === modelId),
  )?.[0];
  const configured = provider
    ? settings.models.provider_harnesses?.[provider as keyof typeof settings.models.provider_harnesses]
    : undefined;
  if (configured) return configured;

  // Keep this fallback aligned with src/lib/providers.ts getBuiltInDefaultHarness.
  if (provider === 'anthropic') return 'claude-code';
  if (provider === 'openai') return 'codex';
  return 'ohmypi';
}

function yamlScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return /^[a-zA-Z0-9._/-]+$/.test(value) ? value : JSON.stringify(value);
  return String(value);
}

function yamlLines(value: unknown, indent: number): string[] {
  const prefix = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`];
    return value.flatMap((entry) => {
      if (entry && typeof entry === 'object') {
        const [first, ...rest] = yamlLines(entry, indent + 2);
        return [`${prefix}- ${first.trimStart()}`, ...rest];
      }
      return [`${prefix}- ${yamlScalar(entry)}`];
    });
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${prefix}{}`];
    return entries.flatMap(([key, entry]) => {
      if (entry && typeof entry === 'object') return [`${prefix}${key}:`, ...yamlLines(entry, indent + 2)];
      return [`${prefix}${key}: ${yamlScalar(entry)}`];
    });
  }
  return [`${prefix}${yamlScalar(value)}`];
}

export function renderYamlPreview(config: TieredExecutionConfig): string {
  return ['tiered_execution:', ...yamlLines(config, 2)].join('\n');
}
