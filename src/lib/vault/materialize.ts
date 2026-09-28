/**
 * Session Vault materialization (PAN-2609): PRD "Materialization", FR-5, FR-6,
 * FR-17 and decision P-5.
 *
 * `materializeClaude` fetches and decrypts the VIEW chunks and writes them as
 * a new Claude Code session file under `~/.claude/projects/<slug(cwd)>/`,
 * rewriting only each line's `"sessionId":"<old>"` and, when the cwd changed,
 * `"cwd":"<old>"` substrings by exact string replacement so every other byte
 * is unchanged. It never overwrites an existing file.
 *
 * `restoreNative` rebuilds this machine's native file byte for byte from the
 * LOG: the adopter prefix (if any) is re-materialized deterministically from
 * `segment.prefix`, then the segment's own LOG lines follow.
 *
 * The project-dir slug comes from `src/lib/runtimes/storage/claude-code.ts`
 * (a leaf module); nothing under `src/lib/overdeck/*` is imported (P-14).
 */
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { claudeProjectDir } from '../runtimes/storage/claude-code.js';
import { decodeChunk, type RecordSegment, type SegmentPrefix, type SessionRecord } from './format.js';
import type { VaultSubkeys } from './identity.js';
import type { VaultStore } from './store/types.js';

export interface ViewSlice {
  /** LOG-ordered lines of the VIEW (from `record.view` to the end). */
  lines: string[];
  fromChunk: number;
  fromLine: number;
  /** Total LOG line count at the time of the read. */
  logEnd: number;
}

/** Decode every chunk of `record.log`, in order. */
export async function readLogLines(record: SessionRecord, store: VaultStore, keys: VaultSubkeys): Promise<string[][]> {
  const chunks: string[][] = [];
  for (const id of record.log) {
    const bytes = await store.getObject(id);
    if (!bytes) throw new Error(`Vault chunk ${id} of record ${record.vaultId} is missing from the backend`);
    chunks.push((await decodeChunk(bytes, id, keys)).lines);
  }
  return chunks;
}

/** The VIEW lines of a record: from `record.view` to the end of the LOG. */
export async function readViewLines(record: SessionRecord, store: VaultStore, keys: VaultSubkeys): Promise<ViewSlice> {
  const chunks = await readLogLines(record, store, keys);
  return sliceView(chunks, record.view.fromChunk, record.view.fromLine);
}

function sliceView(chunks: string[][], fromChunk: number, fromLine: number): ViewSlice {
  const lines: string[] = [];
  chunks.forEach((chunk, index) => {
    if (index < fromChunk) return;
    lines.push(...(index === fromChunk ? chunk.slice(fromLine) : chunk));
  });
  return { lines, fromChunk, fromLine, logEnd: chunks.reduce((sum, chunk) => sum + chunk.length, 0) };
}

export interface RewriteOptions {
  sessionIdsFrom: readonly string[];
  sessionIdTo: string;
  cwdsFrom: readonly string[];
  cwdTo: string | null;
}

/** Replace only the `"sessionId":"…"` and `"cwd":"…"` substrings that name the old values. */
export function rewriteLine(line: string, options: RewriteOptions): string {
  let out = line;
  for (const from of options.sessionIdsFrom) {
    if (from === options.sessionIdTo) continue;
    out = out.split(`"sessionId":${JSON.stringify(from)}`).join(`"sessionId":${JSON.stringify(options.sessionIdTo)}`);
  }
  if (options.cwdTo !== null) {
    for (const from of options.cwdsFrom) {
      if (from === options.cwdTo) continue;
      out = out.split(`"cwd":${JSON.stringify(from)}`).join(`"cwd":${JSON.stringify(options.cwdTo)}`);
    }
  }
  return out;
}

/** Every session id and cwd a record's lines may carry (owner and every adopter). */
export function knownIdentifiers(record: SessionRecord): { sessionIds: string[]; cwds: string[] } {
  const sessionIds = new Set<string>([record.nativeSessionId]);
  const cwds = new Set<string>();
  if (record.cwd) cwds.add(record.cwd);
  for (const segment of record.segments) {
    sessionIds.add(segment.nativeSessionId);
    if (segment.prefix) {
      sessionIds.add(segment.prefix.sessionIdFrom);
      sessionIds.add(segment.prefix.sessionIdTo);
      cwds.add(segment.prefix.cwdFrom);
      cwds.add(segment.prefix.cwdTo);
    }
  }
  return { sessionIds: [...sessionIds], cwds: [...cwds] };
}

async function writeNewFile(path: string, content: string): Promise<void> {
  try {
    await stat(path);
    throw new Error(`Refusing to overwrite existing file ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, content, { flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export interface MaterializeClaudeOptions {
  record: SessionRecord;
  store: VaultStore;
  keys: VaultSubkeys;
  targetCwd: string;
  newSessionId: string;
  /** Defaults to `~/.claude/projects`. */
  projectsRoot?: string;
}

export interface MaterializeResult {
  path: string;
  lines: number;
  /** Describes what was written, ready to become an adopter segment prefix (P-5). */
  prefix: SegmentPrefix;
}

export interface MaterializationPlan {
  /** The rewritten VIEW lines that will be written. */
  lines: string[];
  /** Destination session file. */
  path: string;
  prefix: SegmentPrefix;
}

/** Compute what `materializeClaude` would write, without touching the disk. */
export async function planMaterialization(options: MaterializeClaudeOptions): Promise<MaterializationPlan> {
  const { record, store, keys, targetCwd, newSessionId } = options;
  const view = await readViewLines(record, store, keys);
  const ids = knownIdentifiers(record);
  const cwdChanged = targetCwd !== record.cwd;
  const lines = view.lines.map((line) => rewriteLine(line, {
    sessionIdsFrom: ids.sessionIds,
    sessionIdTo: newSessionId,
    cwdsFrom: ids.cwds,
    cwdTo: cwdChanged ? targetCwd : null,
  }));
  const dir = options.projectsRoot ? claudeProjectDir(targetCwd, options.projectsRoot) : claudeProjectDir(targetCwd);
  return {
    lines,
    path: join(dir, `${newSessionId}.jsonl`),
    prefix: {
      viewFromChunk: view.fromChunk,
      viewFromLine: view.fromLine,
      logEnd: view.logEnd,
      sessionIdFrom: record.nativeSessionId,
      sessionIdTo: newSessionId,
      cwdFrom: record.cwd,
      cwdTo: targetCwd,
      lineCount: lines.length,
    },
  };
}

/** The exact bytes a materialized or restored file holds for `lines`. */
export function nativeFileContent(lines: readonly string[]): string {
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

/** Write a planned materialization. Refuses to overwrite an existing file. */
export async function writeMaterialization(plan: MaterializationPlan): Promise<void> {
  await writeNewFile(plan.path, nativeFileContent(plan.lines));
}

/** Write the VIEW as a fresh Claude Code session file for `targetCwd`. */
export async function materializeClaude(options: MaterializeClaudeOptions): Promise<MaterializeResult> {
  const plan = await planMaterialization(options);
  await writeMaterialization(plan);
  return { path: plan.path, lines: plan.lines.length, prefix: plan.prefix };
}

export interface RestoreNativeOptions {
  record: SessionRecord;
  store: VaultStore;
  keys: VaultSubkeys;
  /** Where to write; defaults to the segment's original location is unknown, so it is required. */
  nativePath: string;
  /** Which segment to rebuild; defaults to the record owner's. */
  environmentId?: string;
}

/** The exact lines of `segment`'s native file as last settled. */
export async function segmentLines(record: SessionRecord, segment: RecordSegment, store: VaultStore, keys: VaultSubkeys): Promise<string[]> {
  const chunks = await readLogLines(record, store, keys);
  const log = chunks.flat();
  const prefixLines: string[] = [];
  if (segment.prefix) {
    const { prefix } = segment;
    const view = sliceView(chunks, prefix.viewFromChunk, prefix.viewFromLine);
    const ids = knownIdentifiers(record);
    const slice = view.lines.slice(0, prefix.lineCount);
    for (const line of slice) {
      prefixLines.push(rewriteLine(line, {
        sessionIdsFrom: ids.sessionIds.filter((id) => id !== prefix.sessionIdTo),
        sessionIdTo: prefix.sessionIdTo,
        cwdsFrom: ids.cwds,
        cwdTo: prefix.cwdTo !== prefix.cwdFrom ? prefix.cwdTo : null,
      }));
    }
  }
  const ownCount = segment.tail.lineCount - prefixLines.length;
  const own = log.slice(segment.logStart, segment.logStart + Math.max(0, ownCount));
  return [...prefixLines, ...own];
}

/** Rebuild a native transcript byte for byte at `nativePath`. Refuses to overwrite. */
export async function restoreNative(options: RestoreNativeOptions): Promise<{ path: string; lines: number }> {
  const { record, store, keys, nativePath } = options;
  const environmentId = options.environmentId ?? record.owner.environmentId;
  const segment = [...record.segments].reverse().find((entry) => entry.environmentId === environmentId);
  if (!segment) throw new Error(`Record ${record.vaultId} has no segment for machine ${environmentId}`);
  const lines = await segmentLines(record, segment, store, keys);
  await writeNewFile(nativePath, nativeFileContent(lines));
  return { path: nativePath, lines: lines.length };
}
