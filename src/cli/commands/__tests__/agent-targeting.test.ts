import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  setAgentPausedSync: vi.fn(),
  clearAgentPausedSync: vi.fn(),
  clearAgentTroubledSync: vi.fn(),
  stopAgentSync: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(() => false),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(async () => {}),
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
const resolveAgentTargetSyncForTest = (input: string): string | null => {
  if (isQualifiedAgentIdForTest(input)) return input.toLowerCase();
  return /^pan-\d+$/i.test(input) ? `agent-${input.toLowerCase()}` : null;
};

// Keep the real targeting semantics for normalizeAgentId / isQualifiedAgentId / resolveAgentTargetSync —
// the PAN-1760 regression was these commands bypassing them with a naive
// `agent-` prefix, which made strike-/inspect- sessions unaddressable.
vi.mock('../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/agents.js')>();
  return {
    ...actual,
    ...agentMocks,
    isQualifiedAgentId: isQualifiedAgentIdForTest,
    resolveAgentTargetSync: resolveAgentTargetSyncForTest,
  };
});

vi.mock('../../../lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tmux.js')>();
  return { ...actual, sessionExistsSync: tmuxMocks.sessionExistsSync };
});

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
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

beforeEach(() => {
  vi.clearAllMocks();
  FAKE_AGENTS_DIR_LISTING.entries = [];
  agentMocks.getAgentStateSync.mockReturnValue(STOPPED_STATE);
  tmuxMocks.sessionExistsSync.mockReturnValue(false);
});

describe('resolveAgentTargetSync (PAN-1760)', () => {
  it('preserves strike-/inspect- prefixed agent IDs', async () => {
    const { resolveAgentTargetSync } = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
    expect(resolveAgentTargetSync('strike-pan-1723')).toBe('strike-pan-1723');
    expect(resolveAgentTargetSync('inspect-pan-1744-workspace-flccb')).toBe('inspect-pan-1744-workspace-flccb');
  });

  it('lowercases qualified agent IDs to match on-disk state dirs', async () => {
    const { resolveAgentTargetSync } = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
    expect(resolveAgentTargetSync('STRIKE-PAN-1723')).toBe('strike-pan-1723');
    expect(resolveAgentTargetSync('agent-PAN-1190-ship')).toBe('agent-pan-1190-ship');
  });

  it('preserves singleton IDs', async () => {
    const { resolveAgentTargetSync } = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
    expect(resolveAgentTargetSync('flywheel-orchestrator')).toBe('flywheel-orchestrator');
  });

  it('prefixes bare issue IDs with agent-', async () => {
    const { resolveAgentTargetSync } = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
    expect(resolveAgentTargetSync('PAN-1148')).toBe('agent-pan-1148');
  });
});

describe('pauseCommand agent targeting (PAN-1760)', () => {
  it('pauses a strike session by its full agent ID', async () => {
    const { pauseCommand } = await import('../pause.js');
    await pauseCommand('strike-pan-1723', {});
    expect(agentMocks.setAgentPausedSync).toHaveBeenCalledWith('strike-pan-1723', undefined, false);
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1723', kind: 'pause' }),
    );
  });

  it('still pauses the canonical work agent for a bare issue ID', async () => {
    const { pauseCommand } = await import('../pause.js');
    await pauseCommand('PAN-1723', { reason: 'ram' });
    expect(agentMocks.setAgentPausedSync).toHaveBeenCalledWith('agent-pan-1723', 'ram', false);
  });
});

describe('unpauseCommand agent targeting (PAN-1760)', () => {
  it('unpauses a strike session by its full agent ID', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ ...STOPPED_STATE, paused: true });
    const { unpauseCommand } = await import('../unpause.js');
    await unpauseCommand('strike-pan-1723');
    expect(agentMocks.clearAgentPausedSync).toHaveBeenCalledWith('strike-pan-1723');
  });
});

describe('untroubledCommand agent targeting (PAN-1760)', () => {
  it('clears a troubled inspect session by its full agent ID', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ ...STOPPED_STATE, troubled: true });
    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('inspect-pan-1744-workspace-flccb');
    expect(agentMocks.clearAgentTroubledSync).toHaveBeenCalledWith('inspect-pan-1744-workspace-flccb');
  });
});

describe('killCommand agent targeting (PAN-1760)', () => {
  it('kills exactly the named agent for a fully-qualified agent ID', async () => {
    const { killCommand } = await import('../kill.js');
    await killCommand('strike-pan-1723', {});
    expect(agentMocks.stopAgentSync).toHaveBeenCalledTimes(1);
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('strike-pan-1723');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1723', kind: 'pause' }),
    );
  });

  it('discovers strike/inspect agents during issue-scoped kills', async () => {
    FAKE_AGENTS_DIR_LISTING.entries = [
      'strike-pan-1723',
      'inspect-pan-1723-bead-slug',
      'agent-pan-9999',
    ];
    const { killCommand } = await import('../kill.js');
    await killCommand('PAN-1723', {});
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('strike-pan-1723');
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('inspect-pan-1723-bead-slug');
    expect(agentMocks.stopAgentSync).not.toHaveBeenCalledWith('agent-pan-9999');
  });
});
