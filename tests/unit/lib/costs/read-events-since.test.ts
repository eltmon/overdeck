import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readEventsSince } from '../../../../src/lib/costs/events.js';

const line = (ts: string, issueId: string, cost: number) =>
  JSON.stringify({ ts, type: 'cost', agentId: 'agent-x', issueId, model: 'm', cost });

describe('readEventsSince (PAN-4543)', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'read-events-since-'));
    process.env.HOME = home;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  const writeLog = (content: string) => {
    mkdirSync(join(home, '.overdeck', 'costs'), { recursive: true });
    writeFileSync(join(home, '.overdeck', 'costs', 'events.jsonl'), content);
  };

  it('returns no events when the log does not exist', async () => {
    expect(await readEventsSince('2026-10-01')).toEqual([]);
  });

  it('keeps events at or after the start date and skips blank and malformed lines', async () => {
    writeLog([
      line('2026-09-01T00:00:00Z', 'PAN-1', 1),
      '',
      '{not json',
      line('2026-10-01T00:00:00Z', 'PAN-2', 2),
      line('2026-10-03T12:00:00Z', 'PAN-3', 3), // trailing line without a newline
    ].join('\n'));

    const events = await readEventsSince('2026-10-01');

    expect(events.map(event => event.issueId)).toEqual(['PAN-2', 'PAN-3']);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('reads a multi-chunk log across chunk boundaries and yields the event loop while it reads', async () => {
    const lines = Array.from({ length: 3000 }, (_unused, index) =>
      line(`2026-10-0${1 + (index % 3)}T00:00:00Z`, `PAN-${index}`, index));
    writeLog(`${lines.join('\n')}\n`);

    let immediateRan = false;
    const pending = readEventsSince('2026-10-02');
    setImmediate(() => { immediateRan = true; });
    let immediateRanBeforeResolve = false;
    const events = await pending.then((result) => {
      immediateRanBeforeResolve = immediateRan;
      return result;
    });

    expect(events).toHaveLength(2000);
    expect(new Set(events.map(event => event.issueId)).size).toBe(2000);
    expect(events.every(event => event.ts >= '2026-10-02')).toBe(true);
    expect(immediateRanBeforeResolve).toBe(true);
  });
});
