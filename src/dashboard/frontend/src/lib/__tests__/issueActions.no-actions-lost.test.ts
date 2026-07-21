import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { DialogProvider } from '../../components/DialogProvider';
import { ZoneBActionStrip } from '../../components/CommandDeck/ZoneBActionStrip';
import { ISSUE_VIEW_INVENTORY } from '../../components/issue-view/inventory';
import {
  ISSUE_ACTIONS,
  PROJECT_TREE_CONTEXT_ACTIONS,
  ZONE_B_SESSION_ACTIONS,
  type IssueActionKey,
  type NonIssueActionKey,
} from '../issueActions';

const registryKeys = new Set(ISSUE_ACTIONS.map((action) => action.key));
const registryByKey = new Map(ISSUE_ACTIONS.map((action) => [action.key, action]));
const repositoryRoot = resolve(import.meta.dirname, '../../../../../..');

const legacyCommandDeckIssueActions = [
  { legacyKey: 'merge', registryKey: null, surfaceText: 'Merge', note: 'Human-only MergeButton remains outside ISSUE_ACTIONS per Decision D6.' },
  { legacyKey: 'reviewTest', registryKey: 'requestReview', surfaceText: 'Review & Test' },
  { legacyKey: 'recover', registryKey: 'recoverReview', surfaceText: 'Recover' },
  { legacyKey: 'stopAgent', registryKey: 'stopAgent', surfaceText: 'Stop Agent' },
  { legacyKey: 'startAgent', registryKey: 'startAgent', surfaceText: 'Start Agent' },
  { legacyKey: 'resumeSession', registryKey: 'resumeSession', surfaceText: 'Resume Session' },
  { legacyKey: 'resetSession', registryKey: 'resetSession', surfaceText: 'Reset Session' },
  { legacyKey: 'createWorkspace', registryKey: 'createWorkspace', surfaceText: 'Create Workspace' },
  { legacyKey: 'copySettings', registryKey: 'copySettings', surfaceText: 'Copy Settings' },
  { legacyKey: 'closeOut', registryKey: 'closeOut', surfaceText: 'Close Out' },
  { legacyKey: 'tasks', registryKey: 'tasks', surfaceText: 'Tasks' },
  { legacyKey: 'inference', registryKey: 'inference', surfaceText: 'Inference' },
  { legacyKey: 'discussions', registryKey: 'discussions', surfaceText: 'Discussions' },
  { legacyKey: 'transcripts', registryKey: 'transcripts', surfaceText: 'Transcripts' },
  { legacyKey: 'upload', registryKey: 'upload', surfaceText: 'Upload' },
  { legacyKey: 'syncDiscussions', registryKey: 'syncDiscussions', surfaceText: 'Sync' },
  { legacyKey: 'syncMain', registryKey: 'syncMain', surfaceText: 'Sync main' },
  { legacyKey: 'statusReview', registryKey: 'statusReview', surfaceText: 'Status' },
  { legacyKey: 'reopen', registryKey: 'reopen', surfaceText: 'Reopen' },
  { legacyKey: 'restartAgent', registryKey: 'restartAgent', surfaceText: 'Restart agent' },
  { legacyKey: 'restartFromPlan', registryKey: 'restartFromPlan', surfaceText: 'Restart from plan' },
  { legacyKey: 'resetIssue', registryKey: 'resetIssue', surfaceText: 'Reset issue' },
  { legacyKey: 'resetToPlanned', registryKey: 'resetToPlanned', surfaceText: 'Reset to planned' },
  { legacyKey: 'cancel', registryKey: 'cancel', surfaceText: 'Cancel Issue' },
] as const satisfies readonly { legacyKey: string; registryKey: IssueActionKey | null; surfaceText: string; note?: string }[];

const commandDeckGapActions = [
  'untroubled',
  'inspectTask',
  'open',
] as const satisfies readonly IssueActionKey[];

const badgeBarActions = [
  { surfaceText: 'Tasks', registryKey: 'tasks' },
  { surfaceText: 'Status', registryKey: 'statusReview' },
  { surfaceText: 'Inference', registryKey: 'inference' },
  { surfaceText: 'Discussions', registryKey: 'discussions' },
  { surfaceText: 'Transcripts', registryKey: 'transcripts' },
  { surfaceText: 'Upload', registryKey: 'upload' },
  { surfaceText: 'Sync', registryKey: 'syncDiscussions' },
] as const satisfies readonly { surfaceText: string; registryKey: IssueActionKey }[];

const statusFlowActions = [
  { surfaceText: 'MERGE', registryKey: null, note: 'Human-only MergeButton remains outside ISSUE_ACTIONS per Decision D6.' },
  { surfaceText: 'Review & Test', registryKey: 'requestReview' },
  { surfaceText: 'Recover', registryKey: 'recoverReview' },
  { surfaceText: 'Stop Agent', registryKey: 'stopAgent' },
  { surfaceText: 'Start Agent', registryKey: 'startAgent' },
  { surfaceText: 'Resume Session', registryKey: 'resumeSession' },
  { surfaceText: 'Reset Session', registryKey: 'resetSession' },
  { surfaceText: 'Create Workspace', registryKey: 'createWorkspace' },
  { surfaceText: 'Reopen', registryKey: 'reopen' },
] as const satisfies readonly { surfaceText: string; registryKey: IssueActionKey | null; note?: string }[];

const projectTreeUtilityActions = PROJECT_TREE_CONTEXT_ACTIONS;
const zoneBSessionActions = ZONE_B_SESSION_ACTIONS;
const expectedZoneBActionKeys = [
  'stopSession',
  'viewTerminal',
  'pauseSession',
  'resumeFocusedSession',
  'restartSession',
  'replaySession',
  'openStateDir',
  'viewState',
  'viewFocusedXbrief',
  'copySessionId',
  'copyTmuxCommand',
  'viewJsonl',
  'exportSessionMetadata',
  'exportRoundHistory',
  'deepWipe',
] as const satisfies readonly NonIssueActionKey[];

function renderZoneBActionStrip({
  presence = 'active',
  onViewTerminal = () => undefined,
}: {
  presence?: string;
  onViewTerminal?: () => void;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      DialogProvider,
      null,
      createElement(ZoneBActionStrip, {
        issueId: 'PAN-1331',
        onViewTerminal,
        session: {
          sessionId: 'agent-pan-1331',
          type: 'work',
          presence,
          tmuxSession: 'agent-pan-1331',
          hasJsonl: true,
          roundMetadata: { roundCount: 1 },
        } as any,
      }),
    ),
  ));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMenuLabels(entries: typeof legacyCommandDeckIssueActions) {
  const menu = document.createElement('div');
  for (const entry of entries) {
    if (!entry.registryKey) continue;
    const action = registryByKey.get(entry.registryKey);
    if (!action) continue;
    const button = document.createElement('button');
    button.textContent = action.label;
    button.dataset.actionKey = action.key;
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  return menu;
}

describe('issueActions no-actions-lost audit', () => {
  it('keeps merge as a first-class registry entry (PAN-2908 reverses decision D6)', () => {
    expect(registryKeys).toContain('merge');
    expect([...registryKeys]).not.toContain('viewXbrief');
    expectTypeOf<Extract<IssueActionKey, 'viewXbrief'>>()
      .toEqualTypeOf<never>();
  });

  it('maps every pre-reconciliation issue-scoped Command Deck action to the registry or a documented human-only exclusion', () => {
    for (const entry of legacyCommandDeckIssueActions) {
      if (entry.registryKey === null) {
        expect(entry.note, entry.legacyKey).toContain('Human-only');
      } else {
        expect(registryKeys.has(entry.registryKey), entry.legacyKey).toBe(true);
      }
    }
  });

  it('keeps declared action relocation homes repository-relative and resolvable', () => {
    expect(ISSUE_VIEW_INVENTORY.some((entry) => !entry.actionRelocation)).toBe(true);

    for (const entry of ISSUE_VIEW_INVENTORY) {
      const relocation = entry.actionRelocation;
      if (!relocation) continue;

      const resolvedHome = resolve(repositoryRoot, relocation.home);
      expect(isAbsolute(relocation.home), entry.section).toBe(false);
      expect(resolvedHome.startsWith(`${repositoryRoot}/`), entry.section).toBe(true);
      expect(existsSync(resolvedHome), entry.section).toBe(true);
    }
  });

  it('keeps the Command Deck gap actions in the registry', () => {
    for (const key of commandDeckGapActions) {
      expect(registryKeys.has(key), key).toBe(true);
    }
  });

  it('keeps BadgeBar artifact actions in the registry', () => {
    for (const { registryKey } of badgeBarActions) {
      expect(registryKeys.has(registryKey), registryKey).toBe(true);
    }
  });

  it('keeps WorkspaceStatusOverview and StatusFlowControl actions covered', () => {
    for (const action of statusFlowActions) {
      if (action.registryKey === null) {
        expect(action.note, action.surfaceText).toContain('Human-only');
      } else {
        expect(registryKeys.has(action.registryKey), action.surfaceText).toBe(true);
      }
    }
  });

  it('keeps retained project-tree context-menu actions in the non-issue registry', () => {
    expect(projectTreeUtilityActions.map((action) => action.label)).toEqual(expect.arrayContaining([
      'Copy project name',
      'View Logs',
      'Inspect',
      'Restart',
      'Stop',
      'Start',
      'Open State Dir',
      'View JSONL',
      'Deep Wipe',
    ]));
    for (const action of projectTreeUtilityActions) {
      expect(action.scope, action.label).not.toBe('issue');
      expect(action.ownerSurface, action.label).toMatch(/ProjectNode|ContainerNode|FeatureItem/);
      expect(registryKeys.has(action.key as IssueActionKey), action.label).toBe(false);
    }
  });

  it('keeps every Zone B action in the executable non-issue registry', () => {
    expect(zoneBSessionActions.map((action) => action.key)).toEqual(expectedZoneBActionKeys);
    for (const action of zoneBSessionActions) {
      expect(action.scope, action.label).toBe('session');
      expect(action.ownerSurface, action.label).toBe('ZoneBActionStrip');
      expect(typeof action.enabledWhen, action.label).toBe('function');
      expect(typeof action.invoke, action.label).toBe('function');
      expect(registryKeys.has(action.key as IssueActionKey), action.label).toBe(false);
    }
  });

  it('renders every available Zone B action from its executable contract entry', () => {
    const { container } = renderZoneBActionStrip();

    fireEvent.click(screen.getByTestId('zone-b-overflow'));
    const renderedKeys = Array.from(container.querySelectorAll('[data-action-key]'))
      .map((element) => element.getAttribute('data-action-key'));
    const enabledKeys = expectedZoneBActionKeys.filter(
      (key) => key !== 'resumeFocusedSession' && key !== 'viewJsonl',
    );
    expect(renderedKeys).toHaveLength(enabledKeys.length);
    expect(renderedKeys).toEqual(expect.arrayContaining(enabledKeys));
    for (const key of renderedKeys) {
      const action = zoneBSessionActions.find((entry) => entry.key === key);
      expect(action, key ?? '').toBeDefined();
      expect(container.querySelector(`[data-action-key="${key}"]`), key ?? '').toHaveTextContent(action?.label ?? '');
    }
  });

  it('uses the Zone B contract stop confirmation before invoking the existing endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderZoneBActionStrip();

    fireEvent.click(screen.getByTestId('zone-b-stop-session'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Stop Session')).toBeInTheDocument();
    expect(within(dialog).getByText('Stop session agent-pan-1331?')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/agent-pan-1331',
        { method: 'DELETE' },
      );
    });
  });

  it('preserves terminal, pause, and resume invocation behavior through the Zone B contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const onViewTerminal = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const active = renderZoneBActionStrip({ onViewTerminal });

    fireEvent.click(screen.getByTestId('zone-b-view-terminal'));
    expect(onViewTerminal).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('zone-b-pause'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/agent-pan-1331/suspend',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    active.unmount();
    fetchMock.mockClear();
    renderZoneBActionStrip({ presence: 'suspended' });
    fireEvent.click(screen.getByTestId('zone-b-resume'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/agent-pan-1331/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Resumed from dashboard' }),
        }),
      );
    });
  });

  it('requires the Zone B contract confirmation before deep wipe invocation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderZoneBActionStrip();

    fireEvent.click(screen.getByTestId('zone-b-overflow'));
    fireEvent.click(screen.getByText('Deep Wipe'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Deep Wipe' })).toBeInTheDocument();
    expect(within(dialog).getByText(
      'Deep wipe will destroy all data for PAN-1331 including workspace, state, and git branches. This cannot be undone.',
    )).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has menu-renderable labels for every registry-covered legacy issue action', () => {
    const menu = renderMenuLabels(legacyCommandDeckIssueActions);

    try {
      for (const { registryKey } of legacyCommandDeckIssueActions) {
        if (!registryKey) continue;
        const action = registryByKey.get(registryKey);
        expect(action?.label.trim(), registryKey).not.toBe('');
        expect(menu.textContent, registryKey).toContain(action?.label);
      }
    } finally {
      menu.remove();
    }
  });
});
