import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockReaddir = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  stat: mockStat,
  readdir: mockReaddir,
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
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 10_000, birthtimeMs: Date.now() - 10_000 });
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
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1_000, birthtimeMs: Date.now() - 1_000 });

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
