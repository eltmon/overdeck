import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../../agents.js';

/**
 * PAN-3736 — a busy agent is a WORKING agent. When `messageAgent` parks a
 * message in the mail file because the target is mid-turn, every user-facing
 * string must say the agent is alive and name the mail file, and must not
 * promise turn-end delivery (PAN-3738 owns the queue nothing drains).
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

import { messageAgent } from '../messaging.js';

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

  it('leaves the delivery mechanics and return fields untouched (PAN-3738 owns those)', async () => {
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
