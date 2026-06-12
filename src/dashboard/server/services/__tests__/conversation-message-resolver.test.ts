import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveConversationMessageLocator } from '../conversation-message-resolver.js';

let tmpDir: string | undefined;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-message-resolver-'));
  return tmpDir;
}

function line(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

function message(uuid: string, role: string, text: string, timestamp: string): unknown {
  return {
    type: role,
    uuid,
    timestamp,
    message: {
      role,
      content: [{ type: 'text', text }],
    },
  };
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('resolveConversationMessageLocator', () => {
  it('maps a byte offset inside a JSONL message line to the rendered message id and index', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session.jsonl');
    const first = line(message('msg-user', 'user', 'first message', '2026-06-02T01:00:00.000Z'));
    const second = line(message('msg-assistant', 'assistant', 'assistant reply', '2026-06-02T01:00:01.000Z'));
    writeFileSync(filePath, first + second);

    const locator = await resolveConversationMessageLocator(filePath, Buffer.byteLength(first, 'utf8') + 10);

    expect(locator).toEqual({
      messageId: 'msg-assistant',
      messageIndex: 1,
      sequence: 1,
      byteOffset: Buffer.byteLength(first, 'utf8') + 10,
    });
  });

  it('returns null for offsets outside the file or non-rendered lines', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session.jsonl');
    const toolLine = line({ type: 'system', timestamp: '2026-06-02T01:00:00.000Z' });
    writeFileSync(filePath, toolLine);

    await expect(resolveConversationMessageLocator(filePath, 9999)).resolves.toBeNull();
    await expect(resolveConversationMessageLocator(filePath, 0)).resolves.toBeNull();
  });
});
