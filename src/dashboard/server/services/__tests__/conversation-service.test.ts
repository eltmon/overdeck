import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockReaddir = vi.fn();
const mockOpen = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  stat: mockStat,
  readdir: mockReaddir,
  open: mockOpen,
  watch: vi.fn(() => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) })),
}));

vi.mock('node:os', () => ({ homedir: () => '/home/testuser' }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJsonlLine(obj: object): string {
  return JSON.stringify(obj);
}

function makeBuffer(lines: object[]): Buffer {
  return Buffer.from(lines.map((l) => makeJsonlLine(l)).join('\n') + '\n');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseConversationMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default stat: file was modified 10 seconds ago (not streaming)
    mockStat.mockImplementation(async () => {
      const buf = await mockReadFile();
      return { mtimeMs: Date.now() - 10_000, birthtimeMs: Date.now() - 10_000, size: buf.length };
    });
    // Mock open to read from the buffer returned by mockReadFile at the given position
    mockOpen.mockImplementation(async () => {
      const buffer = await mockReadFile();
      return {
        read: (buf: Buffer, offset: number, length: number, position: number) => {
          const toCopy = Math.min(length, Math.max(0, buffer.length - position));
          if (toCopy > 0) {
            buffer.copy(buf, offset, position, position + toCopy);
          }
          return Promise.resolve({ bytesRead: toCopy, buffer: buf });
        },
        close: () => Promise.resolve(),
      };
    });
  });

  it('returns empty result for an empty file', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(''));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages).toEqual([]);
    expect(result.workLog).toEqual([]);
    expect(result.streaming).toBe(false);
    expect(result.byteOffset).toBe(0);
  });

  it('parses a user text message', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'u-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'text', text: 'Hello, Claude!' }],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'u-1',
      role: 'user',
      text: 'Hello, Claude!',
    });
    expect(result.workLog).toEqual([]);
  });

  it('joins multiple text blocks in a single user entry with newlines', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'u-multiline',
        timestamp: '2024-01-01T00:00:00.000Z',
        message: {
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
            { type: 'text', text: 'line three' },
          ],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'u-multiline',
      role: 'user',
      text: 'line one\nline two\nline three',
    });
    expect(result.workLog).toEqual([]);
  });

  it('parses an assistant text message', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-abc',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! How can I help?' }],
          stop_reason: 'end_turn',
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'msg-abc',
      role: 'assistant',
      text: 'Hello! How can I help?',
    });
    expect(result.workLog).toEqual([]);
    expect(result.streaming).toBe(false);
  });

  it('keeps distinct assistant events separate when they reuse the same message.id', async () => {
    const lines = [
      {
        type: 'assistant',
        uuid: 'asst-1',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'resp-shared',
          role: 'assistant',
          content: [{ type: 'text', text: 'First assistant event' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'assistant',
        uuid: 'asst-2',
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          id: 'resp-shared',
          role: 'assistant',
          content: [{ type: 'text', text: 'Second assistant event' }],
          stop_reason: 'end_turn',
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((message) => message.id)).toEqual(['asst-1', 'asst-2']);
    expect(result.messages.map((message) => message.text)).toEqual([
      'First assistant event',
      'Second assistant event',
    ]);
  });

  it('marks assistant message as streaming when no stop_reason and file is fresh', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-stream',
          role: 'assistant',
          content: [{ type: 'text', text: 'Thinking...' }],
          stop_reason: null,
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));
    // File was modified 1 second ago — within the 5s streaming window
    mockStat.mockImplementation(async () => {
      const buf = await mockReadFile();
      return { mtimeMs: Date.now() - 1_000, birthtimeMs: Date.now() - 1_000, size: buf.length };
    });

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages[0]).toMatchObject({ role: 'assistant', streaming: true });
    expect(result.streaming).toBe(true);
  });

  it('does NOT mark as streaming when stop_reason is present', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-done',
          role: 'assistant',
          content: [{ type: 'text', text: 'Done!' }],
          stop_reason: 'end_turn',
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1_000, birthtimeMs: Date.now() - 1_000 });

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.streaming).toBe(false);
  });

  it('summarizes a user-last conversation as working', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'u-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'text', text: 'Keep going' }],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { summarizeConversationActivity } = await import('../conversation-service.js');
    const result = await summarizeConversationActivity('/fake/session.jsonl');

    expect(result.streaming).toBe(false);
    expect(result.isWorking).toBe(true);
  });

  it('summarizes a completed assistant-last conversation as idle', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-done',
          role: 'assistant',
          content: [{ type: 'text', text: 'All set' }],
          stop_reason: 'end_turn',
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { summarizeConversationActivity } = await import('../conversation-service.js');
    const result = await summarizeConversationActivity('/fake/session.jsonl');

    expect(result.isWorking).toBe(false);
  });

  it('creates WorkLogEntry for tool_use and completes it on tool_result', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-id-1', name: 'Bash', input: { command: 'ls' } },
          ],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'user',
        uuid: 'u-2',
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-id-1', content: 'file1.ts\nfile2.ts', is_error: false },
          ],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.workLog).toHaveLength(1);
    expect(result.workLog[0]).toMatchObject({
      id: 'tool-id-1',
      label: 'Bash',
      tone: 'tool',
      toolTitle: 'Bash',
    });
    // No extra user messages from tool_result blocks
    expect(result.messages).toHaveLength(0);
  });

  it('marks tool result as error tone when is_error is true', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-1',
          content: [
            { type: 'tool_use', id: 'tool-err-1', name: 'Bash', input: { command: 'bad-cmd' } },
          ],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'user',
        uuid: 'u-2',
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-err-1', content: 'command not found', is_error: true },
          ],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.workLog[0]).toMatchObject({ id: 'tool-err-1', tone: 'error' });
  });

  it('skips malformed JSON lines without crashing', async () => {
    const content = Buffer.from(
      'not-json\n' +
      JSON.stringify({ type: 'user', uuid: 'u-ok', timestamp: '2024-01-01T00:00:00.000Z', message: { content: [{ type: 'text', text: 'ok' }] } }) + '\n',
    );
    mockReadFile.mockResolvedValue(content);

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ text: 'ok' });
  });

  it('performs incremental parsing from a byte offset', async () => {
    const firstLine = makeJsonlLine({
      type: 'user',
      uuid: 'u-1',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: { content: [{ type: 'text', text: 'First message' }] },
    });
    const secondLine = makeJsonlLine({
      type: 'user',
      uuid: 'u-2',
      timestamp: '2024-01-01T00:00:01.000Z',
      message: { content: [{ type: 'text', text: 'Second message' }] },
    });
    const fullContent = firstLine + '\n' + secondLine + '\n';
    mockReadFile.mockResolvedValue(Buffer.from(fullContent));

    const { parseConversationMessages } = await import('../conversation-service.js');

    // Parse from offset = length of first line + newline
    const offset = Buffer.byteLength(firstLine + '\n');
    const result = await parseConversationMessages('/fake/session.jsonl', offset);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: 'u-2', text: 'Second message' });
  });

  it('pairs parallel tool calls when tool_results arrive in reverse order', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-a', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use', id: 'tool-b', name: 'Read', input: { file: 'foo.ts' } },
          ],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'user',
        uuid: 'u-2',
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-b', content: 'content of foo.ts', is_error: false },
            { type: 'tool_result', tool_use_id: 'tool-a', content: 'file1.ts\nfile2.ts', is_error: false },
          ],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.workLog).toHaveLength(2);
    const ids = result.workLog.map((w) => w.id);
    expect(ids).toContain('tool-a');
    expect(ids).toContain('tool-b');
    // Both should have results
    expect(result.workLog.every((w) => w.result !== undefined)).toBe(true);
  });

  it('pairs tool_result that appears before its tool_use in the file', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'u-1',
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-early', content: 'early result', is_error: false },
          ],
        },
      },
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-early', name: 'Bash', input: { command: 'echo early' } },
          ],
          stop_reason: 'tool_use',
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.workLog).toHaveLength(1);
    expect(result.workLog[0]).toMatchObject({
      id: 'tool-early',
      label: 'Bash',
      result: 'early result',
    });
  });

  it('pairs tool_use and tool_result across incremental parse calls via state persistence', async () => {
    const assistantLine = makeJsonlLine({
      type: 'assistant',
      timestamp: '2024-01-01T00:00:01.000Z',
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-incr', name: 'Bash', input: { command: 'ls' } },
        ],
        stop_reason: 'tool_use',
      },
    });
    const userLine = makeJsonlLine({
      type: 'user',
      uuid: 'u-2',
      timestamp: '2024-01-01T00:00:02.000Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-incr', content: 'result!', is_error: false },
        ],
      },
    });

    // First read: only assistant line
    mockReadFile.mockResolvedValue(Buffer.from(assistantLine + '\n'));
    const { parseConversationMessages } = await import('../conversation-service.js');
    const firstResult = await parseConversationMessages('/fake/session.jsonl', 0, {
      pendingToolUse: new Map(),
      unresolvedResults: new Map(),
      lastSequence: 0,
    });
    expect(firstResult.workLog).toHaveLength(0); // not flushed on incremental
    expect(firstResult.pendingToolUse.has('tool-incr')).toBe(true);

    // Second read: both lines (simulate file append)
    mockReadFile.mockResolvedValue(Buffer.from(assistantLine + '\n' + userLine + '\n'));
    const offset = Buffer.byteLength(assistantLine + '\n');
    const secondResult = await parseConversationMessages('/fake/session.jsonl', offset, {
      pendingToolUse: firstResult.pendingToolUse,
      unresolvedResults: firstResult.unresolvedResults,
      lastSequence: firstResult.lastSequence,
    });

    expect(secondResult.workLog).toHaveLength(1);
    expect(secondResult.workLog[0]).toMatchObject({
      id: 'tool-incr',
      result: 'result!',
    });
  });

  it('uses sequence as tiebreaker when timestamps are identical', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'u-c',
        timestamp: '2024-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'text', text: 'Third' }],
        },
      },
      {
        type: 'user',
        uuid: 'u-a',
        timestamp: '2024-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'text', text: 'First' }],
        },
      },
      {
        type: 'user',
        uuid: 'u-b',
        timestamp: '2024-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'text', text: 'Second' }],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    expect(result.messages.map((m) => m.text)).toEqual(['Third', 'First', 'Second']);
    expect(result.messages.map((m) => m.sequence)).toEqual([0, 1, 2]);
  });

  it('maintains stable ordering across a compact boundary', async () => {
    const lines = [
      { type: 'system', subtype: 'compact_boundary', timestamp: '2024-01-01T00:00:00.000Z' },
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-after',
          role: 'assistant',
          content: [{ type: 'text', text: 'After compact' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'user',
        uuid: 'u-after',
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          content: [{ type: 'text', text: 'User after compact' }],
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));

    const { parseFromLastCompactBoundary } = await import('../conversation-service.js');
    const result = await parseFromLastCompactBoundary('/fake/session.jsonl');

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({ role: 'assistant', text: 'After compact' });
    expect(result.messages[1]).toMatchObject({ role: 'user', text: 'User after compact' });
  });

  it('correctly orders a real mis-ordered session fixture', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const fixturePath = join(fileURLToPath(import.meta.url), '../../__fixtures__/misordered-session.jsonl');
    const fixture = readFileSync(fixturePath);
    mockReadFile.mockResolvedValue(fixture);

    const { parseConversationMessages } = await import('../conversation-service.js');
    const result = await parseConversationMessages('/fake/session.jsonl');

    // Messages should be in terminal order (by timestamp, sequence tiebreaker)
    const messageTexts = result.messages.map((m) => m.text);
    expect(messageTexts).toEqual([
      'List the files in the current directory',
      "I'll list the files for you.",
      'Now show me the contents of package.json',
      'Here is the package.json content.',
      'Done!',
    ]);

    // WorkLog entries should be paired and ordered
    expect(result.workLog).toHaveLength(2);
    expect(result.workLog[0]).toMatchObject({ id: 'tool-bash-1', label: 'Bash', result: 'package.json\nsrc/\nREADME.md\n' });
    expect(result.workLog[1]).toMatchObject({ id: 'tool-read-1', label: 'Read' });

    // Sequence should be monotonically increasing in emission order
    const sequences = result.messages.map((m) => m.sequence);
    expect(sequences).toEqual([0, 2, 3, 4, 6]);
  });

  it('does not advance byteOffset past a partial trailing line on incremental read', async () => {
    const firstLine = makeJsonlLine({
      type: 'user',
      uuid: 'u-1',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: { content: [{ type: 'text', text: 'First message' }] },
    });
    const secondLine = makeJsonlLine({
      type: 'user',
      uuid: 'u-2',
      timestamp: '2024-01-01T00:00:01.000Z',
      message: { content: [{ type: 'text', text: 'Second message' }] },
    });
    // First read: two complete lines + partial third line (no trailing newline)
    const partialThird = JSON.stringify({
      type: 'user',
      uuid: 'u-3',
      timestamp: '2024-01-01T00:00:02.000Z',
      message: { content: [{ type: 'text', text: 'Partial' }] },
    });
    const firstRead = firstLine + '\n' + secondLine + '\n' + partialThird;
    mockReadFile.mockResolvedValue(Buffer.from(firstRead));
    mockStat.mockImplementation(async () => {
      const buf = await mockReadFile();
      return { mtimeMs: Date.now() - 1_000, birthtimeMs: Date.now() - 1_000, size: buf.length };
    });

    const { parseConversationMessages } = await import('../conversation-service.js');
    const firstResult = await parseConversationMessages('/fake/session.jsonl', 0, {
      pendingToolUse: new Map(),
      unresolvedResults: new Map(),
      lastSequence: 0,
    });

    // Should parse only the two complete lines
    expect(firstResult.messages).toHaveLength(2);
    expect(firstResult.byteOffset).toBe(Buffer.byteLength(firstLine + '\n' + secondLine + '\n'));

    // Second read: partial line is now complete (newline appended)
    const secondRead = firstLine + '\n' + secondLine + '\n' + partialThird + '\n';
    mockReadFile.mockResolvedValue(Buffer.from(secondRead));

    const secondResult = await parseConversationMessages('/fake/session.jsonl', firstResult.byteOffset, {
      pendingToolUse: firstResult.pendingToolUse,
      unresolvedResults: firstResult.unresolvedResults,
      lastSequence: firstResult.lastSequence,
    });

    // Should now parse the previously partial line
    expect(secondResult.messages).toHaveLength(1);
    expect(secondResult.messages[0]).toMatchObject({ id: 'u-3', text: 'Partial' });
    expect(secondResult.byteOffset).toBe(Buffer.byteLength(secondRead));
  });

  it('does not report stale currentTool when file has not been modified recently', async () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2024-01-01T00:00:01.000Z',
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
          ],
          stop_reason: 'tool_use',
        },
      },
    ];
    mockReadFile.mockResolvedValue(makeBuffer(lines));
    // File modified 60 seconds ago — well past the 30s stale threshold
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60_000, birthtimeMs: Date.now() - 60_000, size: (await mockReadFile()).length });

    const { summarizeConversationActivity } = await import('../conversation-service.js');
    const result = await summarizeConversationActivity('/fake/session.jsonl');

    expect(result.currentTool).toBeNull();
    expect(result.isWorking).toBe(true);
  });
});

describe('discoverSessionFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the path of a newly created JSONL file on first poll', async () => {
    // Snapshot has no files; new file appears on first poll
    const existingFiles = new Set<string>();
    mockReaddir.mockResolvedValue(['session-abc123.jsonl']);

    const { discoverSessionFile } = await import('../conversation-service.js');
    const result = await discoverSessionFile('/home/testuser/Projects/foo', existingFiles);

    expect(result).toContain('session-abc123.jsonl');
    expect(result).toContain('-home-testuser-Projects-foo');
  });

  it('ignores files that were in the pre-spawn snapshot', async () => {
    // old-session.jsonl existed before spawn — should be ignored
    const existingFiles = new Set(['old-session.jsonl']);
    // First poll: only the old file. Second poll: new file appears.
    let callCount = 0;
    mockReaddir.mockImplementation(async () => {
      callCount++;
      if (callCount <= 1) return ['old-session.jsonl'];
      return ['old-session.jsonl', 'new-session.jsonl'];
    });

    const { discoverSessionFile } = await import('../conversation-service.js');
    const result = await discoverSessionFile('/home/testuser/Projects/foo', existingFiles);
    expect(result).toContain('new-session.jsonl');
  });

  it('ignores non-jsonl files and returns a jsonl file when present', async () => {
    const existingFiles = new Set<string>();
    mockReaddir.mockResolvedValue(['README.md', 'notes.txt', 'session-xyz.jsonl']);

    const { discoverSessionFile } = await import('../conversation-service.js');
    const result = await discoverSessionFile('/home/testuser/Projects/foo', existingFiles);

    expect(result).toContain('session-xyz.jsonl');
    expect(result).not.toContain('README.md');
  });

  it('uses the encoded cwd as the project directory name', async () => {
    const existingFiles = new Set<string>();
    mockReaddir.mockResolvedValue(['session.jsonl']);

    const { discoverSessionFile } = await import('../conversation-service.js');
    const result = await discoverSessionFile('/home/user/my/project', existingFiles);

    // CWD /home/user/my/project → encoded as -home-user-my-project
    expect(result).toContain('-home-user-my-project');
  });
});
