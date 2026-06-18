import { basename } from 'node:path';
import { Effect, Result, Schema } from 'effect';
import type { FeatureRegistryEntry, FeatureRegistryStatus, FeatureRegistryTagInput, FeatureRegistryOwnershipUpdate, MemoryIdentity } from '@overdeck/contracts';
import { loadConfigNoMigration, type NormalizedFeatureRegistryConfig } from '../config-yaml.js';
import { extractWithProviderPolicy, type MemoryExtractionPolicyResult } from '../memory/providers/index.js';
import {
  listFeatureRegistryEntries,
  showFeatureRegistryFeature,
  tagFeatureRegistryIssue,
  updateFeatureRegistryOwnership,
} from './feature-registry-storage.js';

const ClassifiedFeaturePayload = Schema.Struct({
  featureName: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
});

const FeatureClassificationPayload = Schema.Struct({
  features: Schema.Array(ClassifiedFeaturePayload),
});

type ClassifiedFeaturePayload = typeof ClassifiedFeaturePayload.Type;
type FeatureClassificationPayload = typeof FeatureClassificationPayload.Type;

const FEATURE_CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['features'],
  properties: {
    features: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['featureName'],
        properties: {
          featureName: { type: 'string', minLength: 2, maxLength: 80 },
          description: { type: ['string', 'null'], maxLength: 240 },
          tags: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 40 } },
        },
      },
    },
  },
};

export interface IssueFeatureClassificationInput {
  issueId: string;
  title: string;
  body?: string | null;
  workspaceId?: string | null;
  agentId?: string | null;
  now?: string;
  identity?: MemoryIdentity;
  config?: NormalizedFeatureRegistryConfig['classification'];
  classify?: FeatureRegistryClassifier;
}

export type FeatureRegistryClassifier = (
  prompt: string,
  jsonSchema: unknown,
  options?: { signal?: AbortSignal },
) => Promise<MemoryExtractionPolicyResult<unknown>>;

export interface ClassifiedFeature {
  featureName: string;
  description: string | null;
  tags: string[];
}

export type IssueFeatureClassificationResult =
  | { status: 'disabled'; features: [] }
  | { status: 'classified'; features: ClassifiedFeature[] }
  | { status: 'failed'; reason: 'cost-cap' | 'extraction-failed' | 'malformed-response'; features: [] };

export interface ApplyIssueFeatureClassificationDeps {
  listEntries?: typeof listFeatureRegistryEntries;
  showFeature?: typeof showFeatureRegistryFeature;
  tagIssue?: typeof tagFeatureRegistryIssue;
}

export async function classifyIssueFeatures(input: IssueFeatureClassificationInput): Promise<IssueFeatureClassificationResult> {
  const config = input.config ?? (await Effect.runPromise(loadConfigNoMigration())).config.registry.classification;
  if (!config.enabled) return { status: 'disabled', features: [] };

  const classify = input.classify ?? ((prompt, jsonSchema, options) => extractWithProviderPolicy(prompt, jsonSchema, {
    identity: input.identity ?? buildClassificationIdentity(input.issueId),
    settings: {
      provider: config.provider,
      model: config.model,
      perDayCostCapUsd: config.perDayCostCapUsd,
      fallbackChain: [],
    },
    perDayCostCapUsd: config.perDayCostCapUsd,
    temperature: 0,
    maxTokens: 350,
    signal: options?.signal,
  }));

  const result = await classify(buildFeatureClassificationPrompt(input), FEATURE_CLASSIFICATION_JSON_SCHEMA);
  if (result.status === 'skipped') return { status: 'failed', reason: result.reason, features: [] };
  if (result.status === 'dropped') return { status: 'failed', reason: result.reason, features: [] };

  const payloadResult = Schema.decodeUnknownResult(FeatureClassificationPayload)(result.result.data);
  if (payloadResult._tag === 'Failure') return { status: 'failed', reason: 'malformed-response', features: [] };

  return {
    status: 'classified',
    features: normalizeClassifiedFeatures(Result.getOrThrow(payloadResult).features),
  };
}

export async function applyIssueFeatureClassification(
  input: IssueFeatureClassificationInput,
  deps: ApplyIssueFeatureClassificationDeps = {},
): Promise<IssueFeatureClassificationResult> {
  const classification = await classifyIssueFeatures(input);
  if (classification.status !== 'classified') return classification;

  const listEntries = deps.listEntries ?? listFeatureRegistryEntries;
  const showFeature = deps.showFeature ?? showFeatureRegistryFeature;
  const tagIssue = deps.tagIssue ?? tagFeatureRegistryIssue;
  const existingForIssue = await listEntries({ issueId: input.issueId, limit: 500 });
  const issueFeatureNames = new Set(existingForIssue.map((entry) => normalizeKey(entry.featureName)));

  for (const feature of classification.features) {
    if (issueFeatureNames.has(normalizeKey(feature.featureName))) continue;
    if (await showFeature(feature.featureName)) continue;

    await tagIssue({
      issueId: input.issueId,
      featureName: feature.featureName,
      description: feature.description ?? undefined,
      workspaceId: input.workspaceId ?? undefined,
      agentId: input.agentId ?? undefined,
      status: 'active',
      tags: feature.tags,
      now: input.now,
    });
  }

  return classification;
}

export async function recordIssueFeatureClassification(input: IssueFeatureClassificationInput): Promise<IssueFeatureClassificationResult> {
  try {
    return await applyIssueFeatureClassification(input);
  } catch {
    return { status: 'failed', reason: 'extraction-failed', features: [] };
  }
}

export interface FeatureRegistryLifecycleInput {
  issueId: string;
  workspacePath?: string | null;
  workspaceId?: string | null;
  agentId?: string | null;
  status: FeatureRegistryStatus;
  now?: string;
}

export interface FeatureRegistryLifecycleDeps {
  updateOwnership?: typeof updateFeatureRegistryOwnership;
}

export async function updateFeatureRegistryForLifecycle(
  input: FeatureRegistryLifecycleInput,
  deps: FeatureRegistryLifecycleDeps = {},
): Promise<FeatureRegistryEntry[]> {
  const update: FeatureRegistryOwnershipUpdate = {
    issueId: input.issueId,
    workspaceId: input.workspaceId ?? workspaceIdFromPath(input.workspacePath),
    agentId: input.agentId ?? undefined,
    status: input.status,
    now: input.now,
  };
  return await (deps.updateOwnership ?? updateFeatureRegistryOwnership)(update);
}

export async function recordFeatureRegistryLifecycle(input: FeatureRegistryLifecycleInput): Promise<FeatureRegistryEntry[]> {
  try {
    return await updateFeatureRegistryForLifecycle(input);
  } catch {
    return [];
  }
}

export function workspaceIdFromPath(workspacePath?: string | null): string | undefined {
  return workspacePath ? basename(workspacePath) : undefined;
}

export function buildFeatureClassificationPrompt(input: Pick<IssueFeatureClassificationInput, 'issueId' | 'title' | 'body'>): string {
  return [
    'Classify this Overdeck tracker issue into low-cardinality product feature names for a knowledge registry.',
    'Prefer stable product areas or user-visible capabilities over implementation details, branch names, or one-off bug wording.',
    'Return at most five features. Use short Title Case feature names. Include only concise tags that help grouping.',
    `Issue: ${input.issueId}`,
    `Title: ${input.title}`,
    `Body:\n${input.body?.trim() || 'none'}`,
  ].join('\n\n');
}

function normalizeClassifiedFeatures(features: readonly ClassifiedFeaturePayload[]): ClassifiedFeature[] {
  const seen = new Set<string>();
  const normalized: ClassifiedFeature[] = [];
  for (const feature of features) {
    const featureName = feature.featureName.trim().replace(/\s+/g, ' ');
    const key = normalizeKey(featureName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      featureName,
      description: normalizeDescription(feature.description),
      tags: normalizeTags(feature.tags),
    });
  }
  return normalized;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of tags ?? []) {
    const tag = value.trim().replace(/\s+/g, '-').toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildClassificationIdentity(issueId: string): MemoryIdentity {
  return {
    projectId: 'panopticon-cli',
    workspaceId: 'feature-registry',
    issueId,
    runId: 'feature-registry-classifier',
    sessionId: 'feature-registry-classifier',
    agentRole: 'plan',
    agentHarness: 'panopticon',
  };
}
