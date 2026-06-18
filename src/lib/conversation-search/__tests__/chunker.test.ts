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

function jsonStringPayload(text: string): string {
  return JSON.stringify(text).slice(1, -1);
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

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-1', projectId: 'overdeck' });

    expect(chunks).toEqual([
      expect.objectContaining({
        sessionId: 'sess-1',
        projectId: 'overdeck',
        role: 'user',
        ts: '2026-06-02T01:00:00.000Z',
        charLength: Buffer.byteLength('hello from user', 'utf8'),
        text: 'hello from user',
      }),
      expect.objectContaining({
        sessionId: 'sess-1',
        projectId: 'overdeck',
        role: 'assistant',
        ts: '2026-06-02T01:00:01.000Z',
        charLength: Buffer.byteLength('assistant reply', 'utf8'),
        text: 'assistant reply',
      }),
    ]);
    for (const chunk of chunks) {
      expect(sourceSlice(filePath, chunk.byteOffset, chunk.charLength)).toBe(jsonStringPayload(chunk.text));
    }
  });

  it('tracks raw source byte spans for escaped JSON string content', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'escaped.jsonl');
    const text = 'line one\nquoted "value" and backslash \\ done';
    writeFileSync(filePath, line(message('assistant', text, '2026-06-02T01:00:00.000Z')));

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-escaped', projectId: 'overdeck' });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(text);
    expect(sourceSlice(filePath, chunks[0]!.byteOffset, chunks[0]!.charLength)).toBe(jsonStringPayload(text));
  });

  it('anchors offsets to the message content leaf when text collides with earlier metadata', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'collision.jsonl');
    const entry = {
      type: 'assistant',
      timestamp: '2026-06-02T01:00:00.000Z',
      summary: 'text',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'text' }],
      },
    };
    writeFileSync(filePath, line(entry));

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-collision', projectId: 'overdeck' });

    expect(chunks).toHaveLength(1);
    expect(sourceSlice(filePath, chunks[0]!.byteOffset, chunks[0]!.charLength)).toBe(jsonStringPayload('text'));
    expect(chunks[0]!.byteOffset).toBeGreaterThan(readFileSync(filePath, 'utf8').indexOf('summary'));
  });

  it('does not index tool-result content that has no chat-message target', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'tool-result.jsonl');
    const entry = {
      type: 'assistant',
      timestamp: '2026-06-02T01:00:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_result', content: 'tool output only' },
          { type: 'text', text: 'assistant text' },
        ],
      },
    };
    const topLevelToolResult = {
      type: 'tool_result',
      timestamp: '2026-06-02T01:00:01.000Z',
      message: { role: 'tool_result', content: 'top-level tool output' },
    };
    writeFileSync(filePath, line(entry) + line(topLevelToolResult));

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-tool-result', projectId: 'overdeck' });

    expect(chunks.map((chunk) => chunk.text)).toEqual(['assistant text']);
  });

  it('emits multipart text leaves as separate source-contiguous chunks', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'multipart.jsonl');
    const entry = {
      type: 'assistant',
      timestamp: '2026-06-02T01:00:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'first part' },
          { type: 'tool_use', name: 'noop' },
          { type: 'text', text: 'second part' },
        ],
      },
    };
    writeFileSync(filePath, line(entry));

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-multipart', projectId: 'overdeck' });

    expect(chunks.map((chunk) => chunk.text)).toEqual(['first part', 'second part']);
    for (const chunk of chunks) {
      expect(sourceSlice(filePath, chunk.byteOffset, chunk.charLength)).toBe(jsonStringPayload(chunk.text));
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

    const beforeAppend = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-append', projectId: 'overdeck' });

    const third = line(message('user', 'third message', '2026-06-02T02:00:02.000Z'));
    appendFileSync(filePath, third);

    const afterAppend = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-append', projectId: 'overdeck' });
    const appendedOnly = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-append', projectId: 'overdeck', fromOffset: cursor });

    expect(afterAppend.slice(0, 2).map((chunk) => chunk.byteOffset)).toEqual(beforeAppend.map((chunk) => chunk.byteOffset));
    expect(appendedOnly).toEqual([
      expect.objectContaining({
        text: 'third message',
        charLength: Buffer.byteLength('third message', 'utf8'),
      }),
    ]);
    expect(sourceSlice(filePath, appendedOnly[0]!.byteOffset, appendedOnly[0]!.charLength)).toBe(jsonStringPayload('third message'));
  });

  it('ignores a trailing partial JSONL line until it is complete', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'partial.jsonl');
    const complete = line(message('user', 'complete message', '2026-06-02T03:00:00.000Z'));
    writeFileSync(filePath, `${complete}{"type":"assistant"`);

    const chunks = await chunkConversationJsonlFile({ filePath, sessionId: 'sess-partial', projectId: 'overdeck' });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('complete message');
  });
});
