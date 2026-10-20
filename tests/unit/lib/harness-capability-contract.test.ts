/**
 * PAN-4562 FR-17: a fake runtime definition drives CLI and dashboard-server
 * behavior with no consumer code change. Only the definition lookups in
 * @overdeck/contracts are mocked; each case sets a whole fake definition and
 * runs twice with opposite declarations, and the observed behavior flips.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HarnessBehavior, HarnessCapabilities } from '@overdeck/contracts';

const TEST_HOME = join(tmpdir(), `harness-capability-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

const fakeSlot = vi.hoisted(() => ({ current: null as HarnessBehavior | null }));
const configSlot = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const activityParsers = vi.hoisted(() => {
  const result = () => ({
    messages: [], workLog: [], byteOffset: 0, streaming: false, totalCost: 0, totalTokens: 0,
    latestAssistantUsage: null, observedEffort: null, contextBoundaryOffset: 0, contextActiveBytes: 0,
    pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: 0, mtimeMs: 0,
  });
  return { codex: vi.fn(async () => result()), kimi: vi.fn(async () => result()) };
});

vi.mock('@overdeck/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@overdeck/contracts')>();
  const isFake = (harness: unknown) => harness === 'fake-harness';
  const fake = () => {
    if (!fakeSlot.current) throw new Error('fake-harness definition not set');
    return fakeSlot.current;
  };
  return {
    ...actual,
    normalizeHarnessName: (harness: unknown) => (isFake(harness) ? 'fake-harness' : actual.normalizeHarnessName(harness)),
    getHarnessBehavior: (harness: never) => (isFake(harness) ? fake() : actual.getHarnessBehavior(harness)),
    getRuntimeBehavior: (harness: never) => (isFake(harness) ? fake() : actual.getRuntimeBehavior(harness)),
  };
});
vi.mock('../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: () => (configSlot.current ? { config: configSlot.current } : actual.loadConfigSync()),
  };
});
vi.mock('../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
vi.mock('../../../src/dashboard/server/services/codex-conversation-parser.js', () => ({
  parseCodexConversationMessages: activityParsers.codex,
}));
vi.mock('../../../src/dashboard/server/services/kimi-conversation-parser.js', () => ({
  parseKimiConversationMessages: activityParsers.kimi,
}));

const contracts = await import('@overdeck/contracts');
const { closeOverdeckDatabase } = await import('../../../src/lib/overdeck/infra.js');
const { createConversation } = await import('../../../src/lib/overdeck/conversations.js');
const { startConversationRuntime } = await import('../../../src/lib/overdeck/conversation-runtime.js');
const { transformMessageForHarness } = await import('../../../src/lib/overdeck/conversation-message.js');
const { configuredHarnessBinaryPath } = await import('../../../src/lib/harness-binary.js');
const { summarizeConversationActivity } = await import('../../../src/dashboard/server/services/conversation/activity-summary.js');
const { getGlobalRegistry } = await import('../../../src/lib/runtimes/index.js');

type FakeRuntime = Parameters<typeof transformMessageForHarness>[1];
const FAKE = 'fake-harness' as FakeRuntime;

/** Set the whole fake definition: Muse's adapter kinds with the given overrides. */
function declareFake(overrides: Partial<Omit<HarnessBehavior, 'capabilities'>> & { capabilities?: Partial<HarnessCapabilities> } = {}): void {
  const { capabilities, ...behavior } = overrides;
  fakeSlot.current = {
    ...contracts.MUSE_BEHAVIOR,
    displayName: 'Fake Harness',
    ...behavior,
    capabilities: { ...contracts.MUSE_CAPABILITIES, ...capabilities },
  };
}

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

beforeEach(() => {
  fakeSlot.current = null;
  configSlot.current = null;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('a fake runtime definition drives behavior with no consumer code change (PAN-4562)', () => {
  it.each([true, false])('startConversationRuntime tears down on a spawn failure iff stopRuntimeOnStartFailure (%s)', async (stopRuntimeOnStartFailure) => {
    declareFake({ capabilities: { stopRuntimeOnStartFailure } });
    const name = `fake-start-${stopRuntimeOnStartFailure}`;
    const conv = createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, harness: 'claude-code', workspaceId: null });
    const deps = {
      spawn: vi.fn(async () => { throw new Error('spawn failed'); }),
      waitReady: vi.fn(async () => undefined),
      deliver: vi.fn(async () => ({ ok: true as const, method: 'tmux' as const })),
      stop: vi.fn(async () => undefined),
    };

    await startConversationRuntime({
      conv, tmuxSession: `conv-${name}`, cwd: TEST_HOME, claudeSessionId: `sess-${name}`,
      harness: FAKE, launchContext: { bareContext: false, skipClaudeMd: false }, message: 'go',
    }, deps as never);

    expect(deps.stop).toHaveBeenCalledTimes(stopRuntimeOnStartFailure ? 1 : 0);
  });

  it.each(['native', 'inline-paths'] as const)('transformMessageForHarness follows attachmentDelivery=%s (the dashboard message route path)', (attachmentDelivery) => {
    declareFake({ capabilities: { attachmentDelivery } });
    const out = transformMessageForHarness('see file', FAKE, ['/tmp/a.png']);
    if (attachmentDelivery === 'native') expect(out).toBe('see file');
    else expect(out).toBe('Use the Read tool to inspect these attached files:\n- /tmp/a.png\n\nMessage:\nsee file');
  });

  it.each([
    ['acp.kimi.binaryPath', '/opt/acp-kimi'],
    ['kimiCode.binaryPath', '/opt/kimi-code'],
  ] as const)('configuredHarnessBinaryPath reads the declared binaryConfigKey %s', (binaryConfigKey, expected) => {
    configSlot.current = { acp: { kimi: { binaryPath: '/opt/acp-kimi' } }, kimiCode: { binaryPath: '/opt/kimi-code' } };
    declareFake({ capabilities: { binaryConfigKey } });
    expect(configuredHarnessBinaryPath(FAKE)).toBe(expected);
  });

  it.each([
    ['codex-rollout-jsonl', 'codex'],
    ['kimi-wire-jsonl', 'kimi'],
  ] as const)('the dashboard activity summary selects its parser from the declared transcriptKind %s', async (transcriptKind, parser) => {
    declareFake({ transcriptKind });
    activityParsers.codex.mockClear();
    activityParsers.kimi.mockClear();
    // A distinct file per run: the activity cache key includes the path.
    const file = join(TEST_HOME, `fake-${transcriptKind}.jsonl`);
    writeFileSync(file, '{}\n');

    await summarizeConversationActivity(file, { harness: 'fake-harness' });

    expect(activityParsers.codex).toHaveBeenCalledTimes(parser === 'codex' ? 1 : 0);
    expect(activityParsers.kimi).toHaveBeenCalledTimes(parser === 'kimi' ? 1 : 0);
  });
});

describe('every registered runtime declares its capabilities (PAN-4562 AC1)', () => {
  it('has every HARNESS_CAPABILITY_KEYS value defined', () => {
    const runtimes = getGlobalRegistry().getAll();
    expect(runtimes.length).toBeGreaterThan(0);
    for (const runtime of runtimes) {
      const capabilities = contracts.getRuntimeBehavior(runtime.name).capabilities;
      for (const key of contracts.HARNESS_CAPABILITY_KEYS) expect(capabilities[key], `${runtime.name}.${key}`).not.toBeUndefined();
    }
  });
});
