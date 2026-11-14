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
vi.mock('../backlog/PickupGateControls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backlog/PickupGateControls')>()),
  PickupGateControls: () => <div />,
}));
vi.mock('../issue-view/IssuePipelineStrip', () => ({ IssuePipelineStrip: () => <div /> }));
vi.mock('../issue-view/IssueChecksChip', () => ({ IssueChecksChip: () => null }));
vi.mock('./IssueDrawerDetails', () => ({ IssueDrawerDetails: () => <div data-testid="drawer-tab-panel-overview" /> }));
vi.mock('../skills/SkillOverridesSections', () => ({
  IssueSkillsSection: () => <div data-testid="mock-issue-skills-section" />,
  IssueSkillsTabPanel: (props: { onUnavailable: () => void }) => (
    <div data-testid="drawer-tab-panel-skills"><button onClick={props.onUnavailable}>report unavailable</button></div>
  ),
}));
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

// PAN-5244: tabs added after the PAN-2908 audit, with their destinations.
const NEW_ISSUE_DETAIL_TABS = ['skills'] as const;

const NEW_DESTINATION_TEST_IDS: Record<(typeof NEW_ISSUE_DETAIL_TABS)[number], string> = {
  skills: 'drawer-tab-panel-skills',
};

const SELECTED_ENTRY: Record<(typeof OLD_ISSUE_DETAIL_TABS)[number], string> = {
  overview: 'overview',
  plan: 'plan',
  tasks: 'tasks',
  conversation: 'session',
  terminal: 'session',
  activity: 'activity',
  files: 'changes',
  artifacts: 'changes',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ exists: false })));
});

function renderLegacyTab(tab: string) {
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
    expect(screen.getByTestId(`drawer-tab-${SELECTED_ENTRY[legacyTab]}`)).toHaveAttribute('aria-selected', 'true');
  });

  it.each(NEW_ISSUE_DETAIL_TABS)('renders a destination for the new %s tab', (newTab) => {
    renderLegacyTab(newTab);

    expect(screen.getByTestId(NEW_DESTINATION_TEST_IDS[newTab])).toBeInTheDocument();
    expect(screen.getByTestId(`drawer-tab-${newTab}`)).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps every non-session section as a literal tab entry', () => {
    expect(ISSUE_DETAIL_TABS.map((entry) => entry.id)).toEqual([
      'session',
      'tasks',
      'plan',
      'changes',
      'activity',
      'decisions',
      'discussion',
      'skills',
      'overview',
    ]);
  });
});
