import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_HOME: string;
let CONFIG_HOME: string;

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-compaction-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  CONFIG_HOME = join(tmpdir(), `pan-compaction-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(CONFIG_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = CONFIG_HOME;
  mkdirSync(join(CONFIG_HOME, '.panopticon'), { recursive: true });
  writeFileSync(
    join(CONFIG_HOME, '.panopticon', 'config.yaml'),
    [
      'conversations:',
      '  compaction_model: claude-haiku-4-5',
      '  manual_compact_mode: panopticon-native',
      '',
    ].join('\n')
  );
});

afterEach(() => {
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
  rmSync(CONFIG_HOME, { recursive: true, force: true });
});

describe('conversation compaction service', () => {
  it('appends a compact boundary and continuation summary', async () => {
    const sessionFile = join(TEST_HOME, 'session.jsonl');
    writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Fix the compact bug' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: '/tmp/file.ts' } }],
          usage: { input_tokens: 1200 },
        },
      }),
    ].join('\n') + '\n');

    const { compactConversationNative, shouldInterceptManualCompact } = await import('../../services/conversation-compaction.js');
    const result = await compactConversationNative(sessionFile);

    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.summary).toContain('This session is being continued from a previous conversation');
    expect(shouldInterceptManualCompact('/compact')).toBe(true);

    const finalContent = await import('node:fs/promises').then((fs) => fs.readFile(sessionFile, 'utf-8'));
    expect(finalContent).toContain('"subtype":"compact_boundary"');
    expect(finalContent).toContain('This session is being continued from a previous conversation');
  });
});
