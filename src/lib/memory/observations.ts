import { randomUUID } from 'crypto';
import { open, readFile, rename, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { MemoryObservation } from '@panctl/contracts';
import { ensureParentDir, resolveObservationsFile } from './paths.js';
import { runMemoryFtsTransaction } from './fts-db.js';
import { updateMemoryHealth } from './health.js';

const appendLocks = new Map<string, Promise<void>>();

export interface WriteObservationResult {
  jsonlPath: string;
  markdownPath: string;
}

export interface WriteObservationOptions {
  indexObservation?: (observation: MemoryObservation, jsonlPath: string, byteOffset: number) => Promise<void>;
  updateHealth?: typeof updateMemoryHealth;
}

export async function writeObservation(observation: MemoryObservation, options: WriteObservationOptions = {}): Promise<WriteObservationResult> {
  const jsonlPath = resolveObservationsFile(observation.projectId, observation.issueId, observation.timestamp);
  const markdownPath = observationMarkdownPath(observation);

  await ensureParentDir(jsonlPath);
  await withAppendLock(jsonlPath, async () => {
    const existingOffset = await findObservationByteOffset(jsonlPath, observation.id);
    const byteOffset = existingOffset ?? await appendJsonl(jsonlPath, observation);
    try {
      await (options.indexObservation ?? indexObservation)(observation, jsonlPath, byteOffset);
    } catch {
      await (options.updateHealth ?? updateMemoryHealth)(observation, {
        status: 'degraded',
        reason: 'fts-index-failed',
        success: false,
      });
    }
  });
  await upsertObservationMarkdown(markdownPath, observation);

  return { jsonlPath, markdownPath };
}

export function observationMarkdownPath(observation: Pick<MemoryObservation, 'projectId' | 'issueId' | 'timestamp'>): string {
  return resolveObservationsFile(observation.projectId, observation.issueId, observation.timestamp).replace(/\.jsonl$/, '.md');
}

export function renderObservationMarkdownLine(observation: MemoryObservation): string {
  const time = observation.timestamp.slice(11, 16);
  const status = observation.actionStatus ?? observation.summary;
  const files = observation.files.length > 0 ? ` — files: ${observation.files.map(inline).join(', ')}` : '';
  const tags = observation.tags.length > 0 ? ` — tags: ${observation.tags.map(inline).join(', ')}` : '';
  return `- <!-- obs:${observation.id} --> **${time}** ${inline(status)}${files}${tags}`;
}

async function findObservationByteOffset(jsonlPath: string, observationId: string): Promise<number | null> {
  const raw = await readOptional(jsonlPath);
  let byteOffset = 0;
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) {
      byteOffset += Buffer.byteLength(`${line}\n`);
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { id?: unknown };
      if (parsed.id === observationId) return byteOffset;
    } catch {
      // Malformed historical lines must not block retry idempotency.
    }
    byteOffset += Buffer.byteLength(`${line}\n`);
  }
  return null;
}

async function appendJsonl(jsonlPath: string, observation: MemoryObservation): Promise<number> {
  const handle = await open(jsonlPath, 'a');
  try {
    const { size } = await handle.stat();
    await handle.write(`${JSON.stringify(observation)}\n`, undefined, 'utf8');
    return size;
  } finally {
    await handle.close();
  }
}

async function withAppendLock<T>(jsonlPath: string, task: () => Promise<T>): Promise<T> {
  const previous = appendLocks.get(jsonlPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const chained = previous.then(() => current, () => current);
  appendLocks.set(jsonlPath, chained);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (appendLocks.get(jsonlPath) === chained) appendLocks.delete(jsonlPath);
  }
}

async function indexObservation(observation: MemoryObservation, jsonlPath: string, byteOffset: number): Promise<void> {
  const content = [observation.narrative, observation.summary].filter(Boolean).join('\n\n');
  await runMemoryFtsTransaction(observation.projectId, [
    {
      method: 'run',
      sql: `
        DELETE FROM memory_fts
        WHERE source = ?
          AND project_id = ?
      `,
      params: [observation.id, observation.projectId],
    },
    {
      method: 'run',
      sql: `
        INSERT INTO memory_fts (
          content,
          display_content,
          source,
          branch,
          entry_date,
          entry_time,
          entry_type,
          files,
          tags,
          doc_type,
          scope,
          project_id,
          workspace_id,
          issue_id,
          run_id,
          session_id,
          agent_role,
          agent_harness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        content,
        observation.summary,
        observation.id,
        observation.gitBranch,
        observation.timestamp.slice(0, 10),
        observation.timestamp.slice(11),
        'memory',
        observation.files.join(','),
        observation.tags.join(','),
        'observation',
        'workspace',
        observation.projectId,
        observation.workspaceId,
        observation.issueId,
        observation.runId,
        observation.sessionId,
        observation.agentRole,
        observation.agentHarness,
      ],
    },
    {
      method: 'run',
      sql: `
        INSERT OR REPLACE INTO observation_index (id, observation_path_jsonl, byte_offset)
        VALUES (?, ?, ?)
      `,
      params: [observation.id, jsonlPath, byteOffset],
    },
  ]);
}

async function upsertObservationMarkdown(markdownPath: string, observation: MemoryObservation): Promise<void> {
  await ensureParentDir(markdownPath);
  const marker = `<!-- obs:${observation.id} -->`;
  const nextLine = renderObservationMarkdownLine(observation);
  const current = await readOptional(markdownPath);
  const lines = current.length > 0 ? current.trimEnd().split('\n') : [];
  const index = lines.findIndex((line) => line.includes(marker));
  if (index === -1) lines.push(nextLine);
  else lines[index] = nextLine;

  const tempPath = `${dirname(markdownPath)}/.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${lines.join('\n')}\n`, 'utf8');
  await rename(tempPath, markdownPath);
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'ENOENT') return '';
    throw error;
  }
}

function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
