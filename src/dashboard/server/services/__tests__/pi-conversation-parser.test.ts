import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import { isPiSessionFile, parsePiConversationMessages } from '../pi-conversation-parser.js';

describe('isPiSessionFile (PAN-1908)', () => {
  const ROOT = '/home/u/.overdeck/agents/agent-pan-1908';

  it('matches a conversation transcript in the sessions/ subdir', () => {
    expect(isPiSessionFile(`${ROOT}/sessions/2026-06-15T01-00-00-000Z_abc.jsonl`)).toBe(true);
  });

  it('matches a work-agent transcript written at the agent-dir ROOT', () => {
    // The regression: work agents write `<iso-ts>_<id>.jsonl` directly under
    // agents/<id>/, so it must be recognized as a pi file (not parsed with the
    // claude-code parser, which produced an empty "How can I help you?" panel).
    expect(isPiSessionFile(`${ROOT}/2026-06-15T06-43-53-944Z_019eca05-bbd8.jsonl`)).toBe(true);
  });

  it('does NOT match sibling non-transcript JSONLs at the root', () => {
    expect(isPiSessionFile(`${ROOT}/cost-events.jsonl`)).toBe(false);
    expect(isPiSessionFile(`${ROOT}/activity.jsonl`)).toBe(false);
  });

  it('does NOT match a claude-code project transcript', () => {
    expect(isPiSessionFile('/home/u/.claude/projects/-home-u-proj/9d08794c-3973.jsonl')).toBe(false);
  });
});

describe('parsePiConversationMessages — tool-call join', () => {
  const fixture = join(__dirname, 'pi-conversation-parser.fixture.jsonl');

  it('joins toolCall name + arguments into the toolResult work-log entry', async () => {
    const result = await parsePiConversationMessages(fixture);

    // bash call → entry carries the tool name and structured arguments
    const bash = result.workLog.find((e) => e.toolTitle === 'bash');
    expect(bash).toBeDefined();
    expect(bash!.tone).toBe('tool');
    expect(bash!.toolInput).toEqual({ command: 'ls src' });
    expect(bash!.result).toBe('file-a.ts\nfile-b.ts');
    // collapsed-row summary comes from the bash case (first command line)
    expect(bash!.detail).toBe('ls src');
    // label is the tool name, not the generic 'Tool result'
    expect(bash!.label).toBe('bash');
  });

  it('marks failed tool results with the error tone', async () => {
    const result = await parsePiConversationMessages(fixture);
    const edit = result.workLog.find((e) => e.toolTitle === 'edit');
    expect(edit).toBeDefined();
    expect(edit!.tone).toBe('error');
    expect(edit!.toolInput).toMatchObject({ path: '/repo/src/file-a.ts' });
    expect(edit!.result).toBe('oldText not found');
  });

  it('flushes orphaned toolCall blocks that never received a result', async () => {
    const result = await parsePiConversationMessages(fixture);
    const orphan = result.workLog.find((e) => e.id === 'tool-call-call_orphan');
    expect(orphan).toBeDefined();
    expect(orphan!.toolTitle).toBe('read');
    expect(orphan!.toolInput).toEqual({ path: '/repo/src/file-b.ts' });
    expect(orphan!.result).toBeUndefined();
  });

  it('still emits user/assistant messages and skips pure-toolCall empty text', async () => {
    const result = await parsePiConversationMessages(fixture);
    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'assistant', 'assistant']);
    expect(result.messages.map((m) => m.text)).toContain('reading the dir');
  });
});
