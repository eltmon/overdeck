import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseConversationMessages } from '../parser.js';

// Landed record, agent idle (conv 2972 line 3401)
const LANDED_WRAPPED =
  '\n\n<pasted_content id="9469">\nSonnet 5.5 just released!! We need to add that and publish to NPM ASAP!\nFor the WSL related stuff, no.\n</pasted_content id="9469">\n';
const LANDED_WRAPPED_INNER =
  'Sonnet 5.5 just released!! We need to add that and publish to NPM ASAP!\nFor the WSL related stuff, no.';

// Queued prompt (line 1486 enqueue / 1493 queued_command attachment)
const QUEUED_WRAPPED =
  '<pasted_content id="9469">\n@/tmp/att/ef87.png\nGo ahead and do your recommended order, please.\n</pasted_content id="9469">';
const QUEUED_WRAPPED_INNER = '@/tmp/att/ef87.png\nGo ahead and do your recommended order, please.';

let testDir: string;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function makeTestDir(): string {
  testDir = mkdtempSync(join(tmpdir(), 'overdeck-parser-pasted-content-'));
  return testDir;
}

function userStringLine(text: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: '2026-01-01T00:00:00.000Z',
    uuid: `u-${Math.random().toString(36).slice(2)}`,
  });
}

function userArrayLine(text: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    timestamp: '2026-01-01T00:00:00.000Z',
    uuid: `u-${Math.random().toString(36).slice(2)}`,
  });
}

function queuedCommandLine(prompt: string): string {
  return JSON.stringify({
    type: 'attachment',
    uuid: `q-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    attachment: { type: 'queued_command', commandMode: 'prompt', prompt },
  });
}

describe('parseConversationMessages — pasted_content unwrap (PAN-4305)', () => {
  it('renders a landed string-content wrapped record as one tag-free user message', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, `${userStringLine(LANDED_WRAPPED)}\n`);

    const result = await parseConversationMessages(file, 0);

    const userMessages = result.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].text).toBe(LANDED_WRAPPED_INNER);
    expect(userMessages[0].text).not.toContain('pasted_content');
  });

  it('renders a landed array-content wrapped record as one tag-free user message', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, `${userArrayLine(LANDED_WRAPPED)}\n`);

    const result = await parseConversationMessages(file, 0);

    const userMessages = result.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].text).toBe(LANDED_WRAPPED_INNER);
    expect(userMessages[0].text).not.toContain('pasted_content');
  });

  it('renders a queued_command wrapped prompt as one tag-free user message', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, `${queuedCommandLine(QUEUED_WRAPPED)}\n`);

    const result = await parseConversationMessages(file, 0);

    const userMessages = result.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].text).toBe(QUEUED_WRAPPED_INNER);
    expect(userMessages[0].text).not.toContain('pasted_content');
  });
});
