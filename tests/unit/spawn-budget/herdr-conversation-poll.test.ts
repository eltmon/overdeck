/**
 * PAN-5176 FR-19 (the PAN-5169 bug class): on the Herdr backend with tmux
 * missing, a full conversation poll spawns tmux 0 times. A full poll is the
 * conversation list, the pending-input feed and a single read of each of three
 * live claude-code conversations, with the same read dependencies the
 * conversations route passes.
 *
 * The read path runs real: conversation-list, conversation-reads,
 * conversation-liveness, conversation-pane-choice, tmux.ts and the
 * resolveAgentPaneIo body. Only Herdr's socket calls are stubbed, and
 * resolveAgentPaneIo is wrapped in a passthrough spy that proves the polled
 * reads ran, so the 0 count is not vacuous. The positive control switches the
 * host to the tmux backend with tmux present and records at least one
 * (redirected) tmux call.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ledger = await vi.hoisted(async () =>
  (await import('../../helpers/spawn-budget.js')).installSpawnLedger());

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-5176-herdr-conversation-poll-'));
process.env.OVERDECK_HOME = TEST_HOME;
const savedBackend = process.env.OVERDECK_TERMINAL_BACKEND;
process.env.OVERDECK_TERMINAL_BACKEND = 'herdr';

const NAMES = ['poll-a', 'poll-b', 'poll-c'] as const;

vi.mock('../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
// Outside the read path: the ledger-cost snapshot runs on a dashboard DB
// worker thread, whose tsx bootstrap does not load under Vitest.
vi.mock('../../../src/dashboard/server/services/dashboard-poll-snapshots.js', () => ({
  getConversationLedgerCostsSnapshot: async () => [],
}));
vi.mock('../../../src/lib/terminal-backends/herdr.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/terminal-backends/herdr.js')>()),
  findHerdrAgentPane: async () => null,
  readHerdrPaneText: async () => '',
  probeHerdrAgentLiveness: async () => ({ kind: 'alive' }),
  listHerdrAgents: async () => ['poll-a', 'poll-b', 'poll-c'].map((name) => ({ agentId: `conv-${name}`, state: 'idle' })),
}));
vi.mock('../../../src/lib/terminal-backends/agent-pane-io.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/terminal-backends/agent-pane-io.js')>();
  return { ...actual, resolveAgentPaneIo: vi.fn(actual.resolveAgentPaneIo) };
});

const { createConversation, markConversationRunning } = await import('../../../src/lib/overdeck/conversations.js');
const { closeOverdeckDatabase } = await import('../../../src/lib/overdeck/infra.js');
const { getEnrichedConversationList, invalidateConversationListEnrichmentCache } = await import('../../../src/lib/overdeck/conversation-list.js');
const { getConversationRead, getConversationsPendingInputFeed, resolveSessionFile } = await import('../../../src/lib/overdeck/conversation-reads.js');
const { conversationSessionAlive, listLiveConversationSessions } = await import('../../../src/lib/overdeck/conversation-liveness.js');
const { resetHostTerminalBackendName } = await import('../../../src/lib/terminal-backends/select.js');
const { resetHostToolsForTests, setHostToolFinderForTests } = await import('../../../src/lib/host-tools.js');
const { resolveAgentPaneIo } = await import('../../../src/lib/terminal-backends/agent-pane-io.js');

for (const name of NAMES) {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, title: `Poll ${name}` });
  markConversationRunning(name);
}

/** The deps `src/dashboard/server/routes/conversations.ts` passes (conversationReadDependencies). */
const deps = {
  resolveSessionFile,
  tmuxSessionExists: conversationSessionAlive,
  listSessionNames: async () => [...((await listLiveConversationSessions()) ?? [])],
};

async function poll(): Promise<void> {
  await getEnrichedConversationList(500, 0);
  await getConversationsPendingInputFeed(deps);
  for (const name of NAMES) await getConversationRead(name, deps);
}

beforeEach(() => {
  ledger.reset();
  vi.mocked(resolveAgentPaneIo).mockClear();
  resetHostTerminalBackendName();
  setHostToolFinderForTests((name) => (name === 'tmux' ? null : name));
  invalidateConversationListEnrichmentCache();
});

afterAll(() => {
  if (savedBackend === undefined) delete process.env.OVERDECK_TERMINAL_BACKEND;
  else process.env.OVERDECK_TERMINAL_BACKEND = savedBackend;
  resetHostTerminalBackendName();
  resetHostToolsForTests();
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  ledger.restore();
});

describe('Herdr conversation poll with tmux missing', () => {
  it('spawns tmux 0 times and reaches the polled pane reads', async () => {
    await poll();
    expect(ledger.count({ programs: ['tmux'] })).toBe(0);
    const herdrOnlyReads = vi.mocked(resolveAgentPaneIo).mock.calls
      .filter((call) => JSON.stringify(call[2]) === JSON.stringify({ legacyTmuxFallback: false }));
    expect(herdrOnlyReads.length).toBeGreaterThanOrEqual(3);
  });

  it('positive control: on the tmux backend with tmux present, the same poll spawns tmux', async () => {
    process.env.OVERDECK_TERMINAL_BACKEND = 'tmux';
    resetHostTerminalBackendName();
    setHostToolFinderForTests((name) => (name === 'tmux' ? '/usr/bin/tmux' : name));
    try {
      await poll();
      expect(ledger.count({ programs: ['tmux'] })).toBeGreaterThanOrEqual(1);
    } finally {
      process.env.OVERDECK_TERMINAL_BACKEND = 'herdr';
      resetHostTerminalBackendName();
    }
  });
});
