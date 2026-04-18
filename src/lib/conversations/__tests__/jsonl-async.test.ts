import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSessionJsonl } from '../jsonl-async.js';

let fixtureDir: string;

// ─── Fixture JSONL content ────────────────────────────────────────────────────

const SAMPLE_LINES = [
  // First message — includes cwd
  JSON.stringify({
    sessionId: 'sess-abc',
    timestamp: '2025-01-01T10:00:00Z',
    cwd: '/home/user/Projects/myapp',
    message: { role: 'user', model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 0 } },
    content: [],
  }),
  // Assistant message with tool_use blocks
  JSON.stringify({
    sessionId: 'sess-abc',
    timestamp: '2025-01-01T10:01:00Z',
    message: { role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 0, output_tokens: 200 } },
    content: [
      { type: 'tool_use', name: 'Read', input: { file_path: '/home/user/Projects/myapp/src/index.ts' } },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/home/user/Projects/myapp/src/index.ts', old_string: 'foo', new_string: 'bar' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      { type: 'text', text: 'Done' },
    ],
  }),
  // Another user message
  JSON.stringify({
    sessionId: 'sess-abc',
    timestamp: '2025-01-01T10:05:00Z',
    message: { role: 'user', model: 'claude-sonnet-4-6', usage: { input_tokens: 50, output_tokens: 0 } },
    content: [],
  }),
  // Model switch to opus
  JSON.stringify({
    sessionId: 'sess-abc',
    timestamp: '2025-01-01T10:10:00Z',
    message: { role: 'assistant', model: 'claude-opus-4-6', usage: { input_tokens: 0, output_tokens: 300 } },
    content: [
      { type: 'tool_use', name: 'Write', input: { file_path: '/home/user/Projects/myapp/README.md' } },
    ],
  }),
];

beforeAll(() => {
  fixtureDir = join(tmpdir(), `pan-457-jsonl-test-${Date.now()}`);
  mkdirSync(fixtureDir, { recursive: true });
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('parseSessionJsonl', () => {
  it('parses message_count, timestamps, models, token totals from sample JSONL', async () => {
    const file = join(fixtureDir, 'sample.jsonl');
    writeFileSync(file, SAMPLE_LINES.join('\n') + '\n', 'utf8');

    const meta = await parseSessionJsonl(file);

    expect(meta.messageCount).toBe(4);
    expect(meta.firstTs).toBe('2025-01-01T10:00:00Z');
    expect(meta.lastTs).toBe('2025-01-01T10:10:00Z');
    expect(meta.tokenInput).toBe(150);   // 100 + 0 + 50 + 0
    expect(meta.tokenOutput).toBe(500);  // 0 + 200 + 0 + 300
    expect(meta.modelsUsed).toContain('claude-sonnet-4-6');
    expect(meta.modelsUsed).toContain('claude-opus-4-6');
    // sonnet appeared 3×, opus 1× → primaryModel = sonnet
    expect(meta.primaryModel).toBe('claude-sonnet-4-6');
  });

  it('extracts tools_used and files_touched; excludes Bash from files', async () => {
    const file = join(fixtureDir, 'tools.jsonl');
    writeFileSync(file, SAMPLE_LINES.join('\n') + '\n', 'utf8');

    const meta = await parseSessionJsonl(file);

    expect(meta.toolsUsed).toContain('Read');
    expect(meta.toolsUsed).toContain('Edit');
    expect(meta.toolsUsed).toContain('Bash');
    expect(meta.toolsUsed).toContain('Write');
    expect(meta.filesTouched).toContain('/home/user/Projects/myapp/src/index.ts');
    expect(meta.filesTouched).toContain('/home/user/Projects/myapp/README.md');
    // Bash command should NOT appear in filesTouched
    expect(meta.filesTouched).not.toContain('npm test');
  });

  it('reads cwd from first JSONL message when present', async () => {
    const file = join(fixtureDir, 'cwd.jsonl');
    writeFileSync(file, SAMPLE_LINES.join('\n') + '\n', 'utf8');

    const meta = await parseSessionJsonl(file);

    expect(meta.cwdFromFirstMessage).toBe('/home/user/Projects/myapp');
  });

  it('returns null cwdFromFirstMessage when cwd is absent', async () => {
    const noCwdLine = JSON.stringify({
      timestamp: '2025-01-01T00:00:00Z',
      message: { role: 'user', usage: { input_tokens: 1, output_tokens: 0 } },
    });
    const file = join(fixtureDir, 'nocwd.jsonl');
    writeFileSync(file, noCwdLine + '\n', 'utf8');

    const meta = await parseSessionJsonl(file);

    expect(meta.cwdFromFirstMessage).toBeNull();
  });

  it('handles empty JSONL without throwing — returns zero metadata', async () => {
    const file = join(fixtureDir, 'empty.jsonl');
    writeFileSync(file, '', 'utf8');

    const meta = await parseSessionJsonl(file);

    expect(meta.messageCount).toBe(0);
    expect(meta.firstTs).toBeNull();
    expect(meta.lastTs).toBeNull();
    expect(meta.tokenInput).toBe(0);
    expect(meta.tokenOutput).toBe(0);
    expect(meta.modelsUsed).toEqual([]);
    expect(meta.primaryModel).toBeNull();
    expect(meta.toolsUsed).toEqual([]);
    expect(meta.filesTouched).toEqual([]);
    expect(meta.cwdFromFirstMessage).toBeNull();
  });

  it('handles corrupt/partial JSONL without throwing — returns partial metadata', async () => {
    const corruptLines = [
      JSON.stringify({ timestamp: '2025-06-01T00:00:00Z', message: { usage: { input_tokens: 5, output_tokens: 0 } } }),
      '{bad json here',
      '',
      JSON.stringify({ timestamp: '2025-06-01T00:01:00Z', message: { usage: { input_tokens: 3, output_tokens: 2 } } }),
    ];
    const file = join(fixtureDir, 'corrupt.jsonl');
    writeFileSync(file, corruptLines.join('\n') + '\n', 'utf8');

    const meta = await parseSessionJsonl(file);

    // Two valid messages parsed; corrupt line skipped
    expect(meta.messageCount).toBe(2);
    expect(meta.tokenInput).toBe(8);
    expect(meta.tokenOutput).toBe(2);
    expect(meta.firstTs).toBe('2025-06-01T00:00:00Z');
    expect(meta.lastTs).toBe('2025-06-01T00:01:00Z');
  });

  it('handles non-existent file without throwing', async () => {
    const meta = await parseSessionJsonl('/no/such/file/at/all.jsonl');
    expect(meta.messageCount).toBe(0);
  });

  it('real transcript format: extracts tools from message.content (not top-level content)', async () => {
    // Real Claude Code JSONL has content in message.content, not at the top level
    const realFormatLines = [
      JSON.stringify({
        type: 'user',
        sessionId: 'real-sess-1',
        timestamp: '2025-04-01T09:00:00Z',
        cwd: '/home/user/Projects/realapp',
        message: { role: 'user', content: [{ type: 'text', text: 'Fix the bug' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'real-sess-1',
        timestamp: '2025-04-01T09:01:00Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/home/user/Projects/realapp/src/bug.ts' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/home/user/Projects/realapp/src/bug.ts', old_string: 'x', new_string: 'y' } },
          ],
          usage: { input_tokens: 200, output_tokens: 150 },
        },
      }),
    ];
    const file = join(fixtureDir, 'real-format.jsonl');
    writeFileSync(file, realFormatLines.join('\n') + '\n', 'utf8');

    const meta = await parseSessionJsonl(file);

    expect(meta.toolsUsed).toContain('Read');
    expect(meta.toolsUsed).toContain('Edit');
    expect(meta.filesTouched).toContain('/home/user/Projects/realapp/src/bug.ts');
    expect(meta.cwdFromFirstMessage).toBe('/home/user/Projects/realapp');
    expect(meta.tokenInput).toBe(200);
    expect(meta.tokenOutput).toBe(150);
  });
});
