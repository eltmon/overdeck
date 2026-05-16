import { randomUUID } from 'crypto';
import { appendFile, readFile, rename, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { MemoryObservation } from '@panctl/contracts';
import { ensureParentDir, resolveObservationsFile } from './paths.js';

export interface WriteObservationResult {
  jsonlPath: string;
  markdownPath: string;
}

export async function writeObservation(observation: MemoryObservation): Promise<WriteObservationResult> {
  const jsonlPath = resolveObservationsFile(observation.projectId, observation.issueId, observation.timestamp);
  const markdownPath = observationMarkdownPath(observation);

  await ensureParentDir(jsonlPath);
  await appendFile(jsonlPath, `${JSON.stringify(observation)}\n`, { encoding: 'utf8', flag: 'a' });
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
