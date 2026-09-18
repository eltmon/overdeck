/** Read-only Codex child-thread discovery, scoped to the parent's sessions tree. */
import { createReadStream } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { SubagentSummary, WorkLogEntry } from '@overdeck/contracts';

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
      if (metadata.size >= 512) metadata.delete(metadata.keys().next().value!);
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

async function threadStatus(file: string): Promise<SubagentSummary['status']> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - 128 * 1024);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    for (const line of lines.reverse()) {
      const entry = object(line);
      if (entry.type !== 'event_msg') continue;
      const payload = object(entry.payload);
      if (payload.type === 'task_complete' || payload.type === 'turn_aborted') return 'done';
      if (payload.type === 'task_started') return 'running';
    }
    return 'running';
  } finally { await handle.close(); }
}

export async function listCodexSubagents(parentFile: string, workLog: readonly WorkLogEntry[] = []): Promise<SubagentSummary[]> {
  const children = await descendants(parentFile);
  const summaries: SubagentSummary[] = [];
  for (const { meta, depth } of children) {
    const call = depth === 1 ? workLog.find((entry) => {
      if (entry.label !== 'spawn_agent') return false;
      const output = object(entry.result);
      return output.agent_id === meta.id || output.thread_id === meta.id
        || (meta.path !== '' && output.task_name === meta.path);
    }) : undefined;
    const args = object(call?.toolInput ?? call?.detail);
    summaries.push({
      agentId: meta.id,
      agentType: meta.role || meta.name || 'Codex',
      description: text(args.task_name) || meta.path || meta.name || 'Subagent',
      toolUseId: call?.id ?? meta.id,
      spawnDepth: depth,
      status: await threadStatus(meta.file),
    });
  }
  return summaries;
}

export async function resolveCodexSubagentTranscript(parentFile: string, agentId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
  return (await descendants(parentFile)).find(({ meta }) => meta.id === agentId)?.meta.file ?? null;
}
