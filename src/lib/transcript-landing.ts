import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionFilePath } from './runtimes/storage/claude-code.js';

const DEFAULT_TAIL_BYTES = 512 * 1024;

export interface TranscriptUserRecordSnapshot {
  readonly sessionFile: string;
  readonly userRecordCount: number;
  readonly fileSize?: number;
  /** Byte offset from which this snapshot was parsed. */
  readonly rangeStartByte?: number;
  /** Byte offset after the last complete JSONL line observed by this snapshot. */
  readonly readOffset?: number;
  readonly lastUserRecord?: {
    readonly lineNumber: number;
    readonly timestamp?: string;
    readonly uuid?: string;
  };
}

async function readFileRange(filePath: string, start: number, endExclusive: number): Promise<string> {
  if (endExclusive <= start) return '';

  return await new Promise<string>((resolve, reject) => {
    const stream = createReadStream(filePath, { start, end: endExclusive - 1, encoding: 'utf8' });
    let data = '';
    stream.on('data', chunk => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

function dropLeadingPartialLine(content: string): string {
  const firstNewline = content.indexOf('\n');
  if (firstNewline === -1) return '';
  return content.slice(firstNewline + 1);
}

function nextCompleteLineOffset(rangeStartByte: number, rawContent: string, fileSize: number): number {
  if (!rawContent) return fileSize;
  if (rawContent.endsWith('\n')) return fileSize;

  const lastNewline = rawContent.lastIndexOf('\n');
  if (lastNewline === -1) return rangeStartByte;
  return rangeStartByte + Buffer.byteLength(rawContent.slice(0, lastNewline + 1), 'utf8');
}

function isLandedUserRecord(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as {
    type?: unknown;
    message?: { role?: unknown; content?: unknown };
  };
  if (record.type !== 'user' || record.message?.role !== 'user') return false;

  const content = record.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;

  return content.some((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    return (item as { type?: unknown }).type !== 'tool_result';
  });
}

function parseLandedUserRecords(content: string): Pick<TranscriptUserRecordSnapshot, 'userRecordCount' | 'lastUserRecord'> {
  let userRecordCount = 0;
  let lastUserRecord: TranscriptUserRecordSnapshot['lastUserRecord'];

  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { timestamp?: unknown; uuid?: unknown };
      if (!isLandedUserRecord(entry)) continue;
      userRecordCount += 1;
      lastUserRecord = {
        lineNumber: index + 1,
        ...(typeof entry.timestamp === 'string' ? { timestamp: entry.timestamp } : {}),
        ...(typeof entry.uuid === 'string' ? { uuid: entry.uuid } : {}),
      };
    } catch {
      // Claude may be appending the JSONL while we read it. Ignore malformed
      // partial lines; the next poll sees the completed record.
    }
  }

  return { userRecordCount, ...(lastUserRecord ? { lastUserRecord } : {}) };
}

export async function captureTranscriptUserRecordSnapshot(
  workspace: string,
  sessionId: string,
  options: { tailBytes?: number; fromByteOffset?: number } = {},
): Promise<TranscriptUserRecordSnapshot> {
  const sessionFile = sessionFilePath(workspace, sessionId);
  if (!existsSync(sessionFile)) {
    return { sessionFile, userRecordCount: 0, fileSize: 0, rangeStartByte: 0, readOffset: 0 };
  }

  try {
    const fileStat = await stat(sessionFile);
    const fileSize = fileStat.size;
    const rangeStartByte = options.fromByteOffset === undefined
      ? Math.max(0, fileSize - (options.tailBytes ?? DEFAULT_TAIL_BYTES))
      : Math.min(Math.max(0, options.fromByteOffset), fileSize);
    const rawContent = await readFileRange(sessionFile, rangeStartByte, fileSize);
    const content = options.fromByteOffset === undefined && rangeStartByte > 0
      ? dropLeadingPartialLine(rawContent)
      : rawContent;
    const parsed = parseLandedUserRecords(content);

    return {
      sessionFile,
      ...parsed,
      fileSize,
      rangeStartByte,
      readOffset: nextCompleteLineOffset(rangeStartByte, rawContent, fileSize),
    };
  } catch {
    return { sessionFile, userRecordCount: 0, fileSize: 0, rangeStartByte: 0, readOffset: 0 };
  }
}

export interface TranscriptWatchProbe {
  /** A landed user record whose content contains the watched message text. */
  matchedUserRecord: boolean;
  /** Real model turns observed at/after the probe's start offset. */
  realAssistantTurnCount?: number;
  /** compact_boundary records observed at/after the probe's start offset. */
  compactBoundaryCount: number;
}

const MATCH_PREFIX_CHARS = 120;

/**
 * Claude Code writes a background subagent's completion as a `<task-notification>`
 * record (see docs/CONVERSATION-SUBAGENTS.md). A wake reacting to that notification
 * is not the operator's own turn, so it must never be counted as one nor mistaken
 * for a landed copy of the operator's message.
 */
const TASK_NOTIFICATION_PREFIX = '<task-notification>';

function normalizeForContentMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Text of a message Claude Code queued rather than landing directly: either the
 * `queue-operation` `enqueue` record it writes the instant a message is queued, or
 * the `queued_command` attachment recorded when the parent later takes it. Both
 * carry the plain string the operator sent.
 */
function queuedPromptText(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as { type?: unknown; operation?: unknown; content?: unknown; attachment?: unknown };

  if (record.type === 'queue-operation' && record.operation === 'enqueue' && typeof record.content === 'string') {
    return record.content;
  }

  if (record.type === 'attachment' && record.attachment && typeof record.attachment === 'object') {
    const attachment = record.attachment as { type?: unknown; prompt?: unknown };
    if (attachment.type === 'queued_command' && typeof attachment.prompt === 'string') {
      return attachment.prompt;
    }
  }

  return null;
}

/**
 * Harness-meta user records the matcher must never treat as the user's own
 * message landing. Compaction itself writes user-type records (the
 * continuation summary, `<command-name>`/`<local-command-*>` entries), and a
 * continuation summary can even quote the watched message — counting any of
 * these as a landing would mask exactly the eaten-by-compaction case the
 * probe exists to detect (PAN-1635 / PAN-1769).
 */
const META_USER_CONTENT_PREFIXES = [
  'This session is being continued',
  '<command-name>',
  '<local-command-',
  'Caveat: The messages below',
];

function userRecordText(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as { type?: unknown; message?: { role?: unknown; content?: unknown } };
  if (record.type !== 'user' || record.message?.role !== 'user') return null;
  const content = record.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter((item): item is { type?: unknown; text?: unknown } => !!item && typeof item === 'object')
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
}

function isCompactBoundaryRecord(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as { type?: unknown; subtype?: unknown };
  return record.type === 'system' && record.subtype === 'compact_boundary';
}

function isRealAssistantTurn(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as { type?: unknown; message?: { role?: unknown; model?: unknown } };
  return record.type === 'assistant'
    && record.message?.role === 'assistant'
    && record.message.model !== '<synthetic>';
}

/**
 * Scan the transcript from `fromByteOffset` for (a) a user record carrying
 * `messageText` and (b) compact boundaries. Backs the eaten-by-compaction
 * watcher: a boundary appearing without the message means Claude Code's
 * submit-time compaction dropped the just-delivered prompt.
 */
export async function probeTranscriptSince(
  workspace: string,
  sessionId: string,
  fromByteOffset: number,
  messageText: string,
): Promise<TranscriptWatchProbe> {
  const needle = normalizeForContentMatch(messageText).slice(0, MATCH_PREFIX_CHARS);
  const sessionFile = sessionFilePath(workspace, sessionId);
  if (!needle || !existsSync(sessionFile)) {
    return { matchedUserRecord: false, realAssistantTurnCount: 0, compactBoundaryCount: 0 };
  }

  try {
    const fileStat = await stat(sessionFile);
    const start = Math.min(Math.max(0, fromByteOffset), fileStat.size);
    const content = await readFileRange(sessionFile, start, fileStat.size);
    let matchedUserRecord = false;
    let realAssistantTurnCount = 0;
    let compactBoundaryCount = 0;
    let afterTaskNotification = false;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as unknown;
        if (isCompactBoundaryRecord(entry)) {
          compactBoundaryCount += 1;
          continue;
        }
        const queuedText = queuedPromptText(entry);
        if (queuedText !== null) {
          if (
            !queuedText.trimStart().startsWith(TASK_NOTIFICATION_PREFIX)
            && normalizeForContentMatch(queuedText).includes(needle)
          ) {
            matchedUserRecord = true;
          }
          continue;
        }
        if (isRealAssistantTurn(entry)) {
          if (!afterTaskNotification) realAssistantTurnCount += 1;
          continue;
        }
        const text = userRecordText(entry);
        if (text === null) continue;
        if (isLandedUserRecord(entry)) {
          afterTaskNotification = text.startsWith(TASK_NOTIFICATION_PREFIX);
        }
        if (META_USER_CONTENT_PREFIXES.some((prefix) => text.startsWith(prefix))) continue;
        if (normalizeForContentMatch(text).includes(needle)) matchedUserRecord = true;
      } catch {
        // Partial trailing line mid-append; the next probe sees it complete.
      }
    }
    return { matchedUserRecord, realAssistantTurnCount, compactBoundaryCount };
  } catch {
    return { matchedUserRecord: false, realAssistantTurnCount: 0, compactBoundaryCount: 0 };
  }
}

/**
 * When Claude Code routes a queued message into a running subagent instead of the
 * main conversation, the subagent's own transcript records it as a sidechain
 * record wrapped in this preamble. Only the operator's own text is useful to a
 * caller trying to confirm delivery.
 */
const SIDECHAIN_HUMAN_PREFIX = 'The user sent a new message while you were working:\n';
const SIDECHAIN_HUMAN_SUFFIX_MARKER = '\n\nThis is how Claude Code surfaces';

/** Strip Claude Code's sidechain wrapper, if present, to the operator's own text. */
export function extractSidechainHumanText(content: string): string {
  if (!content.startsWith(SIDECHAIN_HUMAN_PREFIX)) return content.trim();

  const stripped = content.slice(SIDECHAIN_HUMAN_PREFIX.length);
  const cutIndex = stripped.indexOf(SIDECHAIN_HUMAN_SUFFIX_MARKER);
  const body = cutIndex === -1 ? stripped : stripped.slice(0, cutIndex);
  return body.trim();
}

export interface SidechainHumanInput {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
}

function sidechainRecordContentText(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as {
    type?: unknown;
    isSidechain?: unknown;
    origin?: { kind?: unknown };
    message?: { role?: unknown; content?: unknown };
  };
  if (record.type !== 'user' || record.isSidechain !== true) return null;
  if (!record.origin || typeof record.origin !== 'object' || record.origin.kind !== 'human') return null;
  if (record.message?.role !== 'user') return null;

  const content = record.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter((item): item is { type?: unknown; text?: unknown } => !!item && typeof item === 'object')
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
}

function sidechainHumanInputFrom(entry: unknown): SidechainHumanInput | null {
  const rawText = sidechainRecordContentText(entry);
  if (rawText === null) return null;

  const record = entry as { uuid?: unknown; timestamp?: unknown };
  return {
    id: typeof record.uuid === 'string' ? record.uuid : '',
    text: extractSidechainHumanText(rawText),
    createdAt: typeof record.timestamp === 'string' ? record.timestamp : '',
  };
}

/**
 * Read human-origin sidechain records appended to a subagent transcript since
 * `fromByteOffset`, over complete JSONL lines only.
 */
export async function readSidechainHumanInputs(
  file: string,
  fromByteOffset: number,
): Promise<{ inputs: SidechainHumanInput[]; readOffset: number }> {
  try {
    const fileStat = await stat(file);
    const start = Math.min(Math.max(0, fromByteOffset), fileStat.size);
    const rawContent = await readFileRange(file, start, fileStat.size);
    const inputs: SidechainHumanInput[] = [];
    for (const line of rawContent.split('\n')) {
      if (!line.trim()) continue;
      try {
        const input = sidechainHumanInputFrom(JSON.parse(line) as unknown);
        if (input) inputs.push(input);
      } catch {
        // Partial trailing line mid-append; the next read sees it complete.
      }
    }
    return { inputs, readOffset: nextCompleteLineOffset(start, rawContent, fileStat.size) };
  } catch {
    return { inputs: [], readOffset: fromByteOffset };
  }
}

/**
 * Directory Claude Code writes a conversation's subagent transcripts and meta
 * files under. Kept local to this module (never imported from src/dashboard) so
 * the sidechain probe has no dependency on the dashboard's own subagent discovery.
 */
function subagentsDirFor(sessionFile: string): string {
  return join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');
}

const SUBAGENT_TRANSCRIPT_NAME = /^agent-(.+)\.jsonl$/;

/**
 * Snapshot each subagent transcript's current size, keyed by filename, so a
 * later {@link probeSidechainsSince} call can scan only bytes appended since now.
 * Subagents that appear after this call are absent from the map and are read
 * from their start.
 */
export async function captureSidechainOffsets(sessionFile: string): Promise<Map<string, number>> {
  const offsets = new Map<string, number>();
  let entries: string[];
  try {
    entries = await readdir(subagentsDirFor(sessionFile));
  } catch {
    return offsets;
  }

  for (const entry of entries) {
    if (!SUBAGENT_TRANSCRIPT_NAME.test(entry)) continue;
    try {
      const fileStat = await stat(join(subagentsDirFor(sessionFile), entry));
      offsets.set(entry, fileStat.size);
    } catch {
      // Transcript disappeared between readdir and stat; skip it.
    }
  }
  return offsets;
}

async function subagentDescription(subagentsDir: string, agentId: string): Promise<string> {
  try {
    const raw = await readFile(join(subagentsDir, `agent-${agentId}.meta.json`), 'utf8');
    const parsed = JSON.parse(raw) as { description?: unknown };
    if (typeof parsed.description === 'string' && parsed.description) return parsed.description;
  } catch {
    // Meta file missing or unparsable; fall back to the agent id.
  }
  return agentId;
}

/**
 * Scan every subagent transcript for a human-origin sidechain record carrying
 * `messageText`, reading only bytes appended since `offsets` was captured (a
 * subagent absent from `offsets` is read from its start). Returns the first
 * match's agent id and description, or `null` if none carry it.
 */
export async function probeSidechainsSince(
  sessionFile: string,
  offsets: ReadonlyMap<string, number>,
  messageText: string,
): Promise<{ agentId: string; description: string } | null> {
  const needle = normalizeForContentMatch(messageText).slice(0, MATCH_PREFIX_CHARS);
  if (!needle) return null;

  const subagentsDir = subagentsDirFor(sessionFile);
  let entries: string[];
  try {
    entries = await readdir(subagentsDir);
  } catch {
    return null;
  }

  for (const entry of entries.sort()) {
    const match = SUBAGENT_TRANSCRIPT_NAME.exec(entry);
    if (!match?.[1]) continue;

    const { inputs } = await readSidechainHumanInputs(join(subagentsDir, entry), offsets.get(entry) ?? 0);
    const hit = inputs.find((input) => normalizeForContentMatch(input.text).includes(needle));
    if (hit) {
      const agentId = match[1];
      return { agentId, description: await subagentDescription(subagentsDir, agentId) };
    }
  }
  return null;
}
