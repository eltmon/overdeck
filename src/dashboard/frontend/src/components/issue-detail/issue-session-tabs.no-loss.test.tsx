import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../DialogProvider';
import { ISSUE_DETAIL_TABS, IssueDetail } from './IssueDetail';

vi.mock('../drawer/DrawerAgentSession', () => ({
  DrawerAgentSession: ({ view }: { view: 'conversation' | 'terminal' }) => (
    <div data-testid={`drawer-tab-panel-${view}`} />
  ),
  pickDefaultDrawerAgent: () => null,
}));
vi.mock('../drawer/DrawerActivityRail', () => ({ default: () => <div /> }));
vi.mock('../drawer/DrawerArtifactsPanel', () => ({
  default: () => <div data-testid="drawer-tab-panel-artifacts" />,
}));
vi.mock('../drawer/DrawerSecondaryPanels', () => ({
  DrawerActivityPanel: () => <div data-testid="drawer-tab-panel-activity" />,
  DrawerPlanPanel: () => <div data-testid="drawer-tab-panel-plan" />,
}));
vi.mock('../TasksPanel', () => ({
  TasksPanel: () => <div data-testid="tasks-panel" />,
}));
vi.mock('../issue-view/VerificationGates', () => ({ VerificationGates: () => <div /> }));
vi.mock('../issue-view/ActiveAgentPanel', () => ({ ActiveAgentPanel: () => <div /> }));
vi.mock('../backlog/PickupGateControls', () => ({ PickupGateControls: () => <div /> }));
vi.mock('../IssueActionMenu', () => ({ IssueActionMenu: () => <div /> }));
vi.mock('../CommandDeck/UatEnvironmentPanel', () => ({ UatEnvironmentPanel: () => <div /> }));
vi.mock('../PanOpenInPicker', () => ({ PanOpenInPicker: () => <div /> }));
vi.mock('./IssueDetailShell', () => ({ IssueDetailShell: () => <div /> }));
vi.mock('../Stage/cockpit/ChangedFilesView', () => ({
  ChangedFilesView: () => <div data-testid="changed-files-view" />,
}));

const OLD_ISSUE_DETAIL_TABS = [
  'overview',
  'plan',
  'tasks',
  'conversation',
  'terminal',
  'activity',
  'files',
  'artifacts',
] as const;

const DESTINATION_TEST_IDS: Record<(typeof OLD_ISSUE_DETAIL_TABS)[number], string> = {
  overview: 'drawer-tab-panel-overview',
  plan: 'drawer-tab-panel-plan',
  tasks: 'drawer-tab-panel-tasks',
  conversation: 'drawer-tab-panel-conversation',
  terminal: 'drawer-tab-panel-terminal',
  activity: 'drawer-tab-panel-activity',
  files: 'drawer-tab-panel-files',
  artifacts: 'drawer-tab-panel-artifacts',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ exists: false })));
});

function renderLegacyTab(tab: (typeof OLD_ISSUE_DETAIL_TABS)[number]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>
        <IssueDetail
          issueId="PAN-1"
          density="drawer"
          agents={[]}
          tab={tab}
          onSelectTab={() => {}}
        />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

describe('issue session tab no-loss audit', () => {
  it.each(OLD_ISSUE_DETAIL_TABS)('preserves a destination for the old %s section', (legacyTab) => {
    renderLegacyTab(legacyTab);

    expect(screen.getByTestId(DESTINATION_TEST_IDS[legacyTab])).toBeInTheDocument();
    if (legacyTab === 'conversation' || legacyTab === 'terminal') {
      expect(screen.getByTestId('drawer-tab-session')).toHaveAttribute('aria-selected', 'true');
    } else {
      expect(screen.getByTestId(`drawer-tab-${legacyTab}`)).toHaveAttribute('aria-selected', 'true');
    }
  });

  it('keeps every non-session section as a literal tab entry', () => {
    expect(ISSUE_DETAIL_TABS.map((entry) => entry.id)).toEqual([
      'overview',
      'plan',
      'tasks',
      'session',
      'activity',
      'files',
      'artifacts',
    ]);
  });
});
