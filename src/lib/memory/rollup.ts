import { randomUUID } from 'crypto';
import { readdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Result, Schema } from 'effect';
import {
  MemoryStatus,
  type MemoryIdentity,
  type MemoryObservation,
  type PendingTurn,
} from '@panctl/contracts';
import {
  extractWithProviderPolicy,
  type MemoryExtractionPolicyResult,
  type MemoryProviderSettings,
} from './providers/index.js';
import { pendingTurnFileName } from './pending.js';
import { ensureDir, ensureParentDir, resolveArchiveDir, resolveObservationsFile, resolvePendingDir, resolveStatusFile } from './paths.js';

const STATUS_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'headline',
    'summary',
    'goal',
    'phase',
    'accomplished',
    'decided',
    'open',
    'nextSteps',
    'confidence',
    'workingSet',
    'tags',
  ],
  properties: {
    name: { type: 'string' },
    headline: { type: 'string' },
    summary: { type: 'string' },
    goal: { type: ['string', 'null'] },
    phase: { type: 'string', enum: ['exploring', 'planning', 'building', 'verifying', 'cleaning', 'shipping'] },
    accomplished: { type: 'array', items: { type: 'string' } },
    decided: { type: 'array', items: { type: 'string' } },
    open: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    workingSet: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

export interface SynthesizeStatusRollupInput {
  projectId: string;
  issueId: string;
  pendingTurns: PendingTurn[];
  identity?: MemoryIdentity;
  observations?: MemoryObservation[];
  archivedStatuses?: MemoryStatus[];
  settings?: MemoryProviderSettings | null;
  perDayCostCapUsd?: number;
  extract?: StatusRollupExtractCall;
}

export type StatusRollupExtractCall = (
  prompt: string,
  jsonSchema: unknown,
) => Promise<MemoryExtractionPolicyResult<unknown>>;

export type SynthesizeStatusRollupResult =
  | { status: 'synthesized'; memoryStatus: MemoryStatus }
  | { status: 'skipped'; reason: 'cost-cap' }
  | { status: 'dropped'; reason: 'extraction-failed' | 'malformed-response' | 'missing-identity' };

export interface CommitStatusRollupInput {
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  status: MemoryStatus;
  pendingTurns: PendingTurn[];
  now?: Date;
  emitStatusUpdated?: EmitStatusUpdated;
  failAfterArchive?: boolean;
  failAfterStatusWrite?: boolean;
}

export interface CommitStatusRollupResult {
  previousStatus?: MemoryStatus;
  archivedPath?: string;
  statusPath: string;
  clearedPending: string[];
}

export type EmitStatusUpdated = (event: {
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  status: MemoryStatus;
  previousStatus?: MemoryStatus;
}) => void | Promise<void>;

export async function synthesizeStatusRollup(input: SynthesizeStatusRollupInput): Promise<SynthesizeStatusRollupResult> {
  const identity = input.identity ?? input.pendingTurns[0]?.identity;
  if (!identity) return { status: 'dropped', reason: 'missing-identity' };

  const observations = input.observations ?? await readRecentObservations(input.projectId, input.issueId, 20);
  const archivedStatuses = input.archivedStatuses ?? await readArchivedStatuses(input.projectId, input.issueId, 3);
  const prompt = buildStatusRollupPrompt({
    pendingTurns: input.pendingTurns,
    observations,
    archivedStatuses,
  });
  const extract = input.extract ?? ((candidatePrompt, jsonSchema) => extractWithProviderPolicy(candidatePrompt, jsonSchema, {
    identity,
    settings: input.settings,
    perDayCostCapUsd: input.perDayCostCapUsd,
  }));

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await extract(prompt, STATUS_RESPONSE_JSON_SCHEMA);
    if (result.status === 'skipped') return { status: 'skipped', reason: result.reason };
    if (result.status === 'dropped') return { status: 'dropped', reason: result.reason };

    const statusResult = Schema.decodeUnknownResult(MemoryStatus)(result.result.data);
    if (statusResult._tag === 'Success') {
      return { status: 'synthesized', memoryStatus: Result.getOrThrow(statusResult) };
    }
  }

  return { status: 'dropped', reason: 'malformed-response' };
}

export async function commitStatusRollup(input: CommitStatusRollupInput): Promise<CommitStatusRollupResult> {
  const { projectId, workspaceId, issueId } = input.identity;
  const statusPath = resolveStatusFile(projectId, issueId);
  const previousStatus = await readCurrentStatus(projectId, issueId);
  let archivedPath: string | undefined;

  if (previousStatus) {
    archivedPath = await archiveStatus(projectId, issueId, previousStatus, input.now ?? new Date());
    await pruneArchivedStatuses(projectId, issueId, 3);
  }

  if (input.failAfterArchive) throw new Error('Injected rollup archive failure');

  await writeJsonAtomically(statusPath, input.status);

  if (input.failAfterStatusWrite) throw new Error('Injected rollup status write failure');

  await (input.emitStatusUpdated ?? emitStatusUpdatedEvent)({
    identity: { projectId, workspaceId, issueId },
    status: input.status,
    previousStatus,
  });

  const clearedPending = await clearPendingTurns(projectId, issueId, input.pendingTurns);
  return { previousStatus, archivedPath, statusPath, clearedPending };
}

export async function readCurrentStatus(projectId: string, issueId: string): Promise<MemoryStatus | undefined> {
  try {
    return JSON.parse(await readFile(resolveStatusFile(projectId, issueId), 'utf8')) as MemoryStatus;
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

export function buildStatusRollupPrompt(input: {
  pendingTurns: PendingTurn[];
  observations: MemoryObservation[];
  archivedStatuses: MemoryStatus[];
}): string {
  return [
    'Synthesize the current Panopticon workspace memory status from recent evidence.',
    'Return the full status object. This status is a fresh replacement, not a cumulative append-only summary.',
    'You may add, update, delete, or leave fields unchanged relative to previous statuses based only on current evidence.',
    'Refresh workingSet every cycle from files currently relevant in the evidence; do not carry forward stale files.',
    'phase must be exactly one of: exploring, planning, building, verifying, cleaning, shipping.',
    `Last 3 archived statuses:\n${renderArchivedStatuses(input.archivedStatuses)}`,
    `Last 20 observations:\n${renderObservations(input.observations)}`,
    `New pending turns:\n${renderPendingTurns(input.pendingTurns)}`,
  ].join('\n\n');
}

export async function readRecentObservations(projectId: string, issueId: string, limit = 20): Promise<MemoryObservation[]> {
  const observationsDir = dirname(resolveObservationsFile(projectId, issueId, new Date()));
  const files = (await readdir(observationsDir).catch((error: unknown) => {
    if (isEnoent(error)) return [] as string[];
    throw error;
  }))
    .filter((file) => file.endsWith('.jsonl'))
    .sort()
    .reverse();

  const observations: MemoryObservation[] = [];
  for (const file of files) {
    const raw = await readFile(`${observationsDir}/${file}`, 'utf8');
    const lines = raw.trimEnd().split('\n');
    for (let index = lines.length - 1; index >= 0 && observations.length < limit; index -= 1) {
      const line = lines[index];
      if (!line || line.trim().length === 0) continue;
      observations.push(JSON.parse(line) as MemoryObservation);
    }
    if (observations.length >= limit) break;
  }

  return observations
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function readArchivedStatuses(projectId: string, issueId: string, limit = 3): Promise<MemoryStatus[]> {
  const archiveDir = resolveArchiveDir(projectId, issueId);
  const files = (await readdir(archiveDir).catch((error: unknown) => {
    if (isEnoent(error)) return [] as string[];
    throw error;
  }))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .slice(-limit);

  const statuses: MemoryStatus[] = [];
  for (const file of files) {
    statuses.push(JSON.parse(await readFile(`${archiveDir}/${file}`, 'utf8')) as MemoryStatus);
  }
  return statuses;
}

async function archiveStatus(projectId: string, issueId: string, status: MemoryStatus, now: Date): Promise<string> {
  const archiveDir = resolveArchiveDir(projectId, issueId);
  await ensureDir(archiveDir);
  const path = `${archiveDir}/${now.toISOString().replace(/[:.]/g, '-')}_${slugify(status.name)}_${randomUUID()}.json`;
  await writeJsonAtomically(path, status);
  return path;
}

async function pruneArchivedStatuses(projectId: string, issueId: string, keep: number): Promise<void> {
  const archiveDir = resolveArchiveDir(projectId, issueId);
  const files = (await readdir(archiveDir).catch((error: unknown) => {
    if (isEnoent(error)) return [] as string[];
    throw error;
  }))
    .filter((file) => file.endsWith('.json'))
    .sort();

  await Promise.all(files.slice(0, Math.max(0, files.length - keep)).map((file) => unlink(`${archiveDir}/${file}`)));
}

async function clearPendingTurns(projectId: string, issueId: string, pendingTurns: PendingTurn[]): Promise<string[]> {
  const pendingDir = resolvePendingDir(projectId, issueId);
  const cleared: string[] = [];
  for (const turn of pendingTurns) {
    const path = `${pendingDir}/${pendingTurnFileName(turn)}`;
    try {
      await unlink(path);
      cleared.push(path);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }
  return cleared;
}

async function emitStatusUpdatedEvent(event: {
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  status: MemoryStatus;
  previousStatus?: MemoryStatus;
}): Promise<void> {
  const { initEventStore } = await import('../../dashboard/server/event-store.js');
  const store = await initEventStore();
  await store.appendAsync({
    type: 'memory.status_updated',
    timestamp: new Date().toISOString(),
    payload: event,
  });
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await ensureParentDir(path);
  const tempPath = `${dirname(path)}/.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : 'status';
}

function renderArchivedStatuses(statuses: MemoryStatus[]): string {
  if (statuses.length === 0) return 'none';
  return statuses.map((status, index) => [
    `Archived status ${index + 1}:`,
    `- Name: ${status.name}`,
    `- Headline: ${status.headline}`,
    `- Summary: ${status.summary}`,
    `- Goal: ${status.goal ?? 'none'}`,
    `- Phase: ${status.phase}`,
    `- Accomplished: ${status.accomplished.join('; ') || 'none'}`,
    `- Decided: ${status.decided.join('; ') || 'none'}`,
    `- Open: ${status.open.join('; ') || 'none'}`,
    `- Next steps: ${status.nextSteps.join('; ') || 'none'}`,
    `- Working set: ${status.workingSet.join(', ') || 'none'}`,
    `- Tags: ${status.tags.join(', ') || 'none'}`,
  ].join('\n')).join('\n\n');
}

function renderObservations(observations: MemoryObservation[]): string {
  if (observations.length === 0) return 'none';
  return observations.map((observation, index) => [
    `Observation ${index + 1}:`,
    `- Timestamp: ${observation.timestamp}`,
    `- Action status: ${observation.actionStatus ?? 'none'}`,
    `- Summary: ${observation.summary}`,
    `- Narrative: ${observation.narrative}`,
    `- Files: ${observation.files.join(', ') || 'none'}`,
    `- Tags: ${observation.tags.join(', ') || 'none'}`,
  ].join('\n')).join('\n\n');
}

const PENDING_TURN_PROMPT_BUDGET_CHARS = 12_000;
const PENDING_TURN_TEXT_BUDGET_CHARS = 2_000;

function renderPendingTurns(pendingTurns: PendingTurn[]): string {
  if (pendingTurns.length === 0) return 'none';

  const rendered: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const [index, turn] of pendingTurns.entries()) {
    const compressedText = truncateText(turn.compressedText, PENDING_TURN_TEXT_BUDGET_CHARS);
    const block = [
      `Pending turn ${index + 1}:`,
      `- Created: ${turn.createdAt}`,
      `- Session: ${turn.identity.sessionId}`,
      `- Trigger: ${turn.trigger}`,
      `- Offset: ${turn.fromOffset}-${turn.toOffset}`,
      `- Events consumed: ${turn.eventsConsumed}`,
      `- Compressed text:\n${compressedText}`,
    ].join('\n');
    if (used + block.length > PENDING_TURN_PROMPT_BUDGET_CHARS) {
      omitted = pendingTurns.length - index;
      break;
    }
    rendered.push(block);
    used += block.length;
  }

  if (omitted > 0) rendered.push(`Omitted ${omitted} pending turn(s) after the ${PENDING_TURN_PROMPT_BUDGET_CHARS} character budget.`);
  return rendered.join('\n\n');
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
