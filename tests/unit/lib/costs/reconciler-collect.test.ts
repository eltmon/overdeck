import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectPiCostEvents } from '../../../../src/lib/costs/reconciler.js';
import { closeOverdeckDatabaseSync, getOverdeckDatabaseSync } from '../../../../src/lib/overdeck/infra.js';

let root: string;
let previousHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-3743-pi-collect-'));
  previousHome = process.env.HOME;
  process.env.HOME = root;
  process.env.OVERDECK_HOME = join(root, '.overdeck');
  getOverdeckDatabaseSync();
  closeOverdeckDatabaseSync();
});

afterEach(() => {
  closeOverdeckDatabaseSync();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  delete process.env.OVERDECK_HOME;
  rmSync(root, { recursive: true, force: true });
});

describe('collectPiCostEvents', () => {
  it('returns parsed events and verdicts without recording them', async () => {
    const agentDir = join(root, '.overdeck', 'agents', 'agent-pan-3743');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ issueId: 'PAN-3743', role: 'work' }));
    writeFileSync(join(agentDir, 'session.jsonl'), [
      '{"type":"session","version":3}',
      JSON.stringify({ type: 'message', id: 'm1', timestamp: '2026-08-16T10:00:00Z',
        message: { role: 'assistant', provider: 'zai', model: 'glm-5.2', responseId: 'r1',
          usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } } }),
    ].join('\n'));

    const result = await collectPiCostEvents();

    expect(result.stats).toEqual({ scanned: 1, cacheSkipped: 0, sessionsWithData: 1 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.event).toMatchObject({ issueId: 'PAN-3743', agentId: 'agent-pan-3743' });
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0]?.verdict).toBe('imported');
  });

  it('returns large transcripts in bounded event batches', async () => {
    const agentDir = join(root, '.overdeck', 'agents', 'agent-pan-3743');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ issueId: 'PAN-3743', role: 'work' }));
    writeFileSync(join(agentDir, 'session.jsonl'), [
      '{"type":"session","version":3}',
      ...['m1', 'm2'].map((id, index) => JSON.stringify({
        type: 'message', id, timestamp: `2026-08-16T10:00:0${index}Z`,
        message: { role: 'assistant', provider: 'zai', model: 'glm-5.2', responseId: `r${index}`,
          usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } },
      })),
    ].join('\n'));

    const batches: Array<{ events: unknown[]; verdicts: unknown[] }> = [];
    const result = await collectPiCostEvents({
      maxEvents: 1,
      onBatch: async batch => { batches.push(batch); },
    });

    expect(batches.map(batch => batch.events.length)).toEqual([1, 1, 0]);
    expect(batches.at(-1)?.verdicts).toHaveLength(1);
    expect(result.events).toHaveLength(0);
  });
});
