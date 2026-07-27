import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { SubagentSummary } from '@overdeck/contracts';

export type SubagentMeta = Omit<SubagentSummary, 'status'>;

const metaCache = new Map<string, SubagentMeta | null>();
const SAFE_AGENT_ID = /^[A-Za-z0-9_-]+$/;

export function subagentsDirFor(sessionFile: string): string {
  const sessionDir = sessionFile.endsWith('.jsonl')
    ? sessionFile.slice(0, -'.jsonl'.length)
    : sessionFile;
  return join(sessionDir, 'subagents');
}

function parseMeta(agentId: string, value: unknown): SubagentMeta {
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
  };
}

async function readMeta(metaPath: string, agentId: string): Promise<SubagentMeta | null> {
  const cached = metaCache.get(metaPath);
  if (cached !== undefined || metaCache.has(metaPath)) return cached ?? null;

  try {
    const parsed = parseMeta(agentId, JSON.parse(await readFile(metaPath, 'utf8')));
    metaCache.set(metaPath, parsed);
    return parsed;
  } catch (error) {
    console.warn(`[conversation-subagents] Failed to parse ${metaPath}:`, error);
    metaCache.set(metaPath, null);
    return null;
  }
}

export async function listSubagentMetas(sessionFile: string): Promise<SubagentMeta[]> {
  const subagentsDir = subagentsDirFor(sessionFile);
  let entries: string[];

  try {
    entries = await readdir(subagentsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const metas: SubagentMeta[] = [];
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
