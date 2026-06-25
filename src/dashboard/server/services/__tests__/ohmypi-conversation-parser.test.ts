import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import { isOhmypiSessionFile, parseOhmypiConversationMessages } from '../ohmypi-conversation-parser.js';

describe('isOhmypiSessionFile (PAN-1989)', () => {
  const ROOT = '/home/u/.overdeck/agents/agent-pan-1989';

  it('matches a conversation transcript in the sessions/ subdir', () => {
    expect(isOhmypiSessionFile(`${ROOT}/sessions/2026-06-23T01-00-00-000Z_abc.jsonl`)).toBe(true);
  });

  it('matches a work-agent transcript written at the agent-dir ROOT', () => {
    expect(isOhmypiSessionFile(`${ROOT}/2026-06-23T06-43-53-944Z_019ef4f8-6317.jsonl`)).toBe(true);
  });

  it('does NOT match sibling non-transcript JSONLs at the root', () => {
    expect(isOhmypiSessionFile(`${ROOT}/cost-events.jsonl`)).toBe(false);
    expect(isOhmypiSessionFile(`${ROOT}/activity.jsonl`)).toBe(false);
  });

  it('does NOT match a claude-code project transcript (AC: legacy pi paths still recognized)', () => {
    expect(isOhmypiSessionFile('/home/u/.claude/projects/-home-u-proj/9d08794c-3973.jsonl')).toBe(false);
  });
});

describe('parseOhmypiConversationMessages — tool-call join (PAN-1989)', () => {
  const fixture = join(__dirname, 'ohmypi-conversation-parser.fixture.jsonl');

  it('returns a non-empty message list and workLog from the real omp fixture (AC: PAN-1827 regression)', async () => {
    const result = await parseOhmypiConversationMessages(fixture);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('joins toolCall name into the toolResult work-log entry for the read tool', async () => {
    const result = await parseOhmypiConversationMessages(fixture);
    const readEntry = result.workLog.find((e) => e.toolTitle === 'read');
    expect(readEntry).toBeDefined();
    expect(readEntry!.tone).not.toBe('error');
    expect(readEntry!.label).toBe('read');
  });

  it('AC2: preserves toolCall arguments so the work-log carries structured input (path for read tool)', async () => {
    const result = await parseOhmypiConversationMessages(fixture);
    const readEntry = result.workLog.find((e) => e.toolTitle === 'read');
    expect(readEntry).toBeDefined();
    // toolInput must be the arguments object from the toolCall block.
    expect(readEntry!.toolInput).toEqual({ path: '/tmp/omp-rpc/proj/v.txt' });
  });

  it('AC2: result text is captured for the tool-result work-log entry', async () => {
    const result = await parseOhmypiConversationMessages(fixture);
    const readEntry = result.workLog.find((e) => e.toolTitle === 'read');
    expect(readEntry).toBeDefined();
    expect(readEntry!.result).toContain('pi version is 0.79.0');
  });
});
