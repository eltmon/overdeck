import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    process.env.PANOPTICON_HOME = tmpHome;
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
    vi.mocked(sendKeys).mockClear();
  });

  afterEach(() => {
    delete process.env.PANOPTICON_HOME;
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
