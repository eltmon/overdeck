import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../../agents.js';

/**
 * PAN-3736 — a busy agent is a WORKING agent. When `messageAgent` parks a
 * message in the mail file because the target is mid-turn, every user-facing
 * string must say the agent is alive and name the mail file.
 *
 * PAN-3738 — and the file it parks the message in must be one something drains.
 * The mail filename is the routing table: `*.pending.md` is replayed by the
 * codex notify hook at the next turn end, plain `.md` is monitor territory, and
 * `*.delivered.md` marks a post-delivery backup so a receipt never reads as a
 * queue entry. The matrix below pins every (dedupKey × kind) filename.
 */

let tmpHome: string;
let stateDir: string;

const loggerMocks = vi.hoisted(() => ({
  logAgentLifecycleSync: vi.fn(),
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
  logAgentLifecycleSync: loggerMocks.logAgentLifecycleSync,
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
  capturePane: vi.fn(() => Effect.succeed('')),
  capturePaneSync: vi.fn(() => ''),
  listPaneValues: vi.fn(() => Effect.succeed([])),
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
  isMonitorLive: vi.fn(() => false),
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

const HOOK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../sync-sources/hooks/codex-notify-hook',
);

/** The suffix the codex notify hook filters mail on, read out of the hook
 * itself so drift on either side of the contract fails this suite. */
function notifyHookMailSuffix(): string {
  const source = readFileSync(HOOK_PATH, 'utf8');
  const match = /\.filter\(\(name\) => name\.endsWith\('([^']+)'\)\)/.exec(source);
  if (!match) throw new Error(`no mail filter found in ${HOOK_PATH}`);
  return match[1];
}

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

/** Codex writes `turn-completed` at every idle boundary; `messageAgent` claims
 * the marker to take the delivery path instead of the busy-turn mail path. */
function markIdle(agentId: string): void {
  writeFileSync(join(stateDir, agentId, 'turn-completed'), '2026-08-14T00:00:00.000Z\n');
}

describe('messageAgent busy-agent mail wording (PAN-3736)', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-3736-busy-'));
    stateDir = join(tmpHome, 'agents');
    mkdirSync(stateDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
    loggerMocks.logAgentLifecycleSync.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reports the agent as alive and mid-turn, and names the mail file', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeAgentState('agent-pan-3736');

    const result = await messageAgent('agent-pan-3736', 'peer ping', 'pan-tell');

    const mailDir = join(stateDir, 'agent-pan-3736', 'mail');
    expect(existsSync(mailDir)).toBe(true);

    // The reason states the agent is alive, names a real file, and never
    // promises turn-end delivery.
    expect(result.reason).toMatch(/^agent is alive and mid-turn; message queued to its mail file \(.+\)$/);
    // Check the wording without the path — a tmp dir name can contain anything.
    const phrase = result.reason?.split(' (')[0];
    expect(phrase).not.toMatch(/turn-end/);
    expect(phrase).not.toMatch(/busy/);

    const mailPath = /\(([^)]+)\)$/.exec(result.reason ?? '')?.[1];
    expect(mailPath).toBeDefined();
    expect(mailPath!.startsWith(mailDir)).toBe(true);
    expect(existsSync(mailPath!)).toBe(true);
    expect(readFileSync(mailPath!, 'utf8')).toContain('peer ping');

    // Same phrase on the lifecycle log and the console line.
    expect(loggerMocks.logAgentLifecycleSync).toHaveBeenCalledWith(
      'agent-pan-3736',
      `messageAgent: ${result.reason}`,
    );
    expect(logSpy).toHaveBeenCalledWith(`[agents] agent-pan-3736: ${result.reason}`);
  });

  it('leaves the delivery mechanics and return fields untouched', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    writeAgentState('agent-pan-3736-fields');

    const result = await messageAgent('agent-pan-3736-fields', 'peer ping', 'internal');

    expect(result.delivered).toBe(true);
    expect(result.queuedToMail).toBe(true);
    // Still the `.pending` mail file the codex notify hook looks for.
    const mailDir = join(stateDir, 'agent-pan-3736-fields', 'mail');
    const mailPath = /\(([^)]+)\)$/.exec(result.reason ?? '')?.[1];
    expect(mailPath!.startsWith(mailDir)).toBe(true);
    expect(mailPath!.endsWith('.pending.md')).toBe(true);
  });
});

describe('mail filename matrix (PAN-3738)', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-3738-mail-'));
    stateDir = join(tmpHome, 'agents');
    mkdirSync(stateDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
    loggerMocks.logAgentLifecycleSync.mockReset();
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

  it('names unkeyed busy-turn mail `<ts>.pending.md`', async () => {
    writeAgentState('agent-pan-3738-busy');

    await messageAgent('agent-pan-3738-busy', 'peer ping', 'internal');

    const files = mailFiles('agent-pan-3738-busy');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z\.pending\.md$/);
  });

  it('names keyed busy-turn mail `dedup-<hash>.pending.md` — the suffix the hook drains', async () => {
    writeAgentState('agent-pan-3738-busy-keyed');

    await messageAgent('agent-pan-3738-busy-keyed', 'peer ping', 'internal', { dedupKey: 'redrive-1' });

    // Deterministic name (a crash-replayed send overwrites the same file)
    // PLUS the drainable suffix — before PAN-3738 it was `dedup-<hash>.md`,
    // which the notify hook never looked at, so the message stranded.
    expect(mailFiles('agent-pan-3738-busy-keyed')).toEqual([
      dedupMailName('redrive-1', '.pending.md'),
    ]);
  });

  it('overwrites the same keyed busy file on a replayed send', async () => {
    writeAgentState('agent-pan-3738-replay');

    await messageAgent('agent-pan-3738-replay', 'peer ping', 'internal', { dedupKey: 'redrive-2' });
    await messageAgent('agent-pan-3738-replay', 'peer ping', 'internal', { dedupKey: 'redrive-2' });

    expect(mailFiles('agent-pan-3738-replay')).toEqual([dedupMailName('redrive-2', '.pending.md')]);
  });

  it('produces a keyed busy filename the codex notify hook filter matches', async () => {
    // String-level: the suffix is read out of the hook script, so drift on
    // either side of the contract (renaming here, re-filtering there) fails.
    const suffix = notifyHookMailSuffix();
    expect(suffix).toBe('.pending.md');

    writeAgentState('agent-pan-3738-hook');
    await messageAgent('agent-pan-3738-hook', 'peer ping', 'internal', { dedupKey: 'hook-key' });

    const [mailFile] = mailFiles('agent-pan-3738-hook');
    expect(mailFile).toBe(dedupMailName('hook-key', '.pending.md'));
    expect(mailFile.endsWith(suffix)).toBe(true);
  });

  it('suffixes an unkeyed post-delivery backup `<ts>.delivered.md`', async () => {
    writeAgentState('agent-pan-3738-delivered');
    markIdle('agent-pan-3738-delivered');

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
    markIdle('agent-pan-3738-delivered-keyed');

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
