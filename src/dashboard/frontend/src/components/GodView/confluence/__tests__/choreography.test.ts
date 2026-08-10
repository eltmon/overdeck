import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  advanceMergeDwell,
  resolveMergeReconciliation,
  type RiverEffectsApi,
} from '../RiverCanvas';
import {
  FEED_TICKER_CHANCE,
  HOOK_HEAT_BUMP,
  HOOK_RATE_BUMP,
  TOOL_TICKER_CHANCE,
  planConfluenceChoreography,
  runConfluenceCommands,
  useConfluenceChoreography,
} from '../useConfluenceChoreography';
import type { ConfluenceOrb, HookStreamEntry } from '../useConfluenceData';

function orb(id: string, overrides: Partial<ConfluenceOrb> = {}): ConfluenceOrb {
  return {
    id,
    project: 'overdeck',
    role: 'work',
    stage: 'WORK',
    title: id,
    heat: 0.4,
    staleMin: 0,
    state: 'active',
    convoy: null,
    yieldReason: null,
    yieldedByScheduler: false,
    warn: null,
    broken: false,
    model: 'gpt-5.6-sol',
    harness: null,
    labels: [],
    glyph: 'G',
    lastActivity: '2026-08-02T12:00:00.000Z',
    idleMin: 0,
    waitUntil: 0,
    thinkUntil: 0,
    compactT: 0,
    spend: 0,
    mergeStatus: null,
    parkedOrbit: null,
    parkedMin: null,
    orbitReason: null,
    ...overrides,
  };
}

function hook(issueId: string, sequence = 1): HookStreamEntry {
  return {
    sequence,
    source: 'hook',
    agentId: `agent-${issueId.toLowerCase()}`,
    issueId,
    tool: 'Read',
    hookName: 'PreToolUse',
    family: 'tool_read',
    ts: Date.parse('2026-08-02T12:00:00.000Z'),
  };
}

function effects(): RiverEffectsApi {
  return {
    emitSparks: vi.fn(),
    emitRing: vi.fn(),
    emitTicker: vi.fn(),
    playTide: vi.fn(),
    playMerge: vi.fn(),
    playThaw: vi.fn(),
    playSweep: vi.fn(),
    playFlare: vi.fn(),
    pulseSun: vi.fn(),
    spawnFromSun: vi.fn(),
    gateFlash: vi.fn(),
  };
}

describe('Confluence choreography dispatch table', () => {
  it('holds queued and merging orbs in MERGE until their dwell expires', () => {
    expect(advanceMergeDwell('MERGE', 'queued', 0, 1)).toEqual({ remaining: 0, shouldStart: false });
    expect(advanceMergeDwell('MERGE', 'merging', 2, 0.5)).toEqual({ remaining: 1.5, shouldStart: false });
    expect(advanceMergeDwell('MERGE', 'merging', 1.5, 1.5)).toEqual({ remaining: 0, shouldStart: true });
    expect(advanceMergeDwell('VERIFY', 'merging', 0, 1)).toEqual({ remaining: 0, shouldStart: false });
  });

  it('recovers a failed merge during or after the portal comet', () => {
    expect(resolveMergeReconciliation('failed', true, false, true)).toEqual({
      retired: false,
      cancelMerge: true,
      shouldSpawn: false,
    });
    expect(resolveMergeReconciliation('failed', false, true, false)).toEqual({
      retired: false,
      cancelMerge: false,
      shouldSpawn: true,
    });
    expect(resolveMergeReconciliation('active', false, true, false)).toEqual({
      retired: true,
      cancelMerge: false,
      shouldSpawn: false,
    });
  });

  it('maps hook, stage, yield, resume, thaw, and dispatch changes to exact effects', () => {
    expect(HOOK_HEAT_BUMP).toBe(0.06);
    expect(HOOK_RATE_BUMP).toBe(0.13);
    expect(TOOL_TICKER_CHANCE).toBe(0.13);
    expect(FEED_TICKER_CHANCE).toBe(0.16);

    const previous = new Map([
      ['PAN-1', orb('PAN-1')],
      ['PAN-2', orb('PAN-2', { state: 'stale', staleMin: 42 })],
      ['PAN-3', orb('PAN-3', { state: 'shelf', yieldReason: 'yield: older' })],
      ['PAN-4', orb('PAN-4', { mergeStatus: 'queued' })],
      ['PAN-5', orb('PAN-5')],
      ['PAN-6', orb('PAN-6')],
      ['PAN-50', orb('PAN-50', { role: 'review', stage: 'REVIEW' })],
    ]);
    const current = new Map([
      ['PAN-1', orb('PAN-1', { stage: 'REVIEW', role: 'review' })],
      // PAN-2's data says it is ALIVE again (stale → active): the honest thaw.
      ['PAN-2', orb('PAN-2', { state: 'active' })],
      ['PAN-3', orb('PAN-3')],
      ['PAN-4', orb('PAN-4', { mergeStatus: 'merging' })],
      ['PAN-5', orb('PAN-5', { state: 'shelf', yieldReason: 'yield: freeing a slot for PAN-50' })],
      ['PAN-6', orb('PAN-6', { state: 'failed', mergeStatus: 'failed' })],
      ['PAN-50', orb('PAN-50', { role: 'review', stage: 'REVIEW' })],
      ['PAN-99', orb('PAN-99', { role: 'plan', stage: 'PLAN' })],
    ]);
    const rolls = [0.12, 0.15];
    const commands = planConfluenceChoreography({
      previous,
      current,
      hookEvents: [hook('PAN-2')],
      random: () => rolls.shift() ?? 1,
    });

    // Thaw is data-driven (stale → active in the snapshot), never beat-driven.
    expect(commands).toContainEqual({ type: 'thaw', issueId: 'PAN-2' });
    expect(commands).toContainEqual({
      type: 'sparks',
      issueId: 'PAN-2',
      color: '#00d4ff',
      agentId: 'agent-pan-2',
      heatBump: 0.06,
      specRateBump: 0.13,
    });
    expect(commands).toContainEqual({ type: 'ticker', text: 'PAN-2 · Read', color: '#00d4ff' });
    expect(commands).toContainEqual({ type: 'ticker', text: 'PreToolUse · PAN-2', color: '#00d4ff' });
    expect(commands).toContainEqual({ type: 'ring', issueId: 'PAN-1', color: '#ffb800' });
    expect(commands).toContainEqual({ type: 'sparks', issueId: 'PAN-1', color: '#ffb800', heatBump: 0, specRateBump: 0 });
    expect(commands).toContainEqual({ type: 'gate', stage: 'REVIEW' });
    expect(commands).not.toContainEqual({ type: 'merge', issueId: 'PAN-4' });
    expect(commands).toContainEqual({ type: 'tide', targetId: 'PAN-5', beneficiaryId: 'PAN-50' });
    expect(commands).toContainEqual({ type: 'ring', issueId: 'PAN-3', color: '#39ff14' });
    expect(commands).toContainEqual({ type: 'sun' });
    expect(commands).toContainEqual({ type: 'spawn', issueId: 'PAN-99' });
    expect(commands.some((command) => 'issueId' in command && command.issueId === 'PAN-6')).toBe(false);

    const api = effects();
    runConfluenceCommands(commands, api);
    expect(api.playThaw).toHaveBeenCalledWith('PAN-2');
    expect(api.emitSparks).toHaveBeenCalledWith('PAN-2', '#00d4ff', 'agent-pan-2', 0.06);
    expect(api.emitRing).toHaveBeenCalledWith('PAN-1', '#ffb800');
    expect(api.gateFlash).toHaveBeenCalledWith('REVIEW');
    expect(api.playMerge).not.toHaveBeenCalled();
    expect(api.playTide).toHaveBeenCalledWith('PAN-5', 'PAN-50');
    expect(api.pulseSun).toHaveBeenCalledOnce();
    expect(api.spawnFromSun).toHaveBeenCalledWith('PAN-99');
  });

  it('uses the most recently active review orb when a yield reason names no beneficiary', () => {
    const previous = new Map([['PAN-5', orb('PAN-5')]]);
    const current = new Map([
      ['PAN-5', orb('PAN-5', { state: 'shelf', yieldReason: 'yield: freeing a slot' })],
      ['PAN-10', orb('PAN-10', { role: 'review', stage: 'REVIEW', lastActivity: '2026-08-02T11:00:00.000Z' })],
      ['PAN-11', orb('PAN-11', { role: 'review', stage: 'REVIEW', lastActivity: '2026-08-02T12:00:00.000Z' })],
    ]);

    expect(planConfluenceChoreography({ previous, current, hookEvents: [] }))
      .toContainEqual({ type: 'tide', targetId: 'PAN-5', beneficiaryId: 'PAN-11' });
  });

  it('emits sparks for same-second events with distinct domain sequences', () => {
    const api = effects();
    const effectsRef = { current: api };
    const orbs = [orb('PAN-1')];
    const first = hook('PAN-1', 1);
    const second = hook('PAN-1', 2);
    const { rerender } = renderHook(
      ({ entries }) => useConfluenceChoreography(orbs, entries, effectsRef),
      { initialProps: { entries: [first] } },
    );

    rerender({ entries: [first, second] });

    expect(api.emitSparks).toHaveBeenCalledTimes(1);
    expect(api.emitSparks).toHaveBeenCalledWith('PAN-1', '#00d4ff', 'agent-pan-1', HOOK_HEAT_BUMP);
  });

  it('emits lifecycle-only sparks without requiring a named hook', () => {
    const commands = planConfluenceChoreography({
      previous: new Map([['PAN-1', orb('PAN-1')]]),
      current: new Map([['PAN-1', orb('PAN-1', { harness: 'codex' })]]),
      hookEvents: [{
        sequence: 1,
        source: 'lifecycle',
        agentId: 'agent-pan-1',
        issueId: 'PAN-1',
        tool: 'idle',
        hookName: 'Lifecycle',
        family: 'lifecycle',
        ts: Date.parse('2026-08-02T12:00:00.000Z'),
      }],
      random: () => 1,
    });

    expect(commands).toContainEqual({
      type: 'sparks',
      issueId: 'PAN-1',
      color: '#e8edf8',
      agentId: 'agent-pan-1',
      heatBump: HOOK_HEAT_BUMP,
      specRateBump: HOOK_RATE_BUMP,
    });
  });

  it('plans and runs a frame without scheduling wall-clock choreography timers', () => {
    vi.useFakeTimers();
    try {
      const commands = planConfluenceChoreography({
        previous: new Map([['PAN-1', orb('PAN-1')]]),
        current: new Map([['PAN-1', orb('PAN-1', { stage: 'REVIEW' })]]),
        hookEvents: [hook('PAN-1')],
        random: () => 1,
      });
      runConfluenceCommands(commands, effects());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Sweep choreography (PAN-3490) ───────────────────────────────────────────

import { planSweepCommands } from '../useConfluenceChoreography';
import type { DomainEvent } from '@overdeck/contracts';

let sweepSequence = 1000;
function sweepEvent(type: string, payload: Record<string, unknown>): DomainEvent {
  sweepSequence += 1;
  return { type, sequence: sweepSequence, timestamp: '2026-08-02T13:00:00.000Z', payload } as unknown as DomainEvent;
}

describe('planSweepCommands', () => {
  it('sweep.scan raises the lantern beam once per batch plus a census ticker', () => {
    const commands = planSweepCommands([
      sweepEvent('sweep.scan', { issueCount: 12, rowCount: 14, rows: [] }),
      sweepEvent('sweep.scan', { issueCount: 12, rowCount: 14, rows: [] }),
    ]);
    expect(commands.filter((command) => command.type === 'sweep-tide')).toHaveLength(1);
    expect(commands.some((command) => command.type === 'ticker' && command.text.includes('12 parked'))).toBe(true);
  });

  it('sweep.escalated fires a signal flare without moving the orb', () => {
    const commands = planSweepCommands([
      sweepEvent('sweep.escalated', { issueId: 'MIN-924', orbit: 'operator-gate', reason: 'paused' }),
    ]);
    expect(commands).toContainEqual({ type: 'flare', issueId: 'MIN-924' });
    expect(commands.some((command) => command.type === 'ticker' && command.text.includes('needs operator'))).toBe(true);
    expect(commands.filter((command) => command.type === 'thaw')).toHaveLength(0);
  });

  it('runs sweep observation commands through the effects dispatch table', () => {
    const api = effects();
    runConfluenceCommands(planSweepCommands([
      sweepEvent('sweep.scan', { issueCount: 3, rowCount: 3, rows: [] }),
      sweepEvent('sweep.escalated', { issueId: 'PAN-2', orbit: 'operator-gate', reason: 'paused' }),
    ]), api);
    expect(api.playSweep).toHaveBeenCalledOnce();
    expect(api.playThaw).not.toHaveBeenCalled();
    expect(api.playFlare).toHaveBeenCalledWith('PAN-2');
  });

  it('ignores non-sweep events entirely', () => {
    const commands = planSweepCommands([
      sweepEvent('agent.activity_changed', { agentId: 'agent-pan-1' }),
    ]);
    expect(commands).toHaveLength(0);
  });
});

describe('honest thaw semantics (PAN-3490 follow-up)', () => {
  it('a hook beat on an orb that STAYS stale sparks but never thaws', () => {
    const previous = new Map([['PAN-2', orb('PAN-2', { state: 'stale', staleMin: 42 })]]);
    const current = new Map([['PAN-2', orb('PAN-2', { state: 'stale', staleMin: 43 })]]);
    const commands = planConfluenceChoreography({
      previous,
      current,
      hookEvents: [hook('PAN-2')],
      random: () => 1,
    });
    expect(commands.filter((command) => command.type === 'thaw')).toHaveLength(0);
    expect(commands.some((command) => command.type === 'sparks' && command.issueId === 'PAN-2')).toBe(true);
  });
});
