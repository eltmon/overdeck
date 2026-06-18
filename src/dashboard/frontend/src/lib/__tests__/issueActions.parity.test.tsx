import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../../components/DialogProvider';
import { IssueActionMenu } from '../../components/IssueActionMenu';
import { ISSUE_ACTIONS, type IssueActionEntry } from '../issueActions';
import { useDashboardStore } from '../store';
import type { Agent, Issue } from '../../types';

export const ISSUE_SCOPED_PAN_VERBS = [
  'plan',
  'plan --auto',
  'plan finalize',
  'start',
  'start --auto',
  'tell',
  'done',
  'review request',
  'review restart',
  'review reset',
  'kill',
  'pause',
  'unpause',
  'untroubled',
  'recover',
  'resume',
  'sync-main',
  'inspect --bead',
  'reopen',
  'close',
  'wipe',
  'destroy',
  'open',
] as const;

vi.mock('../../components/PanOpenInPicker', () => ({
  PanOpenInPicker: ({ openInCwd }: { openInCwd: string | null }) => <div data-testid="pan-open-picker">Open {openInCwd ?? ''}</div>,
}));

const commandFilesDir = resolve(process.cwd(), '../../../src/cli/commands');
const commandFiles = new Set(readdirSync(commandFilesDir).filter((entry) => entry.endsWith('.ts')));

function commandFileForPanVerb(panVerb: string) {
  switch (panVerb) {
    case 'plan finalize':
      return 'plan-finalize.ts';
    case 'review request':
      return 'request-review.ts';
    case 'review restart':
      return 'review-restart.ts';
    case 'review reset':
      return 'reset-review.ts';
    case 'destroy':
      return 'workspace.ts';
    default:
      return `${panVerb.split(' ')[0]}.ts`;
  }
}

function issue(): Issue {
  return {
    id: 'issue-pan-1331',
    identifier: 'PAN-1331',
    title: 'Restore action surface',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: 'https://example.test/PAN-1331',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    project: { id: 'pan', name: 'Overdeck', color: '#fff' },
    hasPlan: true,
    hasBeads: true,
    workspacePath: '/tmp/feature-pan-1331',
  };
}

function agent(): Agent {
  return {
    id: 'agent-pan-1331',
    issueId: 'PAN-1331',
    runtime: 'claude-code',
    model: 'claude-opus-4-7',
    status: 'running',
    startedAt: '2026-05-23T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    role: 'work',
    paused: true,
    troubled: true,
  };
}

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>
        <IssueActionMenu issueId="PAN-1331" mode="hybrid" />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) {
      return Response.json({ csrfToken: 'test-csrf-token' });
    }
    if (url.includes('/planning-state')) {
      return Response.json({ hasPlan: true, hasBeads: true, beadsCount: 7, planningComplete: true });
    }
    if (url.includes('/api/workspaces/')) {
      return Response.json({
        exists: true,
        issueId: 'PAN-1331',
        path: '/tmp/feature-pan-1331',
        mrUrl: 'https://example.test/pr/1331',
        hasInference: true,
        hasTranscripts: true,
        hasDiscussions: true,
      });
    }
    if (url.includes('/has-session')) {
      return Response.json({ lifecycle: { canResumeSession: true } });
    }
    return Response.json({ success: true });
  });
}

function registryEntriesForVerb(verb: string) {
  return ISSUE_ACTIONS.filter((action) => action.panVerb === verb);
}

describe('issue action CLI ↔ dashboard parity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    useDashboardStore.setState({
      issuesRaw: [issue()],
      agentsById: { 'agent-pan-1331': agent() },
      reviewStatusByIssueId: {
        'PAN-1331': {
          issueId: 'PAN-1331',
          reviewStatus: 'passed',
          testStatus: 'passed',
          mergeStatus: 'pending',
          readyForMerge: true,
          prUrl: 'https://example.test/pr/1331',
          updatedAt: '2026-05-23T00:00:00.000Z',
        },
      },
      drawer: { issueId: null, tab: 'overview' },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('covers every issue-scoped CLI verb with at least one registry entry', () => {
    for (const verb of ISSUE_SCOPED_PAN_VERBS) {
      expect(registryEntriesForVerb(verb).map((action) => action.key), verb).not.toEqual([]);
    }
  });

  it('does not advertise pan verbs without a backing CLI command file', () => {
    expect(existsSync(commandFilesDir)).toBe(true);

    for (const action of ISSUE_ACTIONS) {
      if (!action.panVerb) continue;
      const commandFile = commandFileForPanVerb(action.panVerb);
      expect(commandFiles.has(commandFile), `${action.key}: ${action.panVerb} → ${commandFile}`).toBe(true);
    }
  });

  it('renders every registry entry label through the shared drawer action menu surface', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));

    const menu = screen.getByTestId('issue-action-menu');
    for (const action of ISSUE_ACTIONS) {
      expect(menu, action.key).toHaveTextContent(action.label);
    }
  });

  it('keeps client-only dashboard actions explicitly out of CLI parity', () => {
    const clientOnlyActions = ISSUE_ACTIONS.filter((action): action is IssueActionEntry & { panVerb: null } => action.panVerb === null);

    expect(clientOnlyActions.map((action) => action.key)).toEqual(expect.arrayContaining([
      'viewPr',
      'resetIssue',
      'switchModel',
      'beads',
      'inference',
      'discussions',
      'transcripts',
      'upload',
      'syncDiscussions',
      'statusReview',
      'createWorkspace',
      'copySettings',
      'resetSession',
      'restartFromPlan',
      'restartAgent',
      'cancel',
    ]));
  });
});
