import { open } from 'fs/promises';

const MAX_USER_CHARS = 40_000;
export const MAX_TRANSCRIPT_DELTA_BYTES = 1024 * 1024;

export interface CompressTranscriptDeltaInput {
  transcriptPath: string;
  fromOffset: number;
  toOffset: number;
}

export interface CompressedTranscriptDelta {
  text: string;
  eventsConsumed: number;
  lastFullLineOffset: number;
}

interface TranscriptEntry {
  type?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
  };
  toolUseResult?: unknown;
}

interface ToolUseBlock {
  type?: unknown;
  name?: unknown;
  input?: unknown;
}

export async function compressTranscriptDelta(input: CompressTranscriptDeltaInput): Promise<CompressedTranscriptDelta> {
  const length = Math.min(Math.max(0, input.toOffset - input.fromOffset), MAX_TRANSCRIPT_DELTA_BYTES);
  if (length === 0) return { text: '', eventsConsumed: 0, lastFullLineOffset: input.fromOffset };

  const file = await open(input.transcriptPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await file.read(buffer, 0, length, input.fromOffset);
    const result = compressJsonlBuffer(buffer.subarray(0, bytesRead).toString('utf8'), input.fromOffset);
    if (result.lastFullLineOffset === input.fromOffset && bytesRead === MAX_TRANSCRIPT_DELTA_BYTES) {
      return { ...result, lastFullLineOffset: input.fromOffset + bytesRead };
    }
    return result;
  } finally {
    await file.close();
  }
}

export function compressJsonlBuffer(buffer: string, fromOffset = 0): CompressedTranscriptDelta {
  const lastNewline = buffer.lastIndexOf('\n');
  if (lastNewline === -1) return { text: '', eventsConsumed: 0, lastFullLineOffset: fromOffset };

  const complete = buffer.slice(0, lastNewline + 1);
  const parts: string[] = [];
  let eventsConsumed = 0;

  let start = 0;
  for (let index = 0; index < complete.length; index++) {
    if (complete[index] !== '\n') continue;
    const line = complete.slice(start, index);
    start = index + 1;
    if (line.trim().length === 0) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    eventsConsumed += 1;
    const compressed = compressEntry(entry);
    if (compressed.length > 0) parts.push(...compressed);
  }

  return {
    text: parts.join('\n'),
    eventsConsumed,
    lastFullLineOffset: fromOffset + Buffer.byteLength(complete, 'utf8'),
  };
}

function compressEntry(entry: TranscriptEntry): string[] {
  const role = entry.message?.role;
  const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
  const text = content
    .flatMap((block) => extractText(block))
    .join('\n')
    .trim();
  const toolLines = content.flatMap((block) => extractToolLine(block));

  if (role === 'user' || entry.type === 'user') {
    return text ? [`U: ${truncateUserText(text)}`] : [];
  }

  if (role === 'assistant' || entry.type === 'assistant') {
    const lines: string[] = [];
    if (text) lines.push(`A: ${text}`);
    lines.push(...toolLines);
    return lines;
  }

  return toolLines;
}

function extractText(block: unknown): string[] {
  if (typeof block === 'string') return [block];
  if (!isRecord(block)) return [];
  if (block.type === 'text' && typeof block.text === 'string') return [block.text];
  return [];
}

function extractToolLine(block: unknown): string[] {
  if (!isRecord(block)) return [];
  if (block.type !== 'tool_use') return [];
  const name = typeof block.name === 'string' ? block.name : 'unknown';
  return [categorizeToolUse({ type: block.type, name, input: block.input })];
}

function categorizeToolUse(block: ToolUseBlock): string {
  const name = typeof block.name === 'string' ? block.name : 'unknown';
  const path = extractToolPath(block.input);

  if (name === 'Write') return `Created: ${path ?? 'unknown path'}`;
  if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return `Updated: ${path ?? 'unknown path'}`;
  if (name === 'Bash') return `Bash: ${extractBashCommand(block.input) ?? 'command'}`;
  return `Tool(${name}): ${path ?? 'unknown'}`;
}

function extractToolPath(input: unknown): string | null {
  if (!isRecord(input)) return null;
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function extractBashCommand(input: unknown): string | null {
  if (!isRecord(input)) return null;
  return typeof input.command === 'string' ? input.command : null;
}

function truncateUserText(text: string): string {
  if (text.length <= MAX_USER_CHARS) return text;
  return `${text.slice(0, MAX_USER_CHARS)}\n[truncated ${text.length - MAX_USER_CHARS} chars]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
