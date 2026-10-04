import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendSessionIdToHistory } from '../../session-history.js';
import { buildSessionIndex, extractCostEvents, toOverdeckCostEvent } from '../reconciler.js';
import type { CostEvent } from '../events.js';

let root: string;
let previousHome: string | undefined;
let previousOverdeckHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reconciler-effort-'));
  previousHome = process.env.HOME;
  previousOverdeckHome = process.env.OVERDECK_HOME;
  process.env.HOME = root;
  process.env.OVERDECK_HOME = join(root, '.overdeck');
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousOverdeckHome;
  rmSync(root, { recursive: true, force: true });
});

function claudeAssistantLine(requestId: string, effort?: string): string {
  return JSON.stringify({
    type: 'assistant',
    requestId,
    timestamp: '2026-07-06T00:00:00.000Z',
    ...(effort ? { effort } : {}),
    message: {
      model: 'claude-haiku-4-5',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

describe('PAN-4259: reconciler stamps effort', () => {
  it('stamps the observed effort from the assistant record', () => {
    const events = extractCostEvents(claudeAssistantLine('req-1', 'xhigh'), 'agent-pan-1', 'PAN-1', 'work', 'sess-1', 'high');

    expect(events).toHaveLength(1);
    expect(events[0]!.effort).toBe('xhigh');
  });

  it('falls back to the launch effort when the record has none', () => {
    const events = extractCostEvents(claudeAssistantLine('req-1'), 'agent-pan-1', 'PAN-1', 'work', 'sess-1', 'high');

    expect(events).toHaveLength(1);
    expect(events[0]!.effort).toBe('high');
  });

  it('buildSessionIndex maps each session to its own launch effort', () => {
    const agentId = 'agent-pan-3950';
    const agentDir = join(root, '.overdeck', 'agents', agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ issueId: 'PAN-3950', role: 'work', effort: 'max' }));
    appendSessionIdToHistory(agentId, 's1', 'launcher', { effort: 'medium' });
    appendSessionIdToHistory(agentId, 's2', 'launcher');

    const index = buildSessionIndex();
    expect(index.get('s1')?.effort).toBe('medium');
    expect(index.get('s2')?.effort).toBe('max');
  });

  it('toOverdeckCostEvent keeps effort and maps a missing one to null', () => {
    const base: CostEvent = {
      ts: '2026-07-06T00:00:00.000Z',
      type: 'cost',
      agentId: 'agent-pan-1',
      issueId: 'PAN-1',
      sessionType: 'work',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.001,
    };

    expect(toOverdeckCostEvent({ ...base, effort: 'medium' }, 'reconciler:test').effort).toBe('medium');
    expect(toOverdeckCostEvent(base, 'reconciler:test').effort).toBeNull();
  });
});
