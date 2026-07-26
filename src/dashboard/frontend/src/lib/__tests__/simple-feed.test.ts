/**
 * PAN-3090 — narrative feed shaping tests (WI-1).
 * Proves the kickoff prompt collapses to a system line (raw preserved),
 * replies stay neutral, assistant prose clamps, and tool calls become
 * one-line actions in chronological order.
 */
import { describe, expect, it } from 'vitest';
import type { ChatMessage, WorkLogEntry } from '../../components/chat/chat-types';
import { buildSimpleFeedEntries, toPlainText } from '../simple/feedEntries';

function msg(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return { role: 'assistant', text: '', createdAt: '2026-07-25T10:00:00Z', ...overrides };
}

function work(overrides: Partial<WorkLogEntry> & { id: string }): WorkLogEntry {
  return { createdAt: '2026-07-25T10:00:00Z', label: 'Did a thing', tone: 'tool', ...overrides };
}

const TITLE = 'Move Login Sessions To The New Account Model';

describe('buildSimpleFeedEntries (PAN-3090 WI-1)', () => {
  it('collapses the first user message into a system entry with the raw prompt preserved', () => {
    const kickoff = '# Working on Issue: PAN-1\n\n**Path:** /x\n\n```json\n{ "decisions": [] }\n```';
    const entries = buildSimpleFeedEntries({
      messages: [msg({ id: 'u1', role: 'user', text: kickoff })],
      workLog: [],
      issueTitle: TITLE,
    });
    expect(entries).toHaveLength(1);
    const sys = entries[0]!;
    expect(sys.kind).toBe('system');
    if (sys.kind !== 'system') return;
    expect(sys.text).toBe('Task started · told to move login sessions to the new account model');
    expect(sys.raw).toBe(kickoff);
  });

  it('renders later user messages as neutral replies, never attributed', () => {
    const entries = buildSimpleFeedEntries({
      messages: [
        msg({ id: 'u1', role: 'user', text: 'kickoff', createdAt: '2026-07-25T10:00:00Z' }),
        msg({ id: 'u2', role: 'user', text: 'please also cover the legacy path', createdAt: '2026-07-25T10:05:00Z' }),
        msg({ id: 'u3', role: 'user', text: 'verification failed: lint', createdAt: '2026-07-25T10:06:00Z' }),
      ],
      workLog: [],
      issueTitle: TITLE,
    });
    expect(entries.map((e) => e.kind)).toEqual(['system', 'reply', 'reply']);
    // No entry may claim the human wrote it — machine-injected feedback is
    // indistinguishable from operator typing at this layer.
    expect(JSON.stringify(entries)).not.toMatch(/You answered|You said/);
  });

  it('clamps assistant messages over 280 chars with a plain-text preview', () => {
    const long = `## Plan\n\n${'I will read the code carefully. '.repeat(20)}\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const entries = buildSimpleFeedEntries({ messages: [msg({ id: 'a1', text: long })], workLog: [], issueTitle: TITLE });
    const say = entries[0]!;
    expect(say.kind).toBe('say');
    if (say.kind !== 'say') return;
    expect(say.clamp).toBe(true);
    expect(say.preview.length).toBeLessThanOrEqual(281);
    expect(say.preview).not.toMatch(/```|##|\*\*/);
    expect(say.full).toBe(long);
  });

  it('shapes work-log entries: edited files, ran command, fallback label, error tone', () => {
    const entries = buildSimpleFeedEntries({
      messages: [],
      workLog: [
        work({ id: 'w1', changedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'], createdAt: '2026-07-25T10:01:00Z' }),
        work({ id: 'w2', command: 'npm test -- --run', createdAt: '2026-07-25T10:02:00Z' }),
        work({ id: 'w3', label: 'Searched the code', createdAt: '2026-07-25T10:03:00Z' }),
        work({ id: 'w4', command: 'npm run lint', tone: 'error', createdAt: '2026-07-25T10:04:00Z' }),
      ],
      issueTitle: TITLE,
    });
    const texts = entries.map((e) => (e.kind === 'action' ? e.text : ''));
    expect(texts[0]).toBe('Edited src/a.ts, src/b.ts (+1 more)');
    expect(texts[1]).toBe('Ran npm test -- --run');
    expect(texts[2]).toBe('Searched the code');
    expect(entries[3]).toMatchObject({ kind: 'action', failed: true });
    expect(entries[0]).toMatchObject({ failed: false });
  });

  it('verb + server detail reads as an action; bare tool names never stand alone', () => {
    const entries = buildSimpleFeedEntries({
      messages: [],
      workLog: [
        work({ id: 'w1', label: 'Bash', detail: 'npm test', createdAt: '2026-07-25T10:01:00Z' }),
        work({ id: 'w2', label: 'Read', detail: 'parser.ts', createdAt: '2026-07-25T10:02:00Z' }),
        work({ id: 'w3', label: 'Bash', createdAt: '2026-07-25T10:03:00Z' }),
        work({ id: 'w4', label: 'Grep', createdAt: '2026-07-25T10:04:00Z' }),
      ],
      issueTitle: TITLE,
    });
    const texts = entries.map((e) => (e.kind === 'action' ? e.text : ''));
    expect(texts).toEqual(['Ran npm test', 'Read parser.ts', 'Ran a command', 'Searched the code']);
  });

  it('thinking phase markers never become feed rows', () => {
    const entries = buildSimpleFeedEntries({
      messages: [],
      workLog: [
        work({ id: 't1', label: 'thinking', tone: 'thinking', detail: 'reasoning about the code', createdAt: '2026-07-25T10:01:00Z' }),
        work({ id: 'w1', label: 'Bash', detail: 'npm test', createdAt: '2026-07-25T10:02:00Z' }),
      ],
      issueTitle: TITLE,
    });
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toMatch(/thinking/);
  });

  it('failed tool results narrate themselves and go red — no verb prefix', () => {
    const entries = buildSimpleFeedEntries({
      messages: [],
      workLog: [
        work({ id: 'w1', label: 'Bash', detail: 'Error: Exit code 1 — Work completion checks failed', createdAt: '2026-07-25T10:01:00Z' }),
        work({ id: 'w2', label: 'Bash', detail: 'npm test', createdAt: '2026-07-25T10:02:00Z' }),
      ],
      issueTitle: TITLE,
    });
    expect(entries[0]).toMatchObject({ kind: 'action', failed: true, text: 'Error: Exit code 1 — Work completion checks failed' });
    expect(entries[1]).toMatchObject({ kind: 'action', failed: false });
  });

  it('interleaves messages and work log chronologically', () => {
    const entries = buildSimpleFeedEntries({
      messages: [
        msg({ id: 'u1', role: 'user', text: 'kickoff', createdAt: '2026-07-25T10:00:00Z' }),
        msg({ id: 'a1', text: 'reading first', createdAt: '2026-07-25T10:02:00Z' }),
      ],
      workLog: [work({ id: 'w1', label: 'Searched', createdAt: '2026-07-25T10:01:00Z' })],
      issueTitle: TITLE,
    });
    expect(entries.map((e) => e.kind)).toEqual(['system', 'action', 'say']);
  });

  it('empty transcript yields no entries', () => {
    expect(buildSimpleFeedEntries({ messages: [], workLog: [], issueTitle: TITLE })).toEqual([]);
  });
});

describe('toPlainText', () => {
  it('strips fences, headers, bold, and bullets', () => {
    expect(toPlainText('## Title\n\n- **bold** item\n\n```json\n{}\n```\n\ntail `code` end')).toBe(
      'Title bold item … tail code end',
    );
  });
});
