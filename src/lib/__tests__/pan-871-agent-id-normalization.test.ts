import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn((path: string) => String(path).includes('agent-pan-871/state.json') || String(path) === '/tmp/test/agents'),
  readFileSync: vi.fn(() => JSON.stringify({
    issueId: 'PAN-871',
    workspace: '/tmp/workspace',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-04-27T00:00:00.000Z',
  })),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn((_path: string, opts?: any) => {
    if (opts && typeof opts === 'object' && 'withFileTypes' in opts) {
      return [{ name: 'agent-pan-871', isDirectory: () => true }];
    }
    return [];
  }),
  appendFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: 0 })),
}));

vi.mock('../tmux.js', () => ({
  createSession: vi.fn(),
  createSessionAsync: vi.fn(),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  killSessionAsync: vi.fn(),
  sendKeysAsync: vi.fn(),
  sessionExists: vi.fn(() => true),
  sessionExistsSync: vi.fn(() => true),
  sessionExistsAsync: vi.fn(async () => true),
  getAgentSessions: vi.fn(() => [{ name: 'agent-pan-871' }]),
  getAgentSessionsSync: vi.fn(() => [{ name: 'agent-pan-871' }]),
  getAgentSessionsAsync: vi.fn(async () => [{ name: 'agent-pan-871' }]),
  // listRunningAgentsSync now matches liveness against ALL overdeck-socket
  // sessions via listSessionsSync (360edc268), not just agent-* sessions.
  listSessions: vi.fn(() => [{ name: 'agent-pan-871' }]),
  listSessionsSync: vi.fn(() => [{ name: 'agent-pan-871', created: new Date(0), attached: false, windows: 1 }]),
  capturePane: vi.fn(() => ''),
  capturePaneAsync: vi.fn(async () => ''),
  listPaneValues: vi.fn(() => []),
  listPaneValuesAsync: vi.fn(async () => []),
  waitForClaudePrompt: vi.fn(async () => true),
}));

vi.mock('../hooks.js', () => ({
  initHook: vi.fn(),
  checkHook: vi.fn(),
  checkHookSync: vi.fn(),
  generateFixedPointPrompt: vi.fn(() => ''),
}));

vi.mock('../cv.js', () => ({
  startWork: vi.fn(),
  completeWork: vi.fn(),
  getAgentCV: vi.fn(),
}));

vi.mock('../cloister/config.js', () => ({ loadCloisterConfig: vi.fn(() => ({})), loadCloisterConfigSync: vi.fn(() => ({})) }));
vi.mock('../providers.js', () => ({ getProviderForModel: vi.fn(() => ({ name: 'anthropic', compatibility: 'direct' })), getProviderEnv: vi.fn(() => ({})), setupCredentialFileAuth: vi.fn(), clearCredentialFileAuth: vi.fn() }));
vi.mock('../config-yaml.js', () => ({ loadConfig: vi.fn(() => ({ config: {} })), isClaudeCodeChannelsMcpEnabled: vi.fn(() => false), resolveModel: vi.fn(), NormalizedCavemanConfig: {} }));
vi.mock('../caveman/workspace.js', () => ({ readCavemanVariant: vi.fn() }));
vi.mock('../config.js', async (importActual) => ({
  ...(await importActual<typeof import('../config.js')>()),
  loadConfig: vi.fn(() => ({})),
}));
vi.mock('../openai-auth.js', () => ({ getOpenAIAuthStatusSync: vi.fn(() => ({ loggedIn: false })) }));
vi.mock('../cliproxy.js', () => ({ CLIPROXY_BASE_URL: 'http://127.0.0.1:8317', getCliproxyClientEnv: vi.fn(() => ({})), bridgeGeminiAuthToCliproxy: vi.fn(() => ({})) }));
vi.mock('../tracker/factory.js', () => ({ createTrackerFromConfig: vi.fn(), createTracker: vi.fn() }));
vi.mock('../projects.js', () => ({ findProjectByPath: vi.fn(), findProjectByPathSync: vi.fn(), getIssuePrefix: vi.fn(), resolveProjectFromIssueSync: vi.fn(() => null), getProjectSync: vi.fn(() => null) }));
vi.mock('../launcher-generator.js', () => ({ generateLauncherScript: vi.fn() }));
vi.mock('../persistent-logger.js', () => ({ logAgentLifecycle: vi.fn() }));
vi.mock('../database/agents-db.js', () => ({
  getAgent: vi.fn(() => undefined),
  upsertAgent: vi.fn(),
  listAllAgents: vi.fn(() => []),
  countAgentsByRole: vi.fn(() => 0),
  countAgentsByStatusRole: vi.fn(() => 0),
}));
vi.mock('../github-app.js', () => ({ isGitHubAppConfigured: vi.fn(() => false), generateInstallationToken: vi.fn(), configureWorkspaceForBot: vi.fn() }));
vi.mock('../workspace-manager.js', () => ({ preTrustDirectory: vi.fn() }));
// The production code checks overdeck first; return null so getAgentStateSync
// falls through to the fs-mocked state.json path.
vi.mock('../overdeck/agent-state-sync.js', () => ({
  getOverdeckAgentStateSync: vi.fn(() => null),
  listOverdeckAgentStatesSync: vi.fn(() => []),
  saveOverdeckAgentStateSync: vi.fn(),
}));
vi.mock('../paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paths.js')>()),
  AGENTS_DIR: '/tmp/test/agents',
  COSTS_DIR: '/tmp/test-costs',
  getOverdeckHome: () => '/tmp/test',
}));

import { getAgentStateSync, listRunningAgentsSync, resolveAgentTargetSync } from '../agents.js';
import { listAllAgents } from '../database/agents-db.js';
import { listOverdeckAgentStatesSync } from '../overdeck/agent-state-sync.js';

describe('agent ID normalization (PAN-871)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes bare issue IDs when reading state', () => {
    const state = getAgentStateSync('PAN-871');

    expect(state?.id).toBe('agent-pan-871');
    expect(state?.issueId).toBe('PAN-871');
  });

  it('marks tmux active using the canonical agent-pan session id', () => {
    // listRunningAgentsSync now reads from overdeck (not agents-db)
    vi.mocked(listOverdeckAgentStatesSync).mockReturnValue([
      {
        id: 'agent-pan-871',
        issueId: 'PAN-871',
        role: 'work',
        status: 'running',
        workspace: '/tmp/workspace',
        harness: 'claude-code',
        model: 'claude-sonnet-4-6',
        startedAt: '2026-04-27T00:00:00.000Z',
      } as import('../agents.js').AgentState,
    ]);

    const agents = listRunningAgentsSync();

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('agent-pan-871');
    expect(agents[0].tmuxActive).toBe(true);
  });

  it('resolves issue IDs to the single registered strike agent when no work agent exists', async () => {
    // resolveAgentTargetSync uses listOverdeckAgentStatesSync (not agents-db)
    vi.mocked(listOverdeckAgentStatesSync).mockReturnValue([
      {
        id: 'strike-pan-1820',
        issueId: 'PAN-1820',
        role: 'strike',
        status: 'running',
        workspace: '/tmp/workspace',
        harness: 'codex',
        model: 'gpt-5',
        startedAt: '2026-06-13T00:00:00.000Z',
      } as import('../agents.js').AgentState,
    ]);

    expect(resolveAgentTargetSync('PAN-1820')).toBe('strike-pan-1820');
  });

  it('treats corrupted state.json as missing', async () => {
    const { existsSync, readFileSync } = await import('fs');
    vi.mocked(existsSync).mockImplementation((path: string) => String(path).includes('agent-pan-bad/state.json'));
    vi.mocked(readFileSync).mockImplementation(() => '{bad json');

    expect(getAgentStateSync('PAN-BAD')).toBeNull();
  });
});
