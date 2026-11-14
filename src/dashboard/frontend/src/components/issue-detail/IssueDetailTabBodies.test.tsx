import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  IssueActivityBody,
  IssueChangesBody,
  IssuePlanBody,
  IssueTasksBody,
} from './IssueDetailTabBodies';

vi.mock('../drawer/DrawerSecondaryPanels', () => ({
  DrawerPlanPanel: () => <div data-testid="mock-drawer-plan-panel" />,
  DrawerActivityPanel: (props: { issueId?: string | null }) => (
    <div data-testid="mock-drawer-activity-panel">{props.issueId}</div>
  ),
}));
vi.mock('../PrdViewer', () => ({ PrdBody: () => <div data-testid="mock-prd-body" /> }));
vi.mock('../Stage/cockpit/ChangedFilesView', () => ({ ChangedFilesView: () => <div data-testid="mock-changed-files-view" /> }));
vi.mock('../issue-view/IssueChecksPanel', () => ({ IssueChecksPanel: () => <div data-testid="mock-issue-checks-panel" /> }));
vi.mock('../drawer/DrawerArtifactsPanel', () => ({ default: () => <div data-testid="mock-drawer-artifacts-panel" /> }));
vi.mock('../Stage/cockpit/HappenedFeed', () => ({ default: () => <div data-testid="mock-happened-feed" /> }));
vi.mock('../CommandDeck/ZoneCOverviewTabs/ActivityTab', () => ({ ActivityTab: () => <div data-testid="mock-activity-tab" /> }));
vi.mock('../CommandDeck/ZoneCOverviewTabs/DiscussionsTab', () => ({ DiscussionsTab: () => <div data-testid="mock-discussions-tab" /> }));
vi.mock('../TasksPanel', () => ({ TasksPanel: () => <div data-testid="mock-tasks-panel" /> }));
vi.mock('../deft/DeftScopeView', () => ({ DeftScopeView: () => null }));
vi.mock('../deft/DeftScopeDag', () => ({ DeftScopeDag: () => null }));

describe('IssueDetailTabBodies', () => {
  it('Plan shows the map by default and the PRD on prd', () => {
    const { rerender } = render(<IssuePlanBody issueId="PAN-1" value="plan" onSelect={vi.fn()} />);
    expect(screen.getByTestId('issue-plan-map')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-plan-prd')).not.toBeInTheDocument();

    rerender(<IssuePlanBody issueId="PAN-1" value="prd" onSelect={vi.fn()} />);
    expect(screen.getByTestId('issue-plan-prd')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-plan-map')).not.toBeInTheDocument();
  });

  it('choosing PRD emits prd', () => {
    const onSelect = vi.fn();
    render(<IssuePlanBody issueId="PAN-1" value="plan" onSelect={onSelect} />);

    const tablist = screen.getByRole('tablist', { name: 'Plan views' });
    const prdTab = within(tablist).getByRole('tab', { name: 'PRD' });
    prdTab.click();

    expect(onSelect).toHaveBeenCalledWith('prd');
  });

  it('Changes shows Files, Checks and Artifacts by value', () => {
    const { rerender } = render(<IssueChangesBody issueId="PAN-1" value="files" onSelect={vi.fn()} />);
    expect(screen.getByTestId('drawer-tab-panel-files')).toBeInTheDocument();

    rerender(<IssueChangesBody issueId="PAN-1" value="checks" onSelect={vi.fn()} />);
    expect(screen.getByTestId('mock-issue-checks-panel')).toBeInTheDocument();

    rerender(<IssueChangesBody issueId="PAN-1" value="artifacts" onSelect={vi.fn()} />);
    expect(screen.getByTestId('issue-changes-artifacts')).toBeInTheDocument();
  });

  it('choosing Checks emits checks', () => {
    const onSelect = vi.fn();
    render(<IssueChangesBody issueId="PAN-1" value="files" onSelect={onSelect} />);

    const tablist = screen.getByRole('tablist', { name: 'Change views' });
    within(tablist).getByRole('tab', { name: 'Checks' }).click();

    expect(onSelect).toHaveBeenCalledWith('checks');
  });

  it('Activity shows the feed above the log, and the status history on history', () => {
    const { rerender } = render(<IssueActivityBody issueId="PAN-1" value="activity" onSelect={vi.fn()} />);
    const feed = screen.getByTestId('issue-activity-feed');
    const happened = screen.getByTestId('mock-happened-feed');
    const activityPanel = screen.getByTestId('mock-drawer-activity-panel');
    expect(feed).toContainElement(happened);
    expect(feed).toContainElement(activityPanel);
    expect(happened.compareDocumentPosition(activityPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<IssueActivityBody issueId="PAN-1" value="history" onSelect={vi.fn()} />);
    expect(screen.getByTestId('issue-activity-history')).toBeInTheDocument();
    expect(screen.getByTestId('mock-activity-tab')).toBeInTheDocument();
  });

  it('the Activity log receives the issue id', () => {
    render(<IssueActivityBody issueId="PAN-42" value="activity" onSelect={vi.fn()} />);
    expect(screen.getByTestId('mock-drawer-activity-panel')).toHaveTextContent('PAN-42');
  });

  it('the bodies keep the console markers', () => {
    render(<IssueTasksBody issueId="PAN-1" />);
    expect(screen.getByTestId('drawer-tab-panel-tasks')).toHaveAttribute('data-section', 'DrawerTasksList');

    render(<IssuePlanBody issueId="PAN-1" value="plan" onSelect={vi.fn()} />);
    expect(document.querySelector('[data-section="DrawerPlanPanel / XBriefViewer"]')).toBeInTheDocument();

    render(<IssueChangesBody issueId="PAN-1" value="artifacts" onSelect={vi.fn()} />);
    expect(document.querySelector('[data-section="DrawerArtifactsPanel"]')).toBeInTheDocument();

    render(<IssueActivityBody issueId="PAN-1" value="activity" onSelect={vi.fn()} />);
    expect(document.querySelector('[data-section="DrawerActivityRail / DrawerActivityPanel"]')).toBeInTheDocument();
  });
});
