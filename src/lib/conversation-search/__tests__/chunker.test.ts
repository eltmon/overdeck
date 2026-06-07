import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { chunkConversationJsonlFile, splitTextIntoWindows } from '../chunker.js';

let tmpDir: string | undefined;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-chunker-'));
  return tmpDir;
}

function line(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

function message(role: string, text: string, timestamp: string): unknown {
  return {
    type: role,
    timestamp,
    message: {
      role,
      content: [{ type: 'text', text }],
    },
  };
}

function sourceSlice(filePath: string, byteOffset: number, byteLength: number): string {
  const bytes = readFileSync(filePath);
  return bytes.subarray(byteOffset, byteOffset + byteLength).toString('utf8');
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('conversation JSONL chunker', () => {
  it('emits message-boundary records with session/project/role/timestamp fields', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session.jsonl');
    const first = line(message('user', 'hello from user', '2026-06-02T01:00:00.000Z'));
    const second = line(message('assistant', 'assistant reply', '2026-06-02T01:00:01.000Z'));
    writeFileSync(filePath, first + second);

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-1', projectId: 'panopticon-cli' });

    expect(chunks).toEqual([
      expect.objectContaining({
        sessionId: 'sess-1',
        projectId: 'panopticon-cli',
        role: 'user',
        ts: '2026-06-02T01:00:00.000Z',
        charLength: Buffer.byteLength('hello from user', 'utf8'),
        text: 'hello from user',
      }),
      expect.objectContaining({
        sessionId: 'sess-1',
        projectId: 'panopticon-cli',
        role: 'assistant',
        ts: '2026-06-02T01:00:01.000Z',
        charLength: Buffer.byteLength('assistant reply', 'utf8'),
        text: 'assistant reply',
      }),
    ]);
    for (const chunk of chunks) {
      expect(sourceSlice(filePath, chunk.byteOffset, chunk.charLength)).toBe(chunk.text);
    }
  });

  it('splits long text into overlapping approximate token windows', () => {
    const text = Array.from({ length: 12 }, (_, i) => `w${i}`).join(' ');

    const windows = splitTextIntoWindows(text, 5, 2);

    expect(windows.map((w) => w.text)).toEqual([
      'w0 w1 w2 w3 w4',
      'w3 w4 w5 w6 w7',
      'w6 w7 w8 w9 w10',
      'w9 w10 w11',
    ]);
    expect(windows.map((w) => w.tokenCount)).toEqual([5, 5, 5, 3]);
  });

  it('keeps earlier byte offsets stable after appends and can chunk only appended bytes', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'append.jsonl');
    const first = line(message('user', 'first message', '2026-06-02T02:00:00.000Z'));
    const second = line(message('assistant', 'second message', '2026-06-02T02:00:01.000Z'));
    writeFileSync(filePath, first + second);
    const cursor = Buffer.byteLength(first + second, 'utf8');

    const beforeAppend = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-append', projectId: 'panopticon-cli' });

    const third = line(message('user', 'third message', '2026-06-02T02:00:02.000Z'));
    appendFileSync(filePath, third);

    const afterAppend = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-append', projectId: 'panopticon-cli' });
    const appendedOnly = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-append', projectId: 'panopticon-cli', fromOffset: cursor });

    expect(afterAppend.slice(0, 2).map((chunk) => chunk.byteOffset)).toEqual(beforeAppend.map((chunk) => chunk.byteOffset));
    expect(appendedOnly).toEqual([
      expect.objectContaining({
        text: 'third message',
        charLength: Buffer.byteLength('third message', 'utf8'),
      }),
    ]);
    expect(sourceSlice(filePath, appendedOnly[0]!.byteOffset, appendedOnly[0]!.charLength)).toBe('third message');
  });

  it('ignores a trailing partial JSONL line until it is complete', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'partial.jsonl');
    const complete = line(message('user', 'complete message', '2026-06-02T03:00:00.000Z'));
    writeFileSync(filePath, `${complete}{"type":"assistant"`);

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-partial', projectId: 'panopticon-cli' });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('complete message');
  });
});
