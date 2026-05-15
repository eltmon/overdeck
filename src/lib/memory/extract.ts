import { randomUUID } from 'crypto';
import { Result, Schema } from 'effect';
import {
  MemoryObservation,
  type MemoryIdentity,
} from '@panctl/contracts';
import {
  extractWithProviderPolicy,
  type MemoryExtractionPolicyResult,
  type MemoryProviderSettings,
} from './providers/index.js';

export const MEMORY_DOMAIN_TAGS = [
  'review-blocker',
  'test-failure',
  'merge-risk',
  'user-preference',
  'architecture-decision',
  'worktree-state',
  'handoff',
  'regression',
] as const;

const ExtractedObservationPayload = Schema.Struct({
  narrative: Schema.String,
  summary: Schema.String,
  actionStatus: Schema.NullOr(Schema.String),
  tags: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
});

type ExtractedObservationPayload = typeof ExtractedObservationPayload.Type;

export interface ExtractObservationInput {
  compressedText: string;
  identity: MemoryIdentity;
  gitBranch: string;
  sourceTranscriptOffset: number;
  previousObservations?: MemoryObservation[];
  settings?: MemoryProviderSettings | null;
  perDayCostCapUsd?: number;
  now?: Date;
  id?: string;
  extract?: ExtractObservationCall;
}

export type ExtractObservationCall = (
  prompt: string,
  jsonSchema: unknown,
) => Promise<MemoryExtractionPolicyResult<unknown>>;

export type ExtractObservationResult =
  | { status: 'extracted'; observation: MemoryObservation }
  | { status: 'skipped'; reason: 'cost-cap' }
  | { status: 'dropped'; reason: 'extraction-failed' | 'malformed-response' };

const OBSERVATION_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative', 'summary', 'actionStatus', 'tags', 'files'],
  properties: {
    narrative: { type: 'string' },
    summary: { type: 'string' },
    actionStatus: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
  },
};

export async function extractObservationFromTurn(input: ExtractObservationInput): Promise<ExtractObservationResult> {
  const prompt = buildObservationPrompt(input);
  const extract = input.extract ?? ((candidatePrompt, jsonSchema) => extractWithProviderPolicy(candidatePrompt, jsonSchema, {
    identity: input.identity,
    settings: input.settings,
    perDayCostCapUsd: input.perDayCostCapUsd,
  }));

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await extract(prompt, OBSERVATION_RESPONSE_JSON_SCHEMA);
    if (result.status === 'skipped') return { status: 'skipped', reason: result.reason };
    if (result.status === 'dropped') return { status: 'dropped', reason: result.reason };

    const payloadResult = Schema.decodeUnknownResult(ExtractedObservationPayload)(result.result.data);
    if (payloadResult._tag === 'Failure') continue;

    const observation = buildObservation(input, Result.getOrThrow(payloadResult), result.result);
    const observationResult = Schema.decodeUnknownResult(MemoryObservation)(observation);
    if (observationResult._tag === 'Success') {
      return { status: 'extracted', observation: Result.getOrThrow(observationResult) };
    }
  }

  return { status: 'dropped', reason: 'malformed-response' };
}

export function buildObservationPrompt(input: ExtractObservationInput): string {
  const previous = (input.previousObservations ?? [])
    .slice(-3)
    .map((observation, index) => [
      `Previous ${index + 1}:`,
      `- Status: ${observation.actionStatus ?? 'none'}`,
      `- Summary: ${observation.summary}`,
      `- Files: ${observation.files.join(', ') || 'none'}`,
      `- Tags: ${observation.tags.join(', ') || 'none'}`,
    ].join('\n'))
    .join('\n\n');

  return [
    'Extract one durable Panopticon activity observation from this compressed agent turn.',
    'Lead with outcomes: say what changed, what decision was made, or what blocker appeared.',
    'If the turn is pure discussion or contains no concrete work/status change, set actionStatus to null.',
    `Prefer these domain tags when applicable: ${MEMORY_DOMAIN_TAGS.join(', ')}.`,
    `Agent role: ${input.identity.agentRole}`,
    `Harness: ${input.identity.agentHarness}`,
    `Git branch: ${input.gitBranch}`,
    previous ? `Last 3 observations for continuity and deduplication:\n${previous}` : 'Last 3 observations: none',
    `Compressed turn:\n${input.compressedText}`,
  ].join('\n\n');
}

function buildObservation(
  input: ExtractObservationInput,
  payload: ExtractedObservationPayload,
  result: ExtractedResultMetadata,
): MemoryObservation {
  return {
    id: input.id ?? randomUUID(),
    timestamp: (input.now ?? new Date()).toISOString(),
    ...input.identity,
    gitBranch: input.gitBranch,
    sourceTranscriptOffset: input.sourceTranscriptOffset,
    actionStatus: payload.actionStatus,
    narrative: payload.narrative,
    summary: payload.summary,
    files: payload.files,
    tags: payload.tags,
    tokens: {
      prompt: result.usage.input,
      completion: result.usage.output,
      total: result.usage.input + result.usage.output + (result.usage.cacheRead ?? 0) + (result.usage.cacheWrite ?? 0),
    },
    model: result.model,
  };
}

interface ExtractedResultMetadata {
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  model: string;
}
