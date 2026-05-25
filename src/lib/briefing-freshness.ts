import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getPanopticonHome } from './paths.js';

export const BRIEFING_UPDATE_TAG = 'panopticon-briefing-update';

interface BriefingSessionMarker {
  sessionId: string;
  sessionStartedAtMs: number;
  lastInjectedBriefingMtimeMs: number | null;
  updatedAt: string;
}

export interface RecordBriefingSessionStartInput {
  sessionId: string;
  now?: Date;
}

export interface AppendFreshBriefingUpdateInput {
  sessionId: string;
  context: string;
  now?: Date;
}

export interface AppendFreshBriefingUpdateResult {
  context: string;
  injected: boolean;
  briefingMtimeMs: number | null;
}

export function resolveSessionContextBriefingPath(): string {
  return briefingFilePath();
}

export async function ensureSessionContextBriefingFile(): Promise<string> {
  const path = resolveSessionContextBriefingPath();
  try {
    await stat(path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '# Panopticon Session Context\n\nNo live briefing has been generated yet.\n', 'utf8');
  }
  return path;
}

export async function recordBriefingSessionStart(input: RecordBriefingSessionStartInput): Promise<void> {
  const now = input.now ?? new Date();
  await writeMarker({
    sessionId: input.sessionId,
    sessionStartedAtMs: now.getTime(),
    lastInjectedBriefingMtimeMs: null,
    updatedAt: now.toISOString(),
  });
}

export async function appendFreshBriefingUpdate(
  input: AppendFreshBriefingUpdateInput,
): Promise<AppendFreshBriefingUpdateResult> {
  const now = input.now ?? new Date();
  const marker = await readMarker(input.sessionId) ?? {
    sessionId: input.sessionId,
    sessionStartedAtMs: now.getTime(),
    lastInjectedBriefingMtimeMs: null,
    updatedAt: now.toISOString(),
  };
  const briefing = await readBriefing();
  if (!briefing || briefing.content.trim().length === 0) {
    await writeMarker(marker);
    return { context: input.context, injected: false, briefingMtimeMs: briefing?.mtimeMs ?? null };
  }

  const freshnessFloor = Math.max(marker.sessionStartedAtMs, marker.lastInjectedBriefingMtimeMs ?? 0);
  if (briefing.mtimeMs <= freshnessFloor) {
    await writeMarker(marker);
    return { context: input.context, injected: false, briefingMtimeMs: briefing.mtimeMs };
  }

  const nextMarker: BriefingSessionMarker = {
    ...marker,
    lastInjectedBriefingMtimeMs: briefing.mtimeMs,
    updatedAt: now.toISOString(),
  };
  await writeMarker(nextMarker);

  const block = buildBriefingUpdateBlock(briefing.content, briefing.mtimeMs);
  return {
    context: [input.context, block].filter(Boolean).join('\n'),
    injected: true,
    briefingMtimeMs: briefing.mtimeMs,
  };
}

function buildBriefingUpdateBlock(content: string, mtimeMs: number): string {
  return [
    `<${BRIEFING_UPDATE_TAG} mtime="${new Date(mtimeMs).toISOString()}">`,
    escapeBriefingContent(content),
    `</${BRIEFING_UPDATE_TAG}>`,
  ].join('\n');
}

function escapeBriefingContent(content: string): string {
  return content.replaceAll(`<${BRIEFING_UPDATE_TAG}`, `\\u003c${BRIEFING_UPDATE_TAG}`)
    .replaceAll(`</${BRIEFING_UPDATE_TAG}>`, `\\u003c/${BRIEFING_UPDATE_TAG}\\u003e`);
}

async function readBriefing(): Promise<{ content: string; mtimeMs: number } | null> {
  try {
    const path = briefingFilePath();
    const [fileStat, content] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    return { content, mtimeMs: fileStat.mtimeMs };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readMarker(sessionId: string): Promise<BriefingSessionMarker | null> {
  try {
    const raw = await readFile(markerFilePath(sessionId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BriefingSessionMarker>;
    if (parsed.sessionId !== sessionId || typeof parsed.sessionStartedAtMs !== 'number') return null;
    return {
      sessionId,
      sessionStartedAtMs: parsed.sessionStartedAtMs,
      lastInjectedBriefingMtimeMs: typeof parsed.lastInjectedBriefingMtimeMs === 'number'
        ? parsed.lastInjectedBriefingMtimeMs
        : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(parsed.sessionStartedAtMs).toISOString(),
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function writeMarker(marker: BriefingSessionMarker): Promise<void> {
  const path = markerFilePath(marker.sessionId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function briefingFilePath(): string {
  return join(getPanopticonHome(), 'session-context.md');
}

function markerFilePath(sessionId: string): string {
  return join(getPanopticonHome(), 'briefing', 'sessions', `${Buffer.from(sessionId).toString('base64url')}.json`);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
