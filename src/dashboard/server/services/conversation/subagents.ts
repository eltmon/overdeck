/**
 * Read-only discovery and streaming support for Claude Code conversation subagents.
 * See docs/CONVERSATION-SUBAGENTS.md for the file layout and transport contract.
 */
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ConversationEvent, SubagentHumanInput, SubagentSummary } from '@overdeck/contracts';
import { readSidechainHumanInputs } from '../../../../lib/transcript-landing.js';

export type SubagentMeta = Omit<SubagentSummary, 'status'>;

/**
 * A background subagent whose completion notification never arrives (its parent
 * crashed mid-run) reads as done once its transcript has been idle this long.
 */
export const BACKGROUND_SUBAGENT_IDLE_MS = 30 * 60_000;

/**
 * A subagent's last write lands within 0.1 s of its notification. A write later
 * than this after the latest notification means it was resumed and is running.
 */
const RESUME_WRITE_SLACK_MS = 5_000;

const TASK_NOTIFICATION_OPEN = '<task-notification>';
/** A resumed agent's later notifications carry only `<task-id>` (its agentId). */
const TASK_NOTIFICATION_IDS = /<(?:tool-use-id|task-id)>([^<]*)<\/(?:tool-use-id|task-id)>/g;
const SCAN_CHUNK_BYTES = 1024 * 1024;

/** Latest notification time (ms) per tool-use id and per task id (agentId). */
export type TaskNotifications = ReadonlyMap<string, number>;

const metaCache = new Map<string, DiscoveredSubagent>();
const SAFE_AGENT_ID = /^[A-Za-z0-9_-]+$/;

export function subagentsDirFor(sessionFile: string): string {
  const sessionDir = sessionFile.endsWith('.jsonl')
    ? sessionFile.slice(0, -'.jsonl'.length)
    : sessionFile;
  return join(sessionDir, 'subagents');
}

/** Metadata plus the launch shape, which decides how status is derived. */
interface DiscoveredSubagent extends SubagentMeta {
  background: boolean;
}

function parseMeta(agentId: string, value: unknown): DiscoveredSubagent {
  if (
    typeof value !== 'object'
    || value === null
    || !('agentType' in value)
    || typeof value.agentType !== 'string'
    || !('description' in value)
    || typeof value.description !== 'string'
    || !('toolUseId' in value)
    || typeof value.toolUseId !== 'string'
    || !('spawnDepth' in value)
    || typeof value.spawnDepth !== 'number'
  ) {
    throw new Error('invalid subagent metadata');
  }

  return {
    agentId,
    agentType: value.agentType,
    description: value.description,
    toolUseId: value.toolUseId,
    spawnDepth: value.spawnDepth,
    background: 'requestShape' in value && value.requestShape === 'background',
  };
}

async function readMeta(metaPath: string, agentId: string): Promise<DiscoveredSubagent | null> {
  const cached = metaCache.get(metaPath);
  if (cached !== undefined) return cached;

  try {
    const parsed = parseMeta(agentId, JSON.parse(await readFile(metaPath, 'utf8')));
    metaCache.set(metaPath, parsed);
    return parsed;
  } catch (error) {
    console.warn(`[conversation-subagents] Failed to parse ${metaPath}:`, error);
    return null;
  }
}

export async function listSubagentMetas(sessionFile: string): Promise<SubagentMeta[]> {
  return (await discoverSubagents(sessionFile)).map(({ background: _background, ...meta }) => meta);
}

async function discoverSubagents(sessionFile: string): Promise<DiscoveredSubagent[]> {
  const subagentsDir = subagentsDirFor(sessionFile);
  let entries: string[];

  try {
    entries = await readdir(subagentsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const metas: DiscoveredSubagent[] = [];
  for (const entry of entries.sort()) {
    const match = /^agent-(.+)\.meta\.json$/.exec(entry);
    if (!match?.[1]) continue;

    const meta = await readMeta(join(subagentsDir, entry), match[1]);
    if (meta) metas.push(meta);
  }
  return metas;
}

export function subagentTranscriptPath(sessionFile: string, agentId: string): string | null {
  if (!SAFE_AGENT_ID.test(agentId)) return null;

  const subagentsDir = resolve(subagentsDirFor(sessionFile));
  const transcriptPath = resolve(subagentsDir, `agent-${agentId}.jsonl`);
  if (dirname(transcriptPath) !== subagentsDir || !transcriptPath.startsWith(`${subagentsDir}${sep}`)) {
    return null;
  }
  return transcriptPath;
}

/** Ids and time of a task-notification record, or null for any other line. */
function parseTaskNotification(line: string): { ids: string[]; at: number } | null {
  if (!line.includes(TASK_NOTIFICATION_OPEN)) return null;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof record !== 'object' || record === null || !('type' in record)) return null;
  // Claude Code writes the notification twice: a queue `enqueue` the moment the
  // subagent stops, and a `user` record when the parent takes it as a turn.
  let text: unknown;
  if (record.type === 'queue-operation' && 'operation' in record && record.operation === 'enqueue') {
    text = 'content' in record ? record.content : undefined;
  } else if (
    record.type === 'user'
    && 'origin' in record && typeof record.origin === 'object' && record.origin !== null
    && 'kind' in record.origin && record.origin.kind === 'task-notification'
    && 'message' in record && typeof record.message === 'object' && record.message !== null
  ) {
    text = 'content' in record.message ? record.message.content : undefined;
  }
  if (typeof text !== 'string' || !text.trimStart().startsWith(TASK_NOTIFICATION_OPEN)) return null;
  const at = 'timestamp' in record && typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN;
  if (Number.isNaN(at)) return null;
  const ids = [...text.matchAll(TASK_NOTIFICATION_IDS)].map((match) => match[1]).filter((id): id is string => !!id);
  return ids.length > 0 ? { ids, at } : null;
}

/**
 * Collects when background subagents last stopped, reading only the parent
 * transcript bytes appended since the previous call.
 */
export function createTaskNotificationScanner(
  sessionFile: string,
  chunkBytes: number = SCAN_CHUNK_BYTES,
): () => Promise<TaskNotifications> {
  const notified = new Map<string, number>();
  let offset = 0;
  let remainder = '';
  let decoder = new StringDecoder('utf8');

  return async () => {
    let handle;
    try {
      handle = await open(sessionFile, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return notified;
      throw error;
    }
    try {
      const { size } = await handle.stat();
      if (size < offset) {
        // Rewritten transcript: rescan it from the start.
        offset = 0;
        remainder = '';
        decoder = new StringDecoder('utf8');
        notified.clear();
      }
      const buffer = Buffer.alloc(Math.min(chunkBytes, Math.max(size - offset, 0)));
      while (offset < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const lines = (remainder + decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        remainder = lines.pop() ?? '';
        for (const line of lines) {
          const notification = parseTaskNotification(line);
          for (const id of notification?.ids ?? []) {
            notified.set(id, Math.max(notified.get(id) ?? 0, notification!.at));
          }
        }
      }
    } finally {
      await handle.close();
    }
    return notified;
  };
}

/** Sidechain text is truncated to bound payload size (autoDecision, PAN-4247). */
const HUMAN_INPUT_TEXT_MAX_CHARS = 2_000;
/** Only the most recent inputs are worth surfacing; older ones are dropped. */
const HUMAN_INPUT_MAX_COUNT = 20;

/**
 * Reads human-origin sidechain records from each subagent's own transcript,
 * mirroring {@link createTaskNotificationScanner}: a module-level cache keyed
 * by transcript file path holds the byte offset already scanned and the
 * accumulated inputs, so repeat calls for the same subagent read only newly
 * appended bytes.
 */
export function createSubagentHumanInputScanner(): (sessionFile: string, agentId: string) => Promise<SubagentHumanInput[]> {
  const cache = new Map<string, { offset: number; inputs: SubagentHumanInput[] }>();

  return async (sessionFile: string, agentId: string): Promise<SubagentHumanInput[]> => {
    const transcriptPath = subagentTranscriptPath(sessionFile, agentId);
    if (!transcriptPath) return [];

    let cached = cache.get(transcriptPath);
    let fromByteOffset = cached?.offset ?? 0;
    try {
      const { size } = await stat(transcriptPath);
      if (size < fromByteOffset) {
        // Rewritten transcript: rescan it from the start.
        fromByteOffset = 0;
        cached = undefined;
      }
    } catch {
      // Not written yet; readSidechainHumanInputs below handles the missing file.
    }

    const { inputs: newInputs, readOffset } = await readSidechainHumanInputs(transcriptPath, fromByteOffset);
    const truncated = newInputs.map((input) => ({ ...input, text: input.text.slice(0, HUMAN_INPUT_TEXT_MAX_CHARS) }));
    const inputs = [...(cached?.inputs ?? []), ...truncated].slice(-HUMAN_INPUT_MAX_COUNT);
    cache.set(transcriptPath, { offset: readOffset, inputs });
    return inputs;
  };
}

/** One scanner instance shared by every caller in this process, so a live WS
 * subscription and a one-shot read of the same conversation reuse the same
 * cached byte offsets instead of rescanning each subagent transcript from
 * the start (PAN-4247). */
const sharedHumanInputScanner = createSubagentHumanInputScanner();

async function lastWriteMs(sessionFile: string, agentId: string): Promise<number> {
  const subagentsDir = subagentsDirFor(sessionFile);
  let latest = 0;
  for (const file of [`agent-${agentId}.jsonl`, `agent-${agentId}.meta.json`]) {
    try {
      latest = Math.max(latest, (await stat(join(subagentsDir, file))).mtimeMs);
    } catch {
      // Not written yet.
    }
  }
  return latest;
}

/**
 * A foreground subagent runs while its `Agent` tool call has no result. A
 * background launch gets its result at once, so it runs until its
 * task-notification arrives, and again when it writes after that notification
 * (a `SendMessage` resume). Without a later notification it reads as done once
 * its transcript is idle past `BACKGROUND_SUBAGENT_IDLE_MS`.
 */
export async function listSubagentSummaries(
  sessionFile: string,
  pendingToolUseIds: ReadonlySet<string>,
  notifications: TaskNotifications,
  now: number = Date.now(),
  scanHumanInputs: (sessionFile: string, agentId: string) => Promise<SubagentHumanInput[]> = sharedHumanInputScanner,
): Promise<SubagentSummary[]> {
  const subagents: SubagentSummary[] = [];
  for (const { background, ...meta } of await discoverSubagents(sessionFile)) {
    let running: boolean;
    if (!background) {
      running = pendingToolUseIds.has(meta.toolUseId);
    } else {
      const notifiedAt = Math.max(notifications.get(meta.toolUseId) ?? 0, notifications.get(meta.agentId) ?? 0);
      const lastWrite = await lastWriteMs(sessionFile, meta.agentId);
      running = (notifiedAt === 0 || lastWrite > notifiedAt + RESUME_WRITE_SLACK_MS)
        && now - lastWrite < BACKGROUND_SUBAGENT_IDLE_MS;
    }
    const humanInputs = await scanHumanInputs(sessionFile, meta.agentId);
    subagents.push({
      ...meta,
      status: running ? 'running' : 'done',
      background,
      ...(humanInputs.length > 0 ? { humanInputs } : {}),
    });
  }
  return subagents;
}

export interface SubagentListPoller {
  refresh: () => Promise<void>;
  stop: () => void;
}

export async function startSubagentListPolling(
  sessionFile: string,
  pendingToolUseIds: () => ReadonlySet<string>,
  emit: (event: ConversationEvent) => void,
  list?: () => Promise<SubagentSummary[]>,
): Promise<SubagentListPoller> {
  let stopped = false;
  let lastSerialized: string | null = null;
  let refreshChain = Promise.resolve();
  const scanTaskNotifications = createTaskNotificationScanner(sessionFile);

  const refresh = (): Promise<void> => {
    refreshChain = refreshChain.then(async () => {
      if (stopped) return;
      const subagents = list
        ? await list()
        : await listSubagentSummaries(sessionFile, pendingToolUseIds(), await scanTaskNotifications());
      if (stopped) return;
      const serialized = JSON.stringify(subagents);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      emit({ kind: 'subagents', subagents });
    }).catch((error) => {
      console.warn(`[conversation-subagents] Failed to refresh ${sessionFile}:`, error);
    });
    return refreshChain;
  };

  await refresh();
  const interval = setInterval(() => void refresh(), 2_000);
  return {
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}
