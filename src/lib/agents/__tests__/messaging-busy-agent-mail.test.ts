import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../../agents.js';

/**
 * PAN-3738 — the mail filename is the routing table: plain `.md` is monitor
 * territory and `*.delivered.md` marks a post-delivery backup, so a receipt
 * never reads as a queue entry. The matrix below pins those filenames.
 *
 * A Codex app-server target is never parked in mail any more, even mid-turn:
 * the app-server adds the message to the running turn, and nothing drained
 * the old `*.pending.md` busy-turn mail for these targets (2026-11-06).
 */

let tmpHome: string;
let stateDir: string;

const loggerMocks = vi.hoisted(() => ({
  logAgentLifecycle: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(),
}));

vi.mock('../../operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
  operatorInterventionEvent: vi.fn(),
}));

vi.mock('../../persistent-logger.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logAgentLifecycle: loggerMocks.logAgentLifecycle,
}));

vi.mock('../../tmux.js', () => ({
  createSession: vi.fn(() => Effect.void),
  createSessionSync: vi.fn(),
  killSession: vi.fn(() => Effect.void),
  killSessionSync: vi.fn(),
  sendKeys: vi.fn(() => Effect.void),
  sendRawKeystroke: vi.fn(() => Effect.void),
  sessionExists: vi.fn(() => Effect.succeed(true)),
  isPaneDead: vi.fn(() => Effect.succeed(false)),
  sessionExistsSync: vi.fn(() => true),
  getAgentSessions: vi.fn(() => Effect.succeed([])),
  getAgentSessionsSync: vi.fn(() => []),
  capturePane: vi.fn(async () => ''),
  capturePaneSync: vi.fn(() => ''),
  listPaneValues: vi.fn(async () => []),
  listPaneValuesSync: vi.fn(() => []),
  setOption: vi.fn(() => Effect.void),
}));

vi.mock('../../paths.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    get AGENTS_DIR() {
      return stateDir;
    },
  };
});

vi.mock('../monitor-transport.js', () => ({
  formatMailFileContent: vi.fn(
    (body: string, source: string, date: Date) =>
      `# Message\n\nsource: ${source}\ndate: ${date.toISOString()}\n\n${body}\n`,
  ),
}));

// Only the app-server probe is faked — everything else in runtime-command is
// the real module, because messaging.ts imports seven other symbols from it.
vi.mock('../runtime-command.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCodexAppServerStatus: vi.fn(async () => ({ state: 'running' })),
}));

const deliveryMocks = vi.hoisted(() => ({
  deliverAgentMessage: vi.fn(async () => ({ ok: true })),
}));

// Same shape as the runtime-command mock: only the keystroke door is faked, so
// `resilientDeliveryMethod` and the resume helpers stay real.
vi.mock('../delivery.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deliverAgentMessage: deliveryMocks.deliverAgentMessage,
}));

import { messageAgent } from '../messaging.js';

function dedupMailName(dedupKey: string, suffix: string): string {
  return `dedup-${createHash('sha256').update(dedupKey).digest('hex').slice(0, 24)}${suffix}`;
}

function mailFiles(agentId: string): string[] {
  return readdirSync(join(stateDir, agentId, 'mail')).sort();
}

function writeAgentState(agentId: string, partial: Partial<AgentState> = {}): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  const state: AgentState = {
    id: agentId,
    issueId: 'PAN-3736',
    workspace: '/tmp/workspace',
    harness: 'codex',
    role: 'work',
    model: 'gpt-5.6-codex',
    status: 'running',
    startedAt: '2026-08-14T00:00:00.000Z',
    deliveryMethod: 'tmux',
    ...partial,
  };
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
}

describe('mail filename matrix (PAN-3738)', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-3738-mail-'));
    stateDir = join(tmpHome, 'agents');
    mkdirSync(stateDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
    loggerMocks.logAgentLifecycle.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
    deliveryMocks.deliverAgentMessage.mockReset();
    deliveryMocks.deliverAgentMessage.mockResolvedValue({ ok: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('suffixes an unkeyed post-delivery backup `<ts>.delivered.md`, even mid-turn', async () => {
    writeAgentState('agent-pan-3738-delivered');

    const result = await messageAgent('agent-pan-3738-delivered', 'peer ping', 'internal');

    expect(result.delivered).toBe(true);
    expect(deliveryMocks.deliverAgentMessage).toHaveBeenCalledTimes(1);
    const files = mailFiles('agent-pan-3738-delivered');
    expect(files).toHaveLength(1);
    // A receipt, not a queue entry — this is the file that read as stranded
    // mail during two PAN-3738 investigations when it was named `<ts>.md`.
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z\.delivered\.md$/);
    expect(readFileSync(join(stateDir, 'agent-pan-3738-delivered', 'mail', files[0]), 'utf8'))
      .toContain('peer ping');
  });

  it('suffixes a keyed post-delivery backup `dedup-<hash>.delivered.md`', async () => {
    writeAgentState('agent-pan-3738-delivered-keyed');

    await messageAgent('agent-pan-3738-delivered-keyed', 'peer ping', 'internal', { dedupKey: 'sent-1' });

    expect(mailFiles('agent-pan-3738-delivered-keyed')).toEqual([
      dedupMailName('sent-1', '.delivered.md'),
    ]);
  });

  it('leaves gated queue mail as plain `.md` (monitor territory, not the hook)', async () => {
    writeAgentState('agent-pan-3738-paused', { paused: true, pausedReason: 'operator' });

    const result = await messageAgent('agent-pan-3738-paused', 'peer ping', 'internal');

    expect(result.delivered).toBe(false);
    const files = mailFiles('agent-pan-3738-paused');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z\.md$/);
  });
});
