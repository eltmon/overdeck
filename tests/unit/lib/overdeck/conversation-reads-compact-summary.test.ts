import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConversation } from '../../../../src/lib/overdeck/conversations.js';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-conversation-reads-compact-summary-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabase();
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

describe('getConversationAbout — latestCompactSummary', () => {
  it('ac2: passes the latest compaction summary and only after-summary turns to summarizeTranscriptAbout', async () => {
    const summaryText = [
      'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
      '',
      'Summary:',
      '1. Primary Request and Intent: Migrate the billing service to the new invoicing API.',
    ].join('\n');

    createConversation({ name: 'about-with-summary', tmuxSession: 'conv-about-with-summary', cwd: '/tmp' });
    const sessionFile = join(testHome, 'about-with-summary.jsonl');
    writeFileSync(sessionFile, `${[
      userLine('before summary turn'),
      boundaryLine(),
      userLine(summaryText, { isCompactSummary: true }),
      userLine('after summary turn'),
    ].join('\n')}\n`);

    const transcriptSummary = await import('../../../../src/lib/conversations/transcript-summary.js');
    const summarizeSpy = vi.spyOn(transcriptSummary, 'summarizeTranscriptAbout').mockResolvedValue('Migrating billing to the invoicing API.');

    const { getConversationAbout } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    await getConversationAbout('about-with-summary', true, {
      resolveSessionFile: () => Promise.resolve(sessionFile),
    });

    expect(summarizeSpy).toHaveBeenCalledTimes(1);
    const transcriptArg = summarizeSpy.mock.calls[0]![0] as string;
    expect(transcriptArg).toContain('Primary Request and Intent');
    expect(transcriptArg).toContain('after summary turn');
    expect(transcriptArg).not.toContain('before summary turn');
  });
});
