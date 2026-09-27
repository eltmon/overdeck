/**
 * PAN-4222 WI-8 — detecting a provider error at the end of a Claude Code
 * transcript, and never mistaking a normal reply for one (the conv-3870
 * trap: a reply whose own text mentions billing/credits is not an error).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerErrorFromTranscriptTail, readConversationProviderError } from '../conversation-provider-error.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pan-4222-provider-error-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, records: ReadonlyArray<unknown>): string {
  const path = join(dir, name);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return path;
}

function textOf(text: string): ReadonlyArray<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }];
}

const errorRecord = {
  type: 'assistant',
  timestamp: '2026-09-25T22:00:00.000Z',
  isApiErrorMessage: true,
  apiErrorStatus: 402,
  error: 'billing_error',
  message: { role: 'assistant', content: textOf('Your account has insufficient credits.') },
};

describe('providerErrorFromTranscriptTail', () => {
  it('ac1: returns the message, status, code and timestamp of a tail-ending api-error record', () => {
    const text = `${JSON.stringify(errorRecord)}\n`;
    expect(providerErrorFromTranscriptTail(text, false)).toEqual({
      message: 'Your account has insufficient credits.',
      at: '2026-09-25T22:00:00.000Z',
      status: 402,
      code: 'billing_error',
    });
  });

  it('ac2: still returns the error past trailing system and attachment records', () => {
    const lines = [
      errorRecord,
      { type: 'attachment', timestamp: '2026-09-25T22:00:05.000Z' },
      { type: 'system', timestamp: '2026-09-25T22:00:10.000Z' },
    ];
    const text = lines.map((record) => JSON.stringify(record)).join('\n');
    expect(providerErrorFromTranscriptTail(text, false)).toMatchObject({ code: 'billing_error' });
  });

  it('ac3: returns null once a user record follows the error', () => {
    const lines = [
      errorRecord,
      { type: 'user', timestamp: '2026-09-25T22:01:00.000Z', message: { role: 'user', content: 'Try again' } },
    ];
    const text = lines.map((record) => JSON.stringify(record)).join('\n');
    expect(providerErrorFromTranscriptTail(text, false)).toBeNull();
  });

  it('ac4: a normal reply mentioning billing/credits (conv-3870 shape) is not an error', () => {
    const normal = {
      type: 'assistant',
      timestamp: '2026-09-25T22:00:00.000Z',
      message: { role: 'assistant', content: textOf('OpenCode credits insufficient balance — see the docs for how to top up.') },
    };
    const text = `${JSON.stringify(normal)}\n`;
    expect(providerErrorFromTranscriptTail(text, false)).toBeNull();
  });

  it('skips sidechain (subagent) records when walking backward', () => {
    const lines = [
      errorRecord,
      { type: 'assistant', isSidechain: true, timestamp: '2026-09-25T22:00:05.000Z', message: { role: 'assistant', content: textOf('subagent note') } },
    ];
    const text = lines.map((record) => JSON.stringify(record)).join('\n');
    expect(providerErrorFromTranscriptTail(text, false)).toMatchObject({ code: 'billing_error' });
  });

  it('drops the first line when the read started mid-file', () => {
    const torn = '{"type":"user","message":{"content"'; // a cut write, no closing brace
    const text = `${torn}\n${JSON.stringify(errorRecord)}\n`;
    expect(providerErrorFromTranscriptTail(text, true)).toMatchObject({ code: 'billing_error' });
  });

  it('truncates the message to 200 characters', () => {
    const long = { ...errorRecord, message: { role: 'assistant', content: textOf('x'.repeat(300)) } };
    const result = providerErrorFromTranscriptTail(`${JSON.stringify(long)}\n`, false);
    expect(result?.message).toHaveLength(200);
  });

  it('returns null for an empty transcript', () => {
    expect(providerErrorFromTranscriptTail('', false)).toBeNull();
  });
});

describe('readConversationProviderError', () => {
  it('ac5: resolves null for a missing file', async () => {
    expect(await readConversationProviderError(join(dir, 'does-not-exist.jsonl'))).toBeNull();
  });

  it('reads the error from a real file on disk', async () => {
    const path = write('session.jsonl', [errorRecord]);
    expect(await readConversationProviderError(path)).toMatchObject({ code: 'billing_error', status: 402 });
  });

  it('resolves null for a normal, error-free transcript', async () => {
    const normal = { type: 'assistant', timestamp: '2026-09-25T22:00:00.000Z', message: { role: 'assistant', content: textOf('All done.') } };
    const path = write('session.jsonl', [normal]);
    expect(await readConversationProviderError(path)).toBeNull();
  });
});
