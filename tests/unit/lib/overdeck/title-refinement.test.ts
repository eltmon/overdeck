/**
 * Tests for workspace-pgwzf — Turn-complete title refinement service.
 *
 * AC1: Given titleSource='auto' and a transcript with a completed assistant message,
 *      handleTurnComplete persists an 'ai-refined' title via updateConversationTitle.
 * AC2: Given titleSource='ai-refined', handleTurnComplete refines again only after
 *      >=5 turn-completes AND >=10 minutes (fake-timer test advances clock).
 * AC3: titleSource 'manual', 'ai-explicit', or null are never refined, and nothing runs
 *      when titleRefinement is disabled or cheapMode=true.
 * AC4: A turn-complete with no completed assistant message persists no title change and
 *      preserves the cadence counters for the next turn.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createConversation,
  getConversationByName,
} from '../../../../src/lib/overdeck/conversations.js';
import {
  handleTurnComplete,
  resetTitleRefinementState,
  type HandleTurnCompleteDependencies,
} from '../../../../src/lib/overdeck/title-refinement.js';

const emittedEvents: unknown[] = [];

vi.mock('../../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: () => ({
    emitOnly: (event: unknown) => {
      emittedEvents.push(event);
    },
  }),
}));

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-title-refinement-test-'));
  process.env.OVERDECK_HOME = testHome;
  emittedEvents.length = 0;
  resetTitleRefinementState();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(async () => {
  vi.useRealTimers();
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

function makeDeps(options: {
  enabled?: boolean;
  messages?: Array<{ role: string; text?: string; completedAt?: string }>;
  summarizeResult?: string;
} = {}): HandleTurnCompleteDependencies {
  const sessionFile = join(testHome, `session-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(sessionFile, '{}\n');
  return {
    resolveSessionFile: async () => sessionFile,
    getCachedMessages: vi.fn().mockResolvedValue({ messages: options.messages ?? [] }),
    configuredTitleModel: vi.fn().mockReturnValue('claude-sonnet-5'),
    summarizeTranscriptTitle: vi.fn().mockResolvedValue(options.summarizeResult ?? 'Refined AI Title'),
    isBackgroundFeatureEnabled: vi.fn().mockReturnValue(options.enabled ?? true),
  };
}

describe('handleTurnComplete', () => {
  it('refines to ai-refined on first eligible turn-complete', async () => {
    const deps = makeDeps({
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi there', completedAt: '2026-07-07T12:00:00Z' },
      ],
    });

    createConversation({
      name: 'refine-first',
      tmuxSession: 'tmux-refine-first',
      cwd: '/tmp',
      title: 'refactor the auth middleware in src/auth.ts',
      titleSource: 'auto',
    });

    const conv = getConversationByName('refine-first');
    await handleTurnComplete(conv!, deps);

    const updated = getConversationByName('refine-first');
    expect(updated?.title).toBe('Refined AI Title');
    expect(updated?.titleSource).toBe('ai-refined');
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toMatchObject({
      type: 'conversation.title_changed',
      payload: { conversationName: 'refine-first', title: 'Refined AI Title', titleSource: 'ai-refined' },
    });
  });

  it('does not refine when titleRefinement is disabled', async () => {
    const deps = makeDeps({
      enabled: false,
      messages: [{ role: 'assistant', text: 'hi', completedAt: '2026-07-07T12:00:00Z' }],
    });

    createConversation({
      name: 'refine-disabled',
      tmuxSession: 'tmux-refine-disabled',
      cwd: '/tmp',
      title: 'original',
      titleSource: 'auto',
    });

    const conv = getConversationByName('refine-disabled');
    await handleTurnComplete(conv!, deps);

    expect(getConversationByName('refine-disabled')?.titleSource).toBe('auto');
    expect(emittedEvents).toHaveLength(0);
  });

  it('preserves counters and makes no title change when no completed assistant exists', async () => {
    const deps = makeDeps({ messages: [{ role: 'user', text: 'hello' }] });

    createConversation({
      name: 'refine-no-assistant',
      tmuxSession: 'tmux-refine-no-assistant',
      cwd: '/tmp',
      title: 'original',
      titleSource: 'auto',
    });

    const conv = getConversationByName('refine-no-assistant');
    await handleTurnComplete(conv!, deps);

    expect(getConversationByName('refine-no-assistant')?.titleSource).toBe('auto');
    expect(emittedEvents).toHaveLength(0);

    // After 4 more turns the cadence counter should be 5, but without an assistant
    // message still no refinement.
    for (let i = 0; i < 4; i++) {
      await handleTurnComplete(conv!, deps);
    }
    expect(getConversationByName('refine-no-assistant')?.titleSource).toBe('auto');

    // Once an assistant message appears, the next turn refines immediately
    // because this is the first refinement.
    deps.getCachedMessages = vi.fn().mockResolvedValue({
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi there', completedAt: '2026-07-07T12:00:00Z' },
      ],
    });
    await handleTurnComplete(conv!, deps);
    expect(getConversationByName('refine-no-assistant')?.titleSource).toBe('ai-refined');
  });

  it('debounces later refinements to every 5 turns and 10 minutes', async () => {
    const deps = makeDeps({
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi there', completedAt: '2026-07-07T12:00:00Z' },
      ],
      summarizeResult: 'Second Refined Title',
    });

    createConversation({
      name: 'refine-later',
      tmuxSession: 'tmux-refine-later',
      cwd: '/tmp',
      title: 'First Refined Title',
      titleSource: 'ai-refined',
    });

    const conv = getConversationByName('refine-later');

    // First refinement already happened; simulate turns 1-4 with no model call.
    for (let i = 0; i < 4; i++) {
      await handleTurnComplete(conv!, deps);
    }
    expect(getConversationByName('refine-later')?.title).toBe('First Refined Title');

    // 5th turn, but still under the 10-minute interval.
    await handleTurnComplete(conv!, deps);
    expect(getConversationByName('refine-later')?.title).toBe('First Refined Title');

    // Advance past the 10-minute debounce.
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    await handleTurnComplete(conv!, deps);

    expect(getConversationByName('refine-later')?.title).toBe('Second Refined Title');
  });

  it('does not exploit missing cadence after restart for existing ai-refined conversations', async () => {
    const deps = makeDeps({
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi there', completedAt: '2026-07-07T12:00:00Z' },
      ],
      summarizeResult: 'Post-Restart Refined Title',
    });

    createConversation({
      name: 'refine-restart',
      tmuxSession: 'tmux-refine-restart',
      cwd: '/tmp',
      title: 'First Refined Title',
      titleSource: 'ai-refined',
    });

    // Simulate a process restart: the module-level cadence map is empty, but
    // the wall clock has advanced by an hour. Missing cadence must not be
    // treated as "last refined at epoch".
    vi.setSystemTime(60 * 60 * 1000);

    const conv = getConversationByName('refine-restart');

    for (let i = 0; i < 4; i++) {
      await handleTurnComplete(conv!, deps);
    }
    expect(getConversationByName('refine-restart')?.title).toBe('First Refined Title');

    // 5th turn is still inside the 10-minute interval seeded at the first call.
    await handleTurnComplete(conv!, deps);
    expect(getConversationByName('refine-restart')?.title).toBe('First Refined Title');

    // Advance past the 10-minute debounce from the first post-restart call.
    vi.setSystemTime(60 * 60 * 1000 + 10 * 60 * 1000 + 1);
    await handleTurnComplete(conv!, deps);

    expect(getConversationByName('refine-restart')?.title).toBe('Post-Restart Refined Title');
  });

  it('skips non-refinable title sources', async () => {
    const deps = makeDeps({
      messages: [{ role: 'assistant', text: 'hi', completedAt: '2026-07-07T12:00:00Z' }],
    });

    for (const source of ['manual', 'ai-explicit'] as const) {
      createConversation({
        name: `refine-${source}`,
        tmuxSession: `tmux-refine-${source}`,
        cwd: '/tmp',
        title: source === 'manual' ? 'My Title' : 'Explicit AI Title',
        titleSource: source,
      });

      const conv = getConversationByName(`refine-${source}`);
      await handleTurnComplete(conv!, deps);

      expect(getConversationByName(`refine-${source}`)?.titleSource).toBe(source);
    }

    expect(emittedEvents).toHaveLength(0);
  });
});
