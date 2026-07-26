import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../agents.js';

let tmpHome: string;
let stateDir: string;

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(),
}));

vi.mock('../operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
  operatorInterventionEvent: vi.fn(),
}));

vi.mock('../tmux.js', () => ({
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

// PAN-1594: messageAgent's pre-send readiness check is now hook-driven
// (waitForAgentIdle → runtime mirror 'idle'), not a tmux pane-scrape. Present
// the agent as idle so delivery proceeds immediately instead of waiting out the
// 5s readiness timeout.
vi.mock('../agent-runtime-mirror.js', () => ({
  getRuntimeSnapshot: vi.fn(() => Effect.succeed({ activity: 'idle', lastActivity: new Date().toISOString() })),
  isAgentStateServiceInProcess: vi.fn(() => Effect.succeed(false)),
}));

vi.mock('../paths.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    get AGENTS_DIR() {
      return stateDir;
    },
  };
});

// PAN-3015 monitor tier is mocked so tests can flip liveness per case.
vi.mock('../agents/monitor-transport.js', () => ({
  isMonitorLive: vi.fn(() => false),
  formatMailFileContent: vi.fn(
    (body: string, source: string, date: Date) =>
      `# Message\n\nsource: ${source}\ndate: ${date.toISOString()}\n\n${body}\n`,
  ),
}));

vi.mock('../tmux-dedup.js', () => ({
  sendKeysDedup: vi.fn(async () => 'pasted'),
  completeKeyedSubmit: vi.fn(async () => undefined),
}));

// Resume is mocked at its source module so the agents barrel re-exports the
// mock to messaging.ts's dynamic import.
vi.mock('../agents/resume.js', () => ({
  resumeAgent: vi.fn(async () => ({ success: true, messageDelivered: true })),
  buildCompactRecoverySeed: vi.fn(() => null),
}));

import { messageAgent } from '../agents.js';
import { sendKeys } from '../tmux.js';

function writeAgentState(agentId: string, partial: Partial<AgentState> = {}): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  const state: AgentState = {
    id: agentId,
    issueId: 'PAN-1487',
    workspace: '/tmp/workspace',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-25T00:00:00.000Z',
    deliveryMethod: 'tmux',
    ...partial,
  };
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
}

describe('messageAgent operator interventions', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-message-agent-'));
    stateDir = join(tmpHome, 'agents');
    mkdirSync(stateDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
    vi.mocked(sendKeys).mockClear();
  });

  afterEach(() => {
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('emits a tell intervention for pan-tell callers', async () => {
    writeAgentState('agent-pan-1487');

    await messageAgent('agent-pan-1487', 'hello agent', 'pan-tell');

    expect(sendKeys).toHaveBeenCalledWith('agent-pan-1487', 'hello agent');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-1487',
      kind: 'tell',
      source: 'pan-tell',
    });
  });

  it('does not emit for internal callers', async () => {
    writeAgentState('agent-pan-1487');

    await messageAgent('agent-pan-1487', 'review nudge', 'review:nudge');

    expect(sendKeys).toHaveBeenCalledWith('agent-pan-1487', 'review nudge');
    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
  });

  it('skips tell intervention when state.json has no issueId', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    writeAgentState('agent-pan-1487', { issueId: undefined as unknown as string });

    await messageAgent('agent-pan-1487', 'hello without issue', 'pan-tell');

    expect(sendKeys).toHaveBeenCalledWith('agent-pan-1487', 'hello without issue');
    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith('[agents] Skipping tell intervention for agent-pan-1487; state.json has no issueId');
  });
});

describe('messageAgent monitor tier vs keyed deliveries (PAN-2997 cycle 7)', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-message-agent-'));
    stateDir = join(tmpHome, 'agents');
    mkdirSync(stateDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
  });

  afterEach(() => {
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('BYPASSES the live monitor tier for a keyed delivery and uses the keyed door', async () => {
    const { isMonitorLive } = await import('../agents/monitor-transport.js');
    const { sendKeysDedup, completeKeyedSubmit } = await import('../tmux-dedup.js');
    vi.mocked(isMonitorLive).mockReturnValue(true);
    vi.mocked(sendKeysDedup).mockClear();
    vi.mocked(completeKeyedSubmit).mockClear();
    writeAgentState('agent-pan-2997');

    const result = await messageAgent('agent-pan-2997', 'Linear auth is healthy — recheck', 'linear-mcp-auth-wake', {
      dedupKey: 'linear-mcp-auth-wake:lifecycle-1',
    });

    // The keyed door enforced the delivery; the monitor mail spool never saw it.
    expect(result.delivered).toBe(true);
    expect(result.reason).not.toBe('monitor');
    expect(vi.mocked(sendKeysDedup)).toHaveBeenCalledWith(
      'agent-pan-2997',
      'Linear auth is healthy — recheck',
      'linear-mcp-auth-wake:lifecycle-1',
      'messageAgent:linear-mcp-auth-wake',
    );
    expect(vi.mocked(completeKeyedSubmit)).toHaveBeenCalledWith('agent-pan-2997', 'linear-mcp-auth-wake:lifecycle-1');
    expect(existsSync(join(stateDir, 'agent-pan-2997', 'mail'))).toBe(false);
  });

  it('still routes UNKEYED mid-session tells through a live monitor', async () => {
    const { isMonitorLive } = await import('../agents/monitor-transport.js');
    const { sendKeysDedup } = await import('../tmux-dedup.js');
    vi.mocked(isMonitorLive).mockReturnValue(true);
    vi.mocked(sendKeysDedup).mockClear();
    writeAgentState('agent-pan-3015');

    const result = await messageAgent('agent-pan-3015', 'ordinary tell', 'internal');

    expect(result).toMatchObject({ delivered: true, queuedToMail: true, reason: 'monitor' });
    expect(vi.mocked(sendKeysDedup)).not.toHaveBeenCalled();
    expect(existsSync(join(stateDir, 'agent-pan-3015', 'mail'))).toBe(true);
  });

  it('resumes a STOPPED agent bare and delivers the keyed wake through the keyed door (cycle 7)', async () => {
    const { resumeAgent } = await import('../agents/resume.js');
    const { sendKeysDedup, completeKeyedSubmit } = await import('../tmux-dedup.js');
    vi.mocked(resumeAgent).mockClear();
    vi.mocked(sendKeysDedup).mockClear();
    vi.mocked(completeKeyedSubmit).mockClear();
    writeAgentState('agent-pan-2997-stopped', { status: 'stopped' });

    const result = await messageAgent('agent-pan-2997-stopped', 'Linear auth is healthy — recheck', 'linear-mcp-auth-wake', {
      dedupKey: 'linear-mcp-auth-wake:lifecycle-1',
    });

    // The wake never rode the resume kickoff prompt…
    expect(vi.mocked(resumeAgent)).toHaveBeenCalledWith('agent-pan-2997-stopped');
    // …it was enforced by the keyed door of the new session instead.
    expect(vi.mocked(sendKeysDedup)).toHaveBeenCalledWith(
      'agent-pan-2997-stopped',
      'Linear auth is healthy — recheck',
      'linear-mcp-auth-wake:lifecycle-1',
      'messageAgent:linear-mcp-auth-wake',
    );
    expect(vi.mocked(completeKeyedSubmit)).toHaveBeenCalledWith('agent-pan-2997-stopped', 'linear-mcp-auth-wake:lifecycle-1');
    expect(result.delivered).toBe(true);
    // No keyed mail backup — that file would be a replay channel.
    expect(existsSync(join(stateDir, 'agent-pan-2997-stopped', 'mail'))).toBe(false);
  });
});
