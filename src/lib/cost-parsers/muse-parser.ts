/** Muse Code 1.0.2 session envelopes. Only committed run events contribute usage. */
import { basename, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { getPricingSync } from '../cost.js';
import type { SessionUsage } from './jsonl-parser.js';

export interface MuseEvent {
  kind?: string;
  prompt?: string;
  text?: string;
  message_id?: string;
  terminal?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cached_tokens?: number };
}

export interface MuseRecord {
  id?: string;
  recorded_at?: number;
  payload_type?: string;
  payload?: {
    kind?: string;
    run_id?: string;
    event?: MuseEvent;
    record?: { model_id?: string; workspace_root?: string };
  };
}

export function parseMuseRecords(raw: string): MuseRecord[] {
  const records: MuseRecord[] = [];
  for (const line of raw.split('\n')) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && value.payload_type) records.push(value);
    } catch { /* A live log can end in a partial record. */ }
  }
  return records;
}

export function museTimestamp(record: MuseRecord): string {
  return new Date((record.recorded_at ?? 0) / 1000).toISOString();
}

export function summarizeMuseRecords(records: MuseRecord[], sessionFile: string): SessionUsage | null {
  let model = '';
  let cwd: string | undefined;
  let messages = 0;
  let input = 0;
  let output = 0;
  let cached = 0;
  let reported = false;
  const seen = new Set<string>();
  for (const record of records) {
    if (record.id && seen.has(record.id)) continue;
    if (record.id) seen.add(record.id);
    if (record.payload_type === 'runtime.session.metadata') {
      model = record.payload?.record?.model_id ?? model;
      cwd = record.payload?.record?.workspace_root ?? cwd;
    }
    if (record.payload?.kind !== 'run') continue;
    const event = record.payload.event;
    if (event?.kind === 'started' || event?.kind === 'assistant_message_committed') messages++;
    if (event?.kind !== 'model_completed' || !event.usage) continue;
    const usage = event.usage;
    reported = true;
    const cache = Math.max(0, usage.cached_tokens ?? 0);
    cached += cache;
    input += Math.max(0, (usage.input_tokens ?? 0) - cache);
    output += Math.max(0, usage.output_tokens ?? 0);
  }
  if (!reported || !model) return null;
  const pricing = getPricingSync('custom', model);
  const cost = (input * (pricing?.inputPer1k ?? 0) + output * (pricing?.outputPer1k ?? 0) + cached * (pricing?.cacheReadPer1k ?? 0)) / 1000;
  return {
    sessionId: basename(dirname(sessionFile)), sessionFile, model, cwd,
    startTime: museTimestamp(records[0] ?? {}), endTime: museTimestamp(records.at(-1) ?? {}),
    messageCount: messages, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cached },
    cost, cost_v2: cost,
    modelBreakdown: { [model]: { cost, inputTokens: input, outputTokens: output, cacheReadTokens: cached, messageCount: messages } },
  };
}

export function parseMuseSessionSync(path: string): SessionUsage | null {
  try { return summarizeMuseRecords(parseMuseRecords(readFileSync(path, 'utf8')), path); }
  catch { return null; }
}
