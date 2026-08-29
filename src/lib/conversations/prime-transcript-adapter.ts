import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import { summarizeSerializedText } from './smart-compaction.js';
import type { ConversationTranscriptAdapter } from './transcript-adapter-types.js';

const DETAIL_LIMIT = 4_000;

function bounded(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

function serializePrimeRecord(record: Record<string, unknown>, includeThinking: boolean): string | undefined {
  const message = record.message && typeof record.message === 'object' ? record.message as Record<string, unknown> : record;
  const role = message.role;
  const type = String(record.type ?? message.type ?? '');
  const content = message.content ?? record.content ?? record.text;

  if ((role === 'user' || type === 'user') && content !== undefined) return `[user]\n${bounded(content)}`;
  if ((role === 'assistant' || type === 'assistant') && content !== undefined) return `[assistant]\n${bounded(content)}`;
  if ((type === 'thinking' || type === 'reasoning') && includeThinking) return `[assistant]\n[thinking]\n${bounded(content ?? record.thinking)}`;
  if (type === 'tool_call' || type === 'tool-call' || type === 'python') {
    const name = bounded(record.name ?? record.tool ?? type);
    return `[tool_use: ${name}]\n${bounded(record.arguments ?? record.input ?? record.code)}`;
  }
  if (type === 'tool_result' || type === 'tool-result') return `[tool]\n${bounded(record.result ?? record.output ?? content)}`;
  if (type === 'compaction' || type === 'compact') return `[system]\n[compaction]\n${bounded(record.summary ?? content)}`;
  if (type === 'error') return `[system]\n[error]\n${bounded(record.error ?? record.message ?? content)}`;
  return undefined;
}

export const primeAgentAdapter: ConversationTranscriptAdapter = {
  name: 'prime-agent',
  supportsPlainForkAsSource: false,
  supportsSourceAuthoredHandoff: false,

  async resolveSessionFile(conv) {
    const sessionDir = join(getOverdeckHome(), 'agents', conv.tmuxSession, 'prime-sessions');
    if (!existsSync(sessionDir)) return null;
    const files = (await readdir(sessionDir)).filter(file => file.endsWith('.jsonl')).sort();
    return files.length ? join(sessionDir, files.at(-1)!) : null;
  },

  async serializeTranscript(sessionFile, options) {
    const includeThinking = options?.includeThinking ?? true;
    const records = (await readFile(sessionFile, 'utf8')).split('\n');
    const parts: string[] = [];
    for (const line of records) {
      if (!line.trim()) continue;
      try {
        const serialized = serializePrimeRecord(JSON.parse(line) as Record<string, unknown>, includeThinking);
        if (serialized) parts.push(serialized);
      } catch { /* Ignore partial trailing records. */ }
    }
    return parts.join('\n\n');
  },

  async compactSummary(sessionFile, options) {
    const serialized = await primeAgentAdapter.serializeTranscript(sessionFile, options);
    if (!serialized.trim()) return { summary: '', summaryModel: null };
    const summary = await summarizeSerializedText(serialized, {
      model: options?.model,
      richMode: options?.richMode ?? false,
      harness: options?.harness ?? 'claude-code',
      timeoutMs: options?.timeoutMs,
    });
    return { summary, summaryModel: options?.model ?? null };
  },
};
