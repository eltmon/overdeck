/**
 * Read-only discovery and streaming support for Claude Code conversation subagents.
 * See docs/CONVERSATION-SUBAGENTS.md for the file layout and transport contract.
 */
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ConversationEvent, SubagentSummary } from '@overdeck/contracts';

export type SubagentMeta = Omit<SubagentSummary, 'status'>;

/**
 * A background subagent whose completion notification never arrives (its parent
 * crashed mid-run) reads as done once its transcript has been idle this long.
 */
export const BACKGROUND_SUBAGENT_IDLE_MS = 30 * 60_000;

const TASK_NOTIFICATION_OPEN = '<task-notification>';
const TASK_NOTIFICATION_TOOL_USE_ID = /<tool-use-id>([^<]*)<\/tool-use-id>/;
const SCAN_CHUNK_BYTES = 1024 * 1024;

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

/** Tool-use id named by a task-notification record, or null for any other line. */
function taskNotificationToolUseId(line: string): string | null {
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
  } else if (record.type === 'user' && 'message' in record && typeof record.message === 'object' && record.message !== null) {
    text = 'content' in record.message ? record.message.content : undefined;
  }
  if (typeof text !== 'string' || !text.trimStart().startsWith(TASK_NOTIFICATION_OPEN)) return null;
  return TASK_NOTIFICATION_TOOL_USE_ID.exec(text)?.[1] ?? null;
}

/**
 * Collects the tool-use ids of background subagents that have stopped, reading
 * only the parent transcript bytes appended since the previous call.
 */
export function createTaskNotificationScanner(sessionFile: string): () => Promise<ReadonlySet<string>> {
  const notified = new Set<string>();
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
      const buffer = Buffer.alloc(Math.min(SCAN_CHUNK_BYTES, Math.max(size - offset, 0)));
      while (offset < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const lines = (remainder + decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        remainder = lines.pop() ?? '';
        for (const line of lines) {
          const toolUseId = taskNotificationToolUseId(line);
          if (toolUseId) notified.add(toolUseId);
        }
      }
    } finally {
      await handle.close();
    }
    return notified;
  };
}

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
 * task-notification arrives, or until its transcript goes idle past
 * `BACKGROUND_SUBAGENT_IDLE_MS` when that notification never comes.
 */
export async function listSubagentSummaries(
  sessionFile: string,
  pendingToolUseIds: ReadonlySet<string>,
  notifiedToolUseIds: ReadonlySet<string>,
  now: number = Date.now(),
): Promise<SubagentSummary[]> {
  const subagents: SubagentSummary[] = [];
  for (const { background, ...meta } of await discoverSubagents(sessionFile)) {
    let running: boolean;
    if (!background) running = pendingToolUseIds.has(meta.toolUseId);
    else if (notifiedToolUseIds.has(meta.toolUseId)) running = false;
    else running = now - await lastWriteMs(sessionFile, meta.agentId) < BACKGROUND_SUBAGENT_IDLE_MS;
    subagents.push({ ...meta, status: running ? 'running' : 'done' });
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
