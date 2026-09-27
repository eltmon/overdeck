import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-conversation-reads-compact-summary-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(() => {
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

function userLine(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: '2026-01-01T00:00:00.000Z',
    uuid: `u-${Math.random().toString(36).slice(2)}`,
    ...extra,
  });
}

function boundaryLine(): string {
  return JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2026-01-01T00:00:01.000Z',
    uuid: `b-${Math.random().toString(36).slice(2)}`,
  });
}

// The cache in conversation-reads.ts is module-level (keyed by file path), so
// each test below uses its own transcript path.

describe('getCachedMessages — latestCompactSummary', () => {
  it('ac1: returns the summary on a cold parse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-crcs-ac1-'));
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, `${[
      userLine('Please migrate the billing service.'),
      boundaryLine(),
      userLine('Summary A: earlier work on billing.', { isCompactSummary: true }),
    ].join('\n')}\n`);

    const { getCachedMessages } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    const result = await getCachedMessages(file, false);

    expect(result.latestCompactSummary?.text).toBe('Summary A: earlier work on billing.');
    rmSync(dir, { recursive: true, force: true });
  });

  it('ac2: returns summary B after a boundary + summary B is appended', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-crcs-ac2-'));
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, `${[
      userLine('Please migrate the billing service.'),
      boundaryLine(),
      userLine('Summary A: earlier work on billing.', { isCompactSummary: true }),
    ].join('\n')}\n`);

    const { getCachedMessages } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    const first = await getCachedMessages(file, false);
    expect(first.latestCompactSummary?.text).toBe('Summary A: earlier work on billing.');

    appendFileSync(
      file,
      `${[
        boundaryLine(),
        userLine('Summary B: later work on billing.', { isCompactSummary: true }),
        userLine('Now add tests.'),
      ].join('\n')}\n`,
    );

    const second = await getCachedMessages(file, false);
    expect(second.latestCompactSummary?.text).toBe('Summary B: later work on billing.');
    rmSync(dir, { recursive: true, force: true });
  });

  it('ac3: preserves summary B when only ordinary turns are appended', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-crcs-ac3-'));
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, `${[
      userLine('Please migrate the billing service.'),
      boundaryLine(),
      userLine('Summary B: later work on billing.', { isCompactSummary: true }),
    ].join('\n')}\n`);

    const { getCachedMessages } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    const first = await getCachedMessages(file, false);
    expect(first.latestCompactSummary?.text).toBe('Summary B: later work on billing.');

    appendFileSync(file, `${userLine('Just a follow-up turn.')}\n`);

    const second = await getCachedMessages(file, false);
    expect(second.latestCompactSummary?.text).toBe('Summary B: later work on billing.');
    rmSync(dir, { recursive: true, force: true });
  });
});
