/**
 * Session Vault settlement (PAN-2609): PRD "Settlement", decisions P-5, P-6.
 *
 * One settlement moves the lines a native transcript gained since the last
 * settlement into the vault:
 *
 *   1. skip excluded sessions;
 *   2. split the live file into settleable lines and run the continuity
 *      check against the saved tail (`noop` / `append` / `diverged`);
 *   3. scan the new lines for secrets: any hit blocks and writes nothing;
 *   4. split into chunks, encode, `putObjects`;
 *   5. append a settlement entry (human turns, cwd state), recompute the VIEW
 *      when a compaction boundary appeared, then `casRef` the record;
 *   6. advance the machine-local index only after the ref is written.
 *
 * The first settlement mints the `vaultId` and a segment owned by this
 * machine. If the record's owner is no longer this machine (P-6), the new
 * lines are saved as a fork record owned here whose parent is the last version
 * this machine settled; the original record is left untouched. A
 * `VaultOfflineError` anywhere yields `offline` and leaves the local index
 * where it was, so nothing is half-saved.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { readVaultConfig, type VaultConfig } from './config.js';
import { checkContinuity, splitSettleableLines, tailOf, type Tail } from './continuity.js';
import { readCwdState } from './cwd-state.js';
import { isExcluded } from './exclude.js';
import {
  encodeChunk,
  encryptRef,
  isTombstone,
  readSessionRecord,
  refName,
  splitIntoChunks,
  type SessionRecord,
  type Settlement,
} from './format.js';
import type { VaultSubkeys } from './identity.js';
import { getOwned, setOwnedTail } from './local-index.js';
import { scanNewLines, type SecretHit } from './secrets.js';
import { VaultOfflineError, type VaultStore } from './store/types.js';
import { countHumanTurns, isHumanTurn, type TurnHarness } from './turns.js';

export const MAX_SETTLEMENTS_KEPT = 500;

export interface SettleOptions {
  nativePath: string;
  harness: string;
  store: VaultStore;
  keys: VaultSubkeys;
  /** Defaults to `readVaultConfig()`. */
  config?: VaultConfig;
  /** Overrides the session id derived from the transcript. */
  nativeSessionId?: string;
  now?: () => Date;
}

export type SettleResult =
  | { verdict: 'noop'; vaultId: string }
  | {
      verdict: 'append';
      vaultId: string;
      /** Chunk ids written by this settlement. */
      chunks: string[];
      lines: number;
      version: number;
      /** Set when P-6 saved the lines as a fork of a record another machine now owns. */
      forkedFrom?: { vaultId: string; version: number };
    }
  | { verdict: 'diverged'; vaultId: string; reason: string }
  | { verdict: 'blocked'; vaultId: string; hits: SecretHit[] }
  | { verdict: 'excluded'; vaultId: string | null }
  | { verdict: 'offline'; vaultId: string | null };

interface TranscriptFacts {
  cwd: string | null;
  nativeSessionId: string | null;
  model: string | null;
  title: string | null;
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstHumanText(lines: readonly string[], harness: string): string | null {
  for (const line of lines) {
    if (!isHumanTurn(line, harness as TurnHarness)) continue;
    const entry = parseLine(line);
    if (!entry) continue;
    const text = extractUserText(entry);
    if (text) return text.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return null;
}

function extractUserText(entry: Record<string, unknown>): string | null {
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content ?? (entry.payload as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part && typeof part === 'object' ? (part as { text?: unknown }).text : undefined))
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    return text.length > 0 ? text : null;
  }
  return null;
}

/** Pull cwd, session id, model and a title out of the transcript's own lines. */
export function transcriptFacts(lines: readonly string[], harness: string): TranscriptFacts {
  const facts: TranscriptFacts = { cwd: null, nativeSessionId: null, model: null, title: null };
  for (const line of lines) {
    const entry = parseLine(line);
    if (!entry) continue;
    if (harness === 'codex') {
      const payload = entry.payload as Record<string, unknown> | undefined;
      if (entry.type === 'session_meta' && payload) {
        if (facts.cwd === null && typeof payload.cwd === 'string') facts.cwd = payload.cwd;
        const id = payload.id ?? payload.session_id;
        if (facts.nativeSessionId === null && typeof id === 'string') facts.nativeSessionId = id;
      }
      if (entry.type === 'turn_context' && payload && facts.model === null && typeof payload.model === 'string') {
        facts.model = payload.model;
      }
    } else {
      if (facts.cwd === null && typeof entry.cwd === 'string') facts.cwd = entry.cwd;
      if (facts.nativeSessionId === null && typeof entry.sessionId === 'string') facts.nativeSessionId = entry.sessionId;
      const message = entry.message as { model?: unknown } | undefined;
      if (facts.model === null && entry.type === 'assistant' && typeof message?.model === 'string') facts.model = message.model;
    }
    if (facts.cwd && facts.nativeSessionId && facts.model) break;
  }
  facts.title = firstHumanText(lines, harness);
  return facts;
}

/** True for the line that starts a new context window after compaction. */
export function isCompactionBoundary(line: string, harness: string): boolean {
  const entry = parseLine(line);
  if (!entry) return false;
  if (harness === 'claude-code') return entry.type === 'user' && entry.isCompactSummary === true;
  if (harness === 'codex') return entry.type === 'compacted';
  return false;
}

async function readRecord(store: VaultStore, name: string, keys: VaultSubkeys) {
  const ref = await store.readRef(name);
  if (!ref) return { record: null, version: null };
  const value = await readSessionRecord(name, ref.value, keys);
  if (!value || isTombstone(value)) return { record: null, version: ref.version, tombstone: value !== null };
  return { record: value, version: ref.version };
}

/** The 1-based version at which this machine last settled `lineCount` lines. */
function versionAtLineCount(record: SessionRecord, lineCount: number): number {
  const index = record.settlements.findIndex((settlement) => settlement.lines === lineCount);
  if (index >= 0) return (record.settlementsArchive?.length ?? 0) + index + 1;
  return record.settlements.length + (record.settlementsArchive?.length ?? 0);
}

/** Chunk ids up to and including version `version` of `record` (P-7). */
export function logThroughVersion(record: SessionRecord, version: number): string[] {
  const archived = record.settlementsArchive?.length ?? 0;
  const settlement = record.settlements[version - 1 - archived];
  if (!settlement) return [...record.log];
  const end = record.log.indexOf(settlement.chunk);
  return end < 0 ? [...record.log] : record.log.slice(0, end + 1);
}

export async function settle(options: SettleOptions): Promise<SettleResult> {
  const now = options.now ?? (() => new Date());
  const config = options.config ?? (await readVaultConfig());
  const { nativePath, harness, store, keys } = options;

  const owned = await getOwned(nativePath);
  const bytes = await readFile(nativePath);
  const { lines, consumedBytes } = splitSettleableLines(bytes);
  const facts = transcriptFacts(lines, harness);
  const nativeSessionId = options.nativeSessionId ?? facts.nativeSessionId ?? basename(nativePath, extname(nativePath));
  const cwd = facts.cwd;
  const cwdState = cwd ? await readCwdState(cwd) : null;
  const vaultId = owned?.vaultId ?? randomUUID();

  if (isExcluded({ cwd, gitOrigin: cwdState?.gitOrigin ?? null, nativeSessionId, vaultId }, config.exclude)) {
    return { verdict: 'excluded', vaultId: owned?.vaultId ?? null };
  }

  const tail: Tail = owned?.tail ?? { lineCount: 0, byteOffset: 0, lastHashes: [] };
  if (tail.byteOffset > bytes.length) {
    return { verdict: 'diverged', vaultId, reason: `live file is ${bytes.length} bytes but ${tail.byteOffset} were settled` };
  }
  const continuity = checkContinuity(tail, lines);
  if (continuity.verdict === 'noop') return { verdict: 'noop', vaultId };
  if (continuity.verdict === 'diverged') return { verdict: 'diverged', vaultId, reason: continuity.reason };

  const newLines = continuity.newLines;
  const hits = await scanNewLines([vaultId, nativePath], newLines, tail.lineCount + 1);
  if (hits.length > 0) return { verdict: 'blocked', vaultId, hits };

  try {
    const me = await ensureEnvironmentIdentity();
    const name = refName('record', vaultId, keys.K_ref);
    const current = owned ? await readRecord(store, name, keys) : { record: null, version: null };
    const at = now().toISOString();

    // P-6: the record moved to another machine while we were offline.
    let target: { vaultId: string; name: string; record: SessionRecord; expectedVersion: string | null };
    let forkedFrom: { vaultId: string; version: number } | undefined;
    if (current.record && current.record.owner.environmentId !== me.environmentId) {
      const parentVersion = versionAtLineCount(current.record, tail.lineCount);
      const forkId = randomUUID();
      const forkName = refName('record', forkId, keys.K_ref);
      forkedFrom = { vaultId, version: parentVersion };
      target = {
        vaultId: forkId,
        name: forkName,
        expectedVersion: null,
        record: {
          ...current.record,
          vaultId: forkId,
          owner: { environmentId: me.environmentId, label: me.label },
          nativeSessionId,
          title: `${current.record.title} (continued on ${me.label})`,
          log: logThroughVersion(current.record, parentVersion),
          parent: { vaultId, version: parentVersion },
          segments: [{ environmentId: me.environmentId, nativeSessionId, logStart: 0, prefix: null, tail }],
          settlements: current.record.settlements.filter((settlement) => settlement.lines <= tail.lineCount),
          lineage: [],
          createdAt: at,
          updatedAt: at,
        },
      };
    } else if (current.record) {
      target = { vaultId, name, record: current.record, expectedVersion: current.version };
    } else {
      if (owned && current.version !== null) {
        // Our record was tombstoned or replaced by something we cannot read: treat as excluded.
        return { verdict: 'excluded', vaultId };
      }
      target = {
        vaultId,
        name,
        expectedVersion: null,
        record: {
          v: 1,
          type: 'session',
          vaultId,
          owner: { environmentId: me.environmentId, label: me.label },
          harness,
          nativeSessionId,
          title: facts.title ?? basename(nativePath),
          model: facts.model,
          project: cwd ? basename(cwd) : null,
          cwd: cwd ?? '',
          gitOrigin: cwdState?.gitOrigin ?? null,
          log: [],
          view: { fromChunk: 0, fromLine: 0 },
          parent: null,
          segments: [{ environmentId: me.environmentId, nativeSessionId, logStart: 0, prefix: null, tail }],
          settlements: [],
          lineage: [],
          tombstone: false,
          createdAt: at,
          updatedAt: at,
          endedAt: null,
        },
      };
    }

    // Chunks.
    const groups = splitIntoChunks(newLines, config.maxChunkBytes);
    const encoded = await Promise.all(groups.map((group) => encodeChunk(group, keys)));
    await store.putObjects(encoded.map((chunk) => ({ id: chunk.id, bytes: chunk.bytes })));

    // Record update.
    const record = target.record;
    const firstNewChunk = record.log.length;
    record.log = [...record.log, ...encoded.map((chunk) => chunk.id)];
    groups.forEach((group, chunkIndex) => {
      group.forEach((line, lineIndex) => {
        if (isCompactionBoundary(line, harness)) {
          record.view = { fromChunk: firstNewChunk + chunkIndex, fromLine: lineIndex };
        }
      });
    });
    const newTail = tailOf(lines, consumedBytes);
    const settlement: Settlement = {
      at,
      chunk: encoded[encoded.length - 1]!.id,
      turn: countHumanTurns(lines, harness as TurnHarness),
      lines: lines.length,
      cwdState,
    };
    record.settlements = [...record.settlements, settlement];
    if (record.settlements.length > MAX_SETTLEMENTS_KEPT) {
      const overflow = record.settlements.splice(0, record.settlements.length - MAX_SETTLEMENTS_KEPT);
      const archive = await encodeChunk(overflow.map((entry) => JSON.stringify(entry)), keys);
      await store.putObjects([{ id: archive.id, bytes: archive.bytes }]);
      record.settlementsArchive = [...(record.settlementsArchive ?? []), archive.id];
    }
    const mine = record.segments.findIndex((segment) => segment.environmentId === me.environmentId);
    if (mine >= 0) record.segments[mine] = { ...record.segments[mine]!, nativeSessionId, tail: newTail };
    else record.segments.push({ environmentId: me.environmentId, nativeSessionId, logStart: tail.lineCount, prefix: null, tail: newTail });
    record.updatedAt = at;
    record.tombstone = false;

    const result = await store.casRef(target.name, target.expectedVersion, await encryptRef(target.name, record, keys));
    if (result === 'conflict') {
      // Someone changed the record between our read and write; report it as
      // divergence of ownership so the next run re-reads and forks if needed.
      return { verdict: 'diverged', vaultId: target.vaultId, reason: 'record changed on the backend during settlement' };
    }
    await setOwnedTail(nativePath, { vaultId: target.vaultId, harness, tail: newTail });
    const version = (record.settlementsArchive?.length ?? 0) + record.settlements.length;
    return {
      verdict: 'append',
      vaultId: target.vaultId,
      chunks: encoded.map((chunk) => chunk.id),
      lines: newLines.length,
      version,
      ...(forkedFrom ? { forkedFrom } : {}),
    };
  } catch (error) {
    if (error instanceof VaultOfflineError) return { verdict: 'offline', vaultId: owned?.vaultId ?? null };
    throw error;
  }
}
