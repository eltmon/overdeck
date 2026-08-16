import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentMailDir,
  agentMailReadDir,
  drainMailOnce,
  formatAgentMessageBlock,
  formatMailFileContent,
  isMonitorLive,
  listInboxMessagesSync,
  MONITOR_PRESENCE_FRESHNESS_MS,
  parseMailFile,
  writeMonitorPresence,
} from '../monitor-transport.js';

const AGENT_ID = 'agent-pan-test';
let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'overdeck-monitor-test-'));
  process.env.OVERDECK_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.OVERDECK_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeMail(name: string, content: string): void {
  const dir = agentMailDir(AGENT_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

describe('mail file format', () => {
  it('round-trips source/date/body through format + parse', () => {
    const date = new Date('2026-07-24T12:00:00.000Z');
    const content = formatMailFileContent('fix the tests\nplease', 'pan-tell', date);
    expect(parseMailFile(content)).toEqual({
      source: 'pan-tell',
      date: '2026-07-24T12:00:00.000Z',
      body: 'fix the tests\nplease',
    });
  });

  it('parses legacy headerless mail as plain body', () => {
    expect(parseMailFile('# Message\n\njust a body\n')).toEqual({ body: 'just a body' });
  });
});

describe('formatAgentMessageBlock', () => {
  it('wraps the body in agent-message markers with metadata', () => {
    const block = formatAgentMessageBlock(AGENT_ID, { source: 'deacon', date: 'D', body: 'hello' });
    expect(block).toBe('[overdeck:agent-message] source: deacon at: D\nhello\n[overdeck:agent-message] end');
  });

  it('truncates long bodies with a pan inbox pointer', () => {
    const block = formatAgentMessageBlock(AGENT_ID, { body: 'x'.repeat(5000) }, 4000);
    expect(block).toContain('x'.repeat(4000));
    expect(block).not.toContain('x'.repeat(4001));
    expect(block).toContain(`run \`pan inbox ${AGENT_ID}\``);
  });
});

describe('isMonitorLive', () => {
  it('is live with a fresh heartbeat and a live pid', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    writeMonitorPresence(AGENT_ID, process.pid, now, now);
    expect(isMonitorLive(AGENT_ID, now.getTime())).toBe(true);
  });

  it('is dead when the heartbeat exceeds the freshness window', () => {
    const beat = new Date('2026-07-24T12:00:00.000Z');
    writeMonitorPresence(AGENT_ID, process.pid, beat, beat);
    const later = beat.getTime() + MONITOR_PRESENCE_FRESHNESS_MS + 1;
    expect(isMonitorLive(AGENT_ID, later)).toBe(false);
  });

  it('is dead when the pid is gone', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    writeMonitorPresence(AGENT_ID, process.pid, now, now);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    expect(isMonitorLive(AGENT_ID, now.getTime())).toBe(false);
  });

  it('is dead with no presence file', () => {
    expect(isMonitorLive(AGENT_ID, Date.now())).toBe(false);
  });
});

describe('drainMailOnce', () => {
  it('emits plain mail oldest-first, moves it to read/, and skips pending/json', async () => {
    writeMail('2026-01-01T00-00-00-000Z.md', '# Message\n\nfirst\n');
    writeMail('2026-01-02T00-00-00-000Z.md', formatMailFileContent('second', 'pan-tell', new Date('2026-01-02T00:00:00Z')));
    writeMail('2026-01-03T00-00-00-000Z.pending.md', '# Message\n\ncodex pending\n');
    writeMail('mail-1.json', '{"payload":"fpp"}');

    const blocks: string[] = [];
    const emitted = await drainMailOnce(AGENT_ID, (b) => blocks.push(b));

    expect(emitted).toBe(2);
    expect(blocks[0]).toContain('first');
    expect(blocks[1]).toContain('second');
    expect(blocks[1]).toContain('source: pan-tell');

    const remaining = readdirSync(agentMailDir(AGENT_ID)).sort();
    expect(remaining).toContain('2026-01-03T00-00-00-000Z.pending.md');
    expect(remaining).toContain('mail-1.json');
    expect(remaining).not.toContain('2026-01-01T00-00-00-000Z.md');
    expect(readdirSync(agentMailReadDir(AGENT_ID)).sort()).toEqual([
      '2026-01-01T00-00-00-000Z.md',
      '2026-01-02T00-00-00-000Z.md',
    ]);

    // Everything claimed — a second drain emits nothing.
    expect(await drainMailOnce(AGENT_ID, () => {})).toBe(0);
  });

  it('returns 0 when the mail dir does not exist', async () => {
    expect(await drainMailOnce('agent-without-mail', () => {})).toBe(0);
  });

  it('still drains `.delivered.md` backups and still skips keyed pending mail (PAN-3738)', async () => {
    // The `.delivered.md` suffix marks a post-delivery backup for a human
    // reading mail/; these files were plain `<ts>.md` before, and the monitor
    // drained them, so the monitor keeps draining them — the naming change is
    // deliberately behavior-preserving here. `dedup-<hash>.pending.md` stays
    // codex notify-hook territory, exactly like a timestamped pending file.
    writeMail('2026-01-04T00-00-00-000Z.delivered.md', '# Message\n\nalready landed\n');
    writeMail('dedup-abc123.pending.md', '# Message\n\nkeyed busy mail\n');

    const blocks: string[] = [];
    expect(await drainMailOnce(AGENT_ID, (b) => blocks.push(b))).toBe(1);
    expect(blocks[0]).toContain('already landed');

    expect(readdirSync(agentMailDir(AGENT_ID)).filter((name) => name !== 'read'))
      .toEqual(['dedup-abc123.pending.md']);
    expect(readdirSync(agentMailReadDir(AGENT_ID))).toEqual(['2026-01-04T00-00-00-000Z.delivered.md']);
  });
});

describe('listInboxMessagesSync', () => {
  it('returns read + unread full bodies oldest-first under the limit, moving nothing', async () => {
    writeMail('2026-01-01T00-00-00-000Z.md', '# Message\n\nold\n');
    await drainMailOnce(AGENT_ID, () => {}); // moves "old" into read/
    writeMail('2026-01-02T00-00-00-000Z.md', formatMailFileContent('x'.repeat(6000), 'deacon', new Date('2026-01-02T00:00:00Z')));

    const messages = listInboxMessagesSync(AGENT_ID, 10);
    expect(messages.map((m) => [m.read, m.body.length])).toEqual([
      [true, 3],
      [false, 6000], // full body — inbox never truncates
    ]);

    expect(existsSync(join(agentMailDir(AGENT_ID), '2026-01-02T00-00-00-000Z.md'))).toBe(true);
    expect(listInboxMessagesSync(AGENT_ID, 1)).toHaveLength(1);
    expect(listInboxMessagesSync(AGENT_ID, 1)[0].read).toBe(false);
  });
});
