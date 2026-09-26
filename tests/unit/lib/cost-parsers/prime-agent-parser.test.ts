/**
 * PAN-3668 WI-19 (FR-12, D16): Prime Agent session usage becomes durable cost events.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parsePrimeAgentCostEvents } from '../../../../src/lib/cost-parsers/prime-agent-parser.js';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/prime-agent/session.jsonl');
const SESSION_ID = '01a0e000-0000-7000-8000-00000000abcd';

describe('parsePrimeAgentCostEvents (PAN-3668 WI-19)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-prime-cost-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces a message usage with its child aggregate, counts each message once, and skips zero-usage turns', async () => {
    const events = await parsePrimeAgentCostEvents(FIXTURE);

    expect(events.map((event) => event.entryId)).toEqual(['a0000001', 'a0000002']);
    expect(events[0]).toMatchObject({
      requestId: `prime-agent:${SESSION_ID}:a0000001`,
      sessionId: SESSION_ID,
      timestamp: '2026-09-25T10:00:03.000Z',
      provider: 'openai-codex',
      model: 'gpt-5.5',
      input: 1300,
      output: 250,
      cacheRead: 500,
      cacheWrite: 100,
    });
    expect(events[0]!.cost).toBeCloseTo(0.0041, 6);
    expect(events[1]).toMatchObject({ input: 2000, output: 100, cacheRead: 1500, cacheWrite: 0 });
    const summed = events.reduce((sum, event) => sum + event.cost, 0);
    expect(summed).toBeCloseTo(0.0074, 6);
  });

  it('produces stable request ids across re-reads', async () => {
    const first = await parsePrimeAgentCostEvents(FIXTURE);
    const second = await parsePrimeAgentCostEvents(FIXTURE);
    expect(second.map((event) => event.requestId)).toEqual(first.map((event) => event.requestId));
  });

  it('produces no event for a message without usage, and nothing for a file without a session header', async () => {
    const file = join(dir, 'nousage.jsonl');
    writeFileSync(file, [
      JSON.stringify({ type: 'session', version: 3, id: 'sid-1', timestamp: '2026-09-25T10:00:00.000Z', cwd: '/w' }),
      JSON.stringify({ type: 'message', id: 'a1', parentId: null, timestamp: '2026-09-25T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop' } }),
      '{"partial":',
    ].join('\n'));
    await expect(parsePrimeAgentCostEvents(file)).resolves.toEqual([]);

    const headerless = join(dir, 'headerless.jsonl');
    writeFileSync(headerless, JSON.stringify({ type: 'message', id: 'a1', message: { role: 'assistant', usage: { input: 5, output: 5, cost: { total: 1 } } } }));
    await expect(parsePrimeAgentCostEvents(headerless)).resolves.toEqual([]);
  });
});
