/** PAN-3920 — the model a transcript last ran on, read from its tail. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTranscriptModel } from '../../../../src/lib/conversations/transcript-model.js';

let dir: string;
const lines = (...records: unknown[]) => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'transcript-model-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('readTranscriptModel', () => {
  it('reads the newest Claude assistant model, skipping synthetic records', async () => {
    const file = join(dir, 'agent-a1.jsonl');
    writeFileSync(file, lines(
      { type: 'assistant', message: { model: 'claude-sonnet-5', content: [] } },
      { type: 'assistant', message: { model: 'claude-haiku-5', content: [] } },
      { type: 'assistant', message: { model: '<synthetic>', content: [] } },
      { type: 'user', message: { content: 'x' } },
    ));
    expect(await readTranscriptModel(file, 1)).toBe('claude-haiku-5');
  });

  it('reads a Codex turn_context model', async () => {
    const file = join(dir, 'rollout-x.jsonl');
    writeFileSync(file, lines({ type: 'session_meta', payload: { id: 't' } }, { type: 'turn_context', payload: { model: 'gpt-5.5' } }));
    expect(await readTranscriptModel(file, 1)).toBe('gpt-5.5');
  });

  it('answers null for a transcript without a model or a missing file', async () => {
    const file = join(dir, 'empty.jsonl');
    writeFileSync(file, lines({ type: 'user', message: { content: 'hi' } }));
    expect(await readTranscriptModel(file, 1)).toBeNull();
    expect(await readTranscriptModel(join(dir, 'missing.jsonl'), null)).toBeNull();
  });

  it('re-reads only when the mtime changes', async () => {
    const file = join(dir, 'changing.jsonl');
    writeFileSync(file, lines({ type: 'assistant', message: { model: 'claude-sonnet-5' } }));
    expect(await readTranscriptModel(file, 1)).toBe('claude-sonnet-5');
    writeFileSync(file, lines({ type: 'assistant', message: { model: 'claude-opus-5-5' } }));
    expect(await readTranscriptModel(file, 1)).toBe('claude-sonnet-5');
    expect(await readTranscriptModel(file, 2)).toBe('claude-opus-5-5');
  });
});
