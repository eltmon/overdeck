/** Read-only Codex child-thread discovery, scoped to the parent's sessions tree. */
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { SubagentSummary, WorkLogEntry } from '@overdeck/contracts';
import { codexThreadStatus } from '../../../../lib/conversations/codex-thread-status.js';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

interface ThreadMeta {
  id: string;
  parentId: string;
  path: string;
  name: string;
  role: string;
  file: string;
}
// A rollout's first-line metadata never changes, so a large cap is cheap (a
// few short strings per entry). At 512 a host with more rollouts re-read every
// file on every walk (PAN-3920 review).
const METADATA_CACHE_MAX = 8192;
const metadata = new Map<string, ThreadMeta>();

async function readMeta(file: string): Promise<ThreadMeta | null> {
  const cached = metadata.get(file);
  if (cached) return cached;
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const entry = object(line);
      if (entry.type !== 'session_meta') return null;
      const payload = object(entry.payload);
      const spawn = object(object(object(payload.source).subagent).thread_spawn);
      const id = text(payload.id);
      if (!id) return null;
      const meta = {
        id, file,
        // Only thread_spawn establishes ownership; ordinary conversation forks do not.
        parentId: text(spawn.parent_thread_id),
        path: text(spawn.agent_path ?? payload.agent_path),
        name: text(spawn.agent_nickname ?? payload.agent_nickname),
        role: text(spawn.agent_role ?? payload.agent_role),
      };
      if (metadata.size >= METADATA_CACHE_MAX) metadata.delete(metadata.keys().next().value!);
      metadata.set(file, meta);
      return meta;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  } finally {
    lines.close();
    input.destroy();
  }
}

function sessionsRoot(file: string): string | null {
  let dir = dirname(file);
  while (dirname(dir) !== dir) {
    if (basename(dir) === 'sessions') return dir;
    dir = dirname(dir);
  }
  return null;
}

async function rollouts(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // Do not follow symlinks out of the parent's Codex home.
    if (entry.isDirectory()) files.push(...await rollouts(path));
    else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

async function descendants(parentFile: string): Promise<Array<{ meta: ThreadMeta; depth: number }>> {
  const root = sessionsRoot(parentFile);
  if (!root) return [];
  const parent = await readMeta(parentFile);
  if (!parent) return [];
  const metas: ThreadMeta[] = [];
  for (const file of await rollouts(root)) {
    const meta = await readMeta(file);
    if (meta?.parentId) metas.push(meta);
  }
  const depths = new Map([[parent.id, 0]]);
  const children: Array<{ meta: ThreadMeta; depth: number }> = [];
  // Walk by verified parent IDs, including grandchildren, regardless of file order.
  for (let i = 0; i <= children.length; i++) {
    const parentId = i === 0 ? parent.id : children[i - 1].meta.id;
    for (const meta of metas) {
      if (meta.parentId !== parentId || depths.has(meta.id)) continue;
      const depth = depths.get(parentId)! + 1;
      depths.set(meta.id, depth);
      children.push({ meta, depth });
    }
  }
  return children;
}

/** One Codex child thread: its summary fields and rollout file, read in a single walk. */
export interface CodexSubagentThread extends Omit<SubagentSummary, 'status'> {
  readonly file: string;
}

/**
 * Every descendant thread of a parent rollout, from ONE walk of the sessions
 * tree and without reading any child's task status (PAN-3920: the Agents
 * Directory derives state from the rollout mtime, so it skips the tail read).
 */
export async function listCodexSubagentThreads(
  parentFile: string,
  workLog: readonly WorkLogEntry[] = [],
): Promise<CodexSubagentThread[]> {
  return (await descendants(parentFile)).map(({ meta, depth }) => {
    const call = depth === 1 ? workLog.find((entry) => {
      if (entry.label !== 'spawn_agent') return false;
      const output = object(entry.result);
      return output.agent_id === meta.id || output.thread_id === meta.id
        || (meta.path !== '' && output.task_name === meta.path);
    }) : undefined;
    const args = object(call?.toolInput ?? call?.detail);
    return {
      agentId: meta.id,
      agentType: meta.role || meta.name || 'Codex',
      description: text(args.task_name) || meta.path || meta.name || 'Subagent',
      toolUseId: call?.id ?? meta.id,
      spawnDepth: depth,
      file: meta.file,
    };
  });
}

export async function listCodexSubagents(parentFile: string, workLog: readonly WorkLogEntry[] = []): Promise<SubagentSummary[]> {
  const summaries: SubagentSummary[] = [];
  for (const { file, ...thread } of await listCodexSubagentThreads(parentFile, workLog)) {
    summaries.push({ ...thread, status: await codexThreadStatus(file) });
  }
  return summaries;
}

export async function resolveCodexSubagentTranscript(parentFile: string, agentId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
  return (await descendants(parentFile)).find(({ meta }) => meta.id === agentId)?.meta.file ?? null;
}
