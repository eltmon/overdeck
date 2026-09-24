import { Effect } from 'effect';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  setAgentPaused: vi.fn(),
  clearAgentPaused: vi.fn(),
  clearAgentTroubled: vi.fn(),
  stopAgent: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(() => false),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(async () => {}),
}));

const unpauseMocks = vi.hoisted(() => ({
  getWorkAgentLifecycleStateSync: vi.fn(() => ({ canResumeSession: false })),
  resumeAgent: vi.fn(async () => ({ success: true })),
}));

const FAKE_AGENTS_DIR_LISTING = vi.hoisted(() => ({
  entries: [] as string[],
}));

const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
const SINGLETON_AGENT_IDS = new Set(['flywheel-orchestrator', 'sequencer-runner']);
const isQualifiedAgentIdForTest = (input: string): boolean => {
  const lower = input.toLowerCase();
  return SINGLETON_AGENT_IDS.has(lower) || AGENT_PREFIXES.some(p => lower.startsWith(p));
};

const resolveAgentTargetSyncForTest = (target: string): string => {
  const lower = target.toLowerCase();
  if (SINGLETON_AGENT_IDS.has(lower)) return lower;
  if (isQualifiedAgentIdForTest(target)) return lower;
  return `agent-${lower}`;
};

let actualResolveAgentTargetSync: ((target: string) => string) | undefined;

vi.mock('../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/agents.js')>();
  return {
    ...actual,
    ...agentMocks,
    isQualifiedAgentId: isQualifiedAgentIdForTest,
    resolveAgentTargetSync: resolveAgentTargetSyncForTest,
  };
});

// PAN-3947: pan kill/pause probe liveness through the terminal backend;
// the fake mirrors the tmux session mock so each case sets liveness once.
vi.mock('../../../lib/terminal-backends/launch.js', () => ({
  agentPaneExists: vi.fn(async (id: string) => (tmuxMocks.sessionExistsSync as (name: string) => boolean)(id)),
}));

vi.mock('../../../lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tmux.js')>();
  return { ...actual, sessionExistsSync: tmuxMocks.sessionExistsSync };
});

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

vi.mock('../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: unpauseMocks.getWorkAgentLifecycleStateSync,
}));

vi.mock('../../../lib/agents/resume.js', () => ({
  resumeAgent: unpauseMocks.resumeAgent,
}));

vi.mock('../../../lib/remote/index.js', () => ({
  isRemoteAvailable: vi.fn(async () => ({ available: false, reason: 'test' })),
}));

vi.mock('../../../lib/remote/remote-agents.js', () => ({
  killRemoteAgent: vi.fn(async () => {}),
  loadRemoteAgentState: vi.fn(() => null),
}));

// Keep kill's post-kill Docker teardown inert: no workspace found → no teardown.
vi.mock('../../../lib/lifecycle/archive-planning.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/lifecycle/archive-planning.js')>();
  return { ...actual, findWorkspacePath: vi.fn(() => null) };
});

vi.mock('../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/projects.js')>();
  return { ...actual, resolveProjectFromIssueSync: vi.fn(() => null) };
});

// Let kill's issue-scoped discovery see a controlled agents dir.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (p: unknown) =>
      String(p).endsWith('/agents') && FAKE_AGENTS_DIR_LISTING.entries.length > 0
        ? true
        : actual.existsSync(p as never),
    readdirSync: ((p: unknown, ...rest: never[]) =>
      String(p).endsWith('/agents') && FAKE_AGENTS_DIR_LISTING.entries.length > 0
        ? FAKE_AGENTS_DIR_LISTING.entries
        : actual.readdirSync(p as never, ...rest)) as typeof actual.readdirSync,
  };
});

const STOPPED_STATE = { issueId: 'PAN-1723', status: 'stopped' };

beforeAll(async () => {
  ({ resolveAgentTargetSync: actualResolveAgentTargetSync } = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js'));
});

beforeEach(() => {
  agentMocks.setAgentPaused.mockReturnValue(Effect.succeed(null));
  agentMocks.clearAgentPaused.mockReturnValue(Effect.succeed(null));
  agentMocks.clearAgentTroubled.mockReturnValue(Effect.succeed(null));
  vi.clearAllMocks();
  agentMocks.stopAgent.mockReturnValue(Effect.void);
  FAKE_AGENTS_DIR_LISTING.entries = [];
  agentMocks.getAgentStateSync.mockReturnValue(STOPPED_STATE);
  tmuxMocks.sessionExistsSync.mockReturnValue(false);
});

describe('resolveAgentTargetSync (PAN-1760)', () => {
  it('preserves strike-/inspect- prefixed agent IDs', async () => {
    expect(actualResolveAgentTargetSync!('strike-pan-1723')).toBe('strike-pan-1723');
    expect(actualResolveAgentTargetSync!('inspect-pan-1744-workspace-flccb')).toBe('inspect-pan-1744-workspace-flccb');
  });

  it('lowercases qualified agent IDs to match on-disk state dirs', async () => {
    expect(actualResolveAgentTargetSync!('STRIKE-PAN-1723')).toBe('strike-pan-1723');
    expect(actualResolveAgentTargetSync!('agent-PAN-1190-ship')).toBe('agent-pan-1190-ship');
  });

  it('preserves singleton IDs', async () => {
    expect(actualResolveAgentTargetSync!('flywheel-orchestrator')).toBe('flywheel-orchestrator');
  });

  it('prefixes bare issue IDs with agent-', async () => {
    expect(actualResolveAgentTargetSync!('PAN-1148')).toBe('agent-pan-1148');
  });
});

describe('pauseCommand agent targeting (PAN-1760)', () => {
  it('pauses a strike session by its full agent ID', async () => {
    const { pauseCommand } = await import('../pause.js');
    await pauseCommand('strike-pan-1723', {});
    expect(agentMocks.setAgentPaused).toHaveBeenCalledWith('strike-pan-1723', undefined, false);
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1723', kind: 'pause' }),
    );
  });

  it('still pauses the canonical work agent for a bare issue ID', async () => {
    const { pauseCommand } = await import('../pause.js');
    await pauseCommand('PAN-1723', { reason: 'ram' });
    expect(agentMocks.setAgentPaused).toHaveBeenCalledWith('agent-pan-1723', 'ram', false);
  });
});

describe('unpauseCommand agent targeting (PAN-1760)', () => {
  it('unpauses a strike session by its full agent ID', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ ...STOPPED_STATE, paused: true });
    const { unpauseCommand } = await import('../unpause.js');
    await unpauseCommand('strike-pan-1723');
    expect(agentMocks.clearAgentPaused).toHaveBeenCalledWith('strike-pan-1723');
  });
});

describe('killCommand agent targeting (PAN-1760)', () => {
  it('kills exactly the named agent for a fully-qualified agent ID', async () => {
    const { killCommand } = await import('../kill.js');
    await killCommand('strike-pan-1723', {});
    expect(agentMocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-1723', 'operator');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1723', kind: 'pause' }),
    );
  });

  it('discovers strike/inspect agents during issue-scoped kills', async () => {
    FAKE_AGENTS_DIR_LISTING.entries = [
      'strike-pan-1723',
      'inspect-pan-1723-task-slug',
      'agent-pan-9999',
    ];
    const { killCommand } = await import('../kill.js');
    await killCommand('PAN-1723', {});
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-1723', 'operator');
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('inspect-pan-1723-task-slug', 'operator');
    expect(agentMocks.stopAgent).not.toHaveBeenCalledWith('agent-pan-9999');
  });
});
