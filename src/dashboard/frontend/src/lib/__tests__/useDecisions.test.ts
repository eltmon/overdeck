import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackendRestartRecoverySnapshot, DiskAlertSnapshot, HarnessAutoUpdateSnapshot } from '@overdeck/contracts';
import { useDashboardStore } from '../store';
import { describePendingInput } from '../pendingInput';
import { DISK_ALERT_QUERY_KEY } from '../diskAlert';
import { HARNESS_AUTO_UPDATE_QUERY_KEY } from '../harnessAutoUpdate';
import { BACKEND_RESTART_RECOVERY_QUERY_KEY } from '../backendRestartRecovery';
import { type AgentRequestRow, backendRestartDecisions, diskAlertDecisions, harnessUpdateDecisions, isBlockingDecision, useDecisions } from '../useDecisions';
import type { McpSignInApproval } from '../../components/Settings/anywhere/anywhereApi';

interface RenderDecisionsOptions {
  /** PAN-4946: who the dashboard sees itself answering to; defaults to this machine's own session. */
  viewerKind?: 'root-session' | 'device' | 'token' | 'internal-token' | 'machine' | null;
  mcpApprovals?: McpSignInApproval[];
  /** PAN-4946 review: the raw `['anywhere-status']` body, overriding `viewerKind` — for a malformed/partial status. */
  anywhereStatus?: unknown;
  /** PAN-5093: the cached `/api/disk-alert` snapshot. */
  diskAlert?: DiskAlertSnapshot | null;
  /** PAN-5108: the cached `/api/harness-auto-update` snapshot. */
  harnessAutoUpdate?: HarnessAutoUpdateSnapshot | null;
  /** PAN-5091: the cached `/api/backend-restart-recovery` snapshot. */
  backendRestart?: BackendRestartRecoverySnapshot | null;
}

function renderDecisions(
  convRows: unknown[] = [],
  agentRequestRows: AgentRequestRow[] = [],
  options: RenderDecisionsOptions = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['conv-ask-user-question'], convRows);
  queryClient.setQueryData(['fleet-needs-you'], { machines: [], unreachable: [] }); // PAN-4651: no linked machines
  queryClient.setQueryData(['agent-requests'], agentRequestRows); // PAN-4941
  queryClient.setQueryData(['anywhere-status'], options.anywhereStatus ?? { viewer: { kind: options.viewerKind ?? 'root-session' } }); // PAN-4946
  queryClient.setQueryData(['mcp-oauth-approvals'], options.mcpApprovals ?? []); // PAN-4946
  queryClient.setQueryData(DISK_ALERT_QUERY_KEY, options.diskAlert ?? null); // PAN-5093
  queryClient.setQueryData(HARNESS_AUTO_UPDATE_QUERY_KEY, options.harnessAutoUpdate ?? null); // PAN-5108
  queryClient.setQueryData(BACKEND_RESTART_RECOVERY_QUERY_KEY, options.backendRestart ?? null); // PAN-5091

  return renderHook(() => useDecisions(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

function setDashboardState(
  agentsById: Record<string, Record<string, unknown>>,
  issuesRaw: Array<Record<string, unknown>>,
) {
  useDashboardStore.setState({
    agentsById,
    channelPermissionRequestsById: {},
    issuesRaw,
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

beforeEach(() => {
  setDashboardState({}, []);
});

describe('useDecisions', () => {
  it('formats an agent issue identifier with its resolved issue title', () => {
    setDashboardState(
      {
        'agent-pan-1': {
          id: 'agent-pan-1',
          issueId: 'PAN-1',
          pendingInputKinds: ['askUserQuestion'],
        },
      },
      [{ id: 'PAN-1', title: 'Fix widget' }],
    );

    const { result } = renderDecisions();

    expect(result.current[0]).toMatchObject({
      id: 'agent-pan-1',
      label: 'PAN-1 — Fix widget',
      issueId: 'PAN-1',
      issueTitle: 'Fix widget',
    });
  });

  it('falls back to the issue identifier or agent id when no title resolves', () => {
    setDashboardState(
      {
        'agent-pan-2': {
          id: 'agent-pan-2',
          issueId: 'PAN-2',
          pendingInputKinds: ['askUserQuestion'],
        },
        'agent-unbound': {
          id: 'agent-unbound',
          pendingInputKinds: ['askUserQuestion'],
        },
      },
      [],
    );

    const { result } = renderDecisions();

    expect(result.current.find((decision) => decision.id === 'agent-pan-2')).toMatchObject({
      label: 'PAN-2',
      issueId: 'PAN-2',
    });
    expect(result.current.find((decision) => decision.id === 'agent-unbound')).toMatchObject({
      label: 'agent-unbound',
    });
  });
});

describe('useDecisions held kickoff (PAN-4596)', () => {
  const heldRow = { name: 'conv-held', title: 'Bundle', heldKickoff: { since: '2026-10-04T13:19:27.000Z', focus: 'Read the brief' } };

  it('maps a held conversation row to a non-blocking heldKickoff decision', () => {
    const { result } = renderDecisions([heldRow]);

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      id: 'conv-held',
      source: 'conversation',
      label: 'Bundle',
      kinds: ['heldKickoff'],
      blocking: false,
      since: '2026-10-04T13:19:27.000Z',
      heldKickoffFocus: 'Read the brief',
    });
  });

  it('keeps the other kind of a row that is also held', () => {
    const { result } = renderDecisions([{
      ...heldRow,
      pendingPermission: {
        signature: 'sig', answerable: true, agentLabel: 'Main agent', agentKey: null, toolName: 'Bash',
        header: null, clipped: false, detailLines: [], since: '2026-10-05T00:00:00.000Z',
      },
    }]);

    expect(result.current[0]?.kinds).toEqual(['permissionRequest', 'heldKickoff']);
    expect(result.current[0]?.blocking).toBe(true);
  });
});

describe('useDecisions secret requests (PAN-4941)', () => {
  const secretRow: AgentRequestRow = {
    id: '0123456789abcdef0123456789abcdef',
    kind: 'secret',
    agentId: 'agent-pan-1',
    agentKind: 'agent',
    label: 'agent-pan-1 · PAN-1',
    name: 'OPENAI_API_KEY',
    prompt: 'The key for the eval run',
    createdAt: '2026-11-04T00:00:00.000Z',
    expiresAt: '2026-11-04T00:10:00.000Z',
  };

  it('maps a secret row to a blocking secretRequest decision keyed by the request id', () => {
    const { result } = renderDecisions([], [secretRow]);
    expect(result.current).toEqual([{
      id: secretRow.id,
      source: 'agent',
      label: 'agent-pan-1 · PAN-1',
      kinds: ['secretRequest'],
      since: '2026-11-04T00:00:00.000Z',
      blocking: true,
      agentRequest: {
        id: secretRow.id,
        kind: 'secret',
        name: 'OPENAI_API_KEY',
        prompt: 'The key for the eval run',
        agentId: 'agent-pan-1',
        expiresAt: '2026-11-04T00:10:00.000Z',
      },
    }]);
  });

  it('gives a conversation requester the conversation source', () => {
    const { result } = renderDecisions([], [{ ...secretRow, agentId: 'abc', agentKind: 'conversation', label: 'abc' }]);
    expect(result.current[0]).toMatchObject({ source: 'conversation', label: 'abc', agentRequest: { agentId: 'abc' } });
  });

  it('labels the kind "Secret requested"', () => {
    expect(describePendingInput(['secretRequest'])).toBe('Secret requested');
  });

  it('PAN-4942: maps a machine-link row to a blocking machineLink decision with the hint', () => {
    const { result } = renderDecisions([], [{
      ...secretRow,
      kind: 'machine-link',
      name: undefined,
      prompt: undefined,
      hint: 'my desk Mac',
      expiresAt: '2026-11-05T00:00:00.000Z',
    }]);
    expect(result.current).toEqual([{
      id: secretRow.id,
      source: 'agent',
      label: 'agent-pan-1 · PAN-1',
      kinds: ['machineLink'],
      since: '2026-11-04T00:00:00.000Z',
      blocking: true,
      agentRequest: { id: secretRow.id, kind: 'machine-link', hint: 'my desk Mac', agentId: 'agent-pan-1', expiresAt: '2026-11-05T00:00:00.000Z' },
    }]);
    expect(describePendingInput(['machineLink'])).toBe('Machine link requested');
  });
});

describe('useDecisions MCP sign-ins (PAN-4946)', () => {
  const approvalRow: McpSignInApproval = {
    id: 'appr-1',
    clientId: 'odc_123',
    clientName: 'Claude Desktop',
    redirectHost: 'localhost',
    requestedLevel: 'operate',
    approvalCode: 'ABCDE',
    createdAt: '2026-11-04T00:00:00.000Z',
    expiresAt: '2026-11-04T00:10:00.000Z',
  };

  it('maps a pending approval to a blocking mcpSignIn decision for a root-session viewer, sorted before non-blocking decisions', () => {
    setDashboardState(
      { 'agent-x': { id: 'agent-x', pendingInputKinds: ['exitPlanMode'] } },
      [],
    );

    const { result } = renderDecisions([], [], { viewerKind: 'root-session', mcpApprovals: [approvalRow] });

    expect(result.current).toHaveLength(2);
    expect(result.current[0]).toMatchObject({
      id: 'appr-1',
      source: 'agent',
      label: 'Claude Desktop',
      kinds: ['mcpSignIn'],
      blocking: true,
      mcpSignIn: approvalRow,
    });
    expect(result.current[0]?.mcpSignIn?.approvalCode).toBe('ABCDE');
  });

  it('emits no mcpSignIn decision and makes no request to the approvals route for a device viewer', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // No ['mcp-oauth-approvals'] cache entry: a real session never populates it
    // for a device viewer, since the approvals query is `enabled: false`.
    const { result } = renderDecisions([], [], { viewerKind: 'device' });

    expect(result.current.some((d) => d.kinds.includes('mcpSignIn'))).toBe(false);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/api/mcp-oauth/approvals'))).toBe(false);
    fetchSpy.mockRestore();
  });

  it('review fix: drops a cached approval once the viewer is no longer root — enabled:false only stops refetching, not the cached read', () => {
    // Simulates a query client that populated the approvals cache while the
    // viewer was root-session, then the viewer dropped to device within the
    // same lifetime: the cache entry is still there, but it must not surface.
    const { result } = renderDecisions([], [], { viewerKind: 'device', mcpApprovals: [approvalRow] });
    expect(result.current.some((d) => d.kinds.includes('mcpSignIn'))).toBe(false);
  });

  it('review fix: a status body with no viewer field never throws and never surfaces an mcpSignIn row', () => {
    expect(() => renderDecisions([], [], { anywhereStatus: {} })).not.toThrow();
    const { result } = renderDecisions([], [], { anywhereStatus: {}, mcpApprovals: [approvalRow] });
    expect(result.current.some((d) => d.kinds.includes('mcpSignIn'))).toBe(false);
  });

  it('labels the kind "MCP sign-in waiting" and treats it as blocking', () => {
    expect(describePendingInput(['mcpSignIn'])).toBe('MCP sign-in waiting');
    expect(isBlockingDecision(['mcpSignIn'])).toBe(true);
  });
});

describe('isBlockingDecision', () => {
  it('treats a secret request as blocking — the agent is parked in secret_wait', () => {
    expect(isBlockingDecision(['secretRequest'])).toBe(true);
  });

  it('treats a machine-link request as blocking — the agent is parked in link_machine_wait', () => {
    expect(isBlockingDecision(['machineLink'])).toBe(true);
  });

  it('treats a waiting question as blocking — the agent has stopped', () => {
    expect(isBlockingDecision(['askUserQuestion'])).toBe(true);
  });

  it('treats a rate-limit modal as blocking', () => {
    expect(isBlockingDecision(['rateLimit'])).toBe(true);
  });

  /**
   * The case that started this: an interactive agent that ended its turn is
   * stopped dead until the operator replies, even though nothing "failed".
   */
  it('treats a yielded turn as blocking', () => {
    expect(isBlockingDecision(['agentTurnEnded'])).toBe(true);
  });

  it('does not treat a plan review as blocking — work continues around it', () => {
    expect(isBlockingDecision(['exitPlanMode'])).toBe(false);
  });

  /**
   * PAN-3051 — reversed. Under the PTY supervisor the agent is parked on the
   * permission modal in its own pane and cannot run another tool until someone
   * answers it, so it belongs at the top of the list with the other hard stops.
   */
  it('treats a permission request as blocking — the supervisor pane is parked on the modal', () => {
    expect(isBlockingDecision(['permissionRequest'])).toBe(true);
  });

  /**
   * PAN-3233 review fix — a paneQuestion is a terminal prompt with no
   * structured payload; without this the agent sorted into the non-blocking
   * "Waiting" group despite being frozen exactly like an askUserQuestion.
   */
  it('treats a paneQuestion as blocking — the agent is frozen on a terminal prompt', () => {
    expect(isBlockingDecision(['paneQuestion'])).toBe(true);
  });

  it('is blocking when any kind blocks', () => {
    expect(isBlockingDecision(['exitPlanMode', 'askUserQuestion'])).toBe(true);
  });

  it('is not blocking with no kinds', () => {
    expect(isBlockingDecision([])).toBe(false);
  });
});

function diskSnapshot(overrides: Partial<DiskAlertSnapshot> = {}): DiskAlertSnapshot {
  return {
    level: 'warning',
    path: '/home/op/.overdeck',
    availableBytes: 4.1 * 1024 ** 3,
    totalBytes: 100 * 1024 ** 3,
    warningBytes: 5 * 1024 ** 3,
    criticalBytes: 2 * 1024 ** 3,
    since: '2026-11-06T17:00:00.000Z',
    checkedAt: '2026-11-06T17:00:30.000Z',
    measuring: false,
    holders: null,
    ...overrides,
  };
}

describe('diskAlertDecisions (PAN-5093)', () => {
  it('returns no decision for null or level ok', () => {
    expect(diskAlertDecisions(null)).toEqual([]);
    expect(diskAlertDecisions(diskSnapshot({ level: 'ok' }))).toEqual([]);
  });

  it('returns one non-blocking diskLow decision at warning', () => {
    const [decision] = diskAlertDecisions(diskSnapshot({ level: 'warning' }));
    expect(decision).toMatchObject({ id: 'disk-alert', kinds: ['diskLow'], blocking: false });
  });

  it('returns one blocking diskCritical decision at critical', () => {
    const [decision] = diskAlertDecisions(diskSnapshot({ level: 'critical' }));
    expect(decision).toMatchObject({ id: 'disk-alert', kinds: ['diskCritical'], blocking: true });
  });
});

function harnessSnapshot(failures: HarnessAutoUpdateSnapshot['failures']): HarnessAutoUpdateSnapshot {
  return { enabled: true, running: false, lastRunAt: '2026-11-10T12:02:00.000Z', nextRunAt: '2026-11-11T12:02:00.000Z', failures };
}

const CLAUDE_FAILURE = {
  binary: 'claude',
  label: 'Claude Code',
  error: 'npm ERR! code E404',
  command: 'npm install -g --prefix /p @anthropic-ai/claude-code@latest',
  failedAt: '2026-11-10T12:01:00.000Z',
};
const CODEX_FAILURE = { ...CLAUDE_FAILURE, binary: 'codex', label: 'Codex CLI', command: 'npm install -g --prefix /p @openai/codex@latest' };

describe('harnessUpdateDecisions (PAN-5108)', () => {
  it('returns no decision for a null snapshot or one without failures', () => {
    expect(harnessUpdateDecisions(null)).toEqual([]);
    expect(harnessUpdateDecisions(harnessSnapshot([]))).toEqual([]);
  });

  it('returns no decision, without throwing, for a response in another shape (e2e catch-all, older peer)', () => {
    expect(harnessUpdateDecisions({} as unknown as HarnessAutoUpdateSnapshot)).toEqual([]);
    expect(harnessUpdateDecisions({ failures: null } as unknown as HarnessAutoUpdateSnapshot)).toEqual([]);
  });

  it('returns one non-blocking decision per failing binary', () => {
    const decisions = harnessUpdateDecisions(harnessSnapshot([CLAUDE_FAILURE, CODEX_FAILURE]));
    expect(decisions.map((d) => d.id)).toEqual(['harness-update:claude', 'harness-update:codex']);
    expect(decisions[0]).toMatchObject({
      label: 'Claude Code update failed',
      kinds: ['harnessUpdateFailed'],
      blocking: false,
      since: CLAUDE_FAILURE.failedAt,
      harnessUpdate: CLAUDE_FAILURE,
    });
    expect(decisions[1]!.blocking).toBe(false);
  });

  it('surfaces the failures from the cached snapshot through useDecisions', () => {
    const { result } = renderDecisions([], [], { harnessAutoUpdate: harnessSnapshot([CLAUDE_FAILURE]) });
    expect(result.current.some((d) => d.kinds.includes('harnessUpdateFailed'))).toBe(true);
  });
});

describe('useDecisions disk alert integration (PAN-5093)', () => {
  it('surfaces the disk alert decision from the cached snapshot', () => {
    const { result } = renderDecisions([], [], { diskAlert: diskSnapshot({ level: 'warning' }) });
    expect(result.current.some((d) => d.kinds.includes('diskLow'))).toBe(true);
  });

  it('keeps the diskLow decision after a rejected refetch (WI-6 critique response)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queryClient.setQueryData(['conv-ask-user-question'], []);
    queryClient.setQueryData(['fleet-needs-you'], { machines: [], unreachable: [] });
    queryClient.setQueryData(['agent-requests'], []);
    queryClient.setQueryData(['anywhere-status'], { viewer: { kind: 'root-session' } });
    queryClient.setQueryData(['mcp-oauth-approvals'], []);
    queryClient.setQueryData(DISK_ALERT_QUERY_KEY, diskSnapshot({ level: 'warning' }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useDecisions(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    });

    await queryClient.refetchQueries({ queryKey: DISK_ALERT_QUERY_KEY }).catch(() => {});
    expect(result.current.some((d) => d.kinds.includes('diskLow'))).toBe(true);
    fetchSpy.mockRestore();
  });
});

describe('backendRestartDecisions (PAN-5091)', () => {
  const offer = (overrides: Partial<BackendRestartRecoverySnapshot> = {}): BackendRestartRecoverySnapshot => ({
    lostAt: '2026-11-06T09:13:00.000Z',
    conversations: [{ name: 'a', title: 'Fernkite deploy' }, { name: 'b', title: null }],
    run: null,
    ...overrides,
  });

  it('returns no decision for a null snapshot, an empty offer, or another shape', () => {
    expect(backendRestartDecisions(null)).toEqual([]);
    expect(backendRestartDecisions(offer({ lostAt: null, conversations: [] }))).toEqual([]);
    expect(backendRestartDecisions({} as unknown as BackendRestartRecoverySnapshot)).toEqual([]);
  });

  it('returns one non-blocking decision that counts the stopped conversations', () => {
    const [decision, ...rest] = backendRestartDecisions(offer());
    expect(rest).toEqual([]);
    expect(decision).toMatchObject({
      id: 'backend-restart',
      label: '2 conversations stopped when the terminal backend restarted',
      kinds: ['backendRestart'],
      blocking: false,
      since: '2026-11-06T09:13:00.000Z',
    });
    expect(backendRestartDecisions(offer({ conversations: [{ name: 'a', title: null }] }))[0]!.label)
      .toBe('1 conversation stopped when the terminal backend restarted');
    expect(describePendingInput(['backendRestart'])).toBe('Stopped by a terminal-backend restart');
  });

  it('stays while Resume all runs, even after the last conversation left the offer', () => {
    const run = { state: 'running' as const, startedAt: '2026-11-06T09:20:00.000Z', finishedAt: null, current: 'b', waitingForMemory: false, results: [] };
    const [decision] = backendRestartDecisions(offer({ lostAt: null, conversations: [], run }));
    expect(decision).toMatchObject({ label: 'Resuming conversations after a terminal-backend restart', since: run.startedAt });
  });

  it('reaches useDecisions from the cached snapshot', () => {
    const { result } = renderDecisions([], [], { backendRestart: offer() });
    expect(result.current.filter((d) => d.backendRestart).map((d) => d.id)).toEqual(['backend-restart']);
  });
});
