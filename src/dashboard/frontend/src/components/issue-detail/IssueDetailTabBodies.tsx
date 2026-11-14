import { ViewToggle } from '../shared/ViewToggle';
import { ActivityTab } from '../CommandDeck/ZoneCOverviewTabs/ActivityTab';
import { DiscussionsTab } from '../CommandDeck/ZoneCOverviewTabs/DiscussionsTab';
import HappenedFeed from '../Stage/cockpit/HappenedFeed';
import { ChangedFilesView } from '../Stage/cockpit/ChangedFilesView';
import { DeftScopeView } from '../deft/DeftScopeView';
import { DeftScopeDag } from '../deft/DeftScopeDag';
import { TasksPanel } from '../TasksPanel';
import { PrdBody } from '../PrdViewer';
import { DrawerPlanPanel, DrawerActivityPanel } from '../drawer/DrawerSecondaryPanels';
import DrawerArtifactsPanel from '../drawer/DrawerArtifactsPanel';
import { IssueChecksPanel } from '../issue-view/IssueChecksPanel';
import { ISSUE_TAB_VIEWS, type IssueTabValue } from './issueTabs';

function ViewSwitch({ entry, value, label, onSelect }: { entry: 'plan' | 'changes' | 'activity'; value: IssueTabValue; label: string; onSelect: (value: IssueTabValue) => void }) {
  return (
    <div className="mb-[14px]">
      <ViewToggle ariaLabel={label} value={value} onChange={onSelect} options={(ISSUE_TAB_VIEWS[entry] ?? []).map((view) => ({ id: view.value, label: view.label }))} />
    </div>
  );
}

interface ViewBodyProps { issueId: string; value: IssueTabValue; onSelect: (value: IssueTabValue) => void }

export function IssueTasksBody({ issueId }: { issueId: string }) {
  return (
    <>
      <DeftScopeView issueId={issueId} />
      <div data-testid="drawer-tab-panel-tasks" data-section="DrawerTasksList"><TasksPanel issueId={issueId} /></div>
    </>
  );
}

export function IssuePlanBody({ issueId, value, onSelect }: ViewBodyProps) {
  return (
    <div data-testid="issue-tab-plan">
      <ViewSwitch entry="plan" value={value} label="Plan views" onSelect={onSelect} />
      {value === 'prd' ? (
        <div data-testid="issue-plan-prd"><PrdBody issueId={issueId} /></div>
      ) : (
        <div data-testid="issue-plan-map">
          <DeftScopeDag issueId={issueId} />
          <div data-section="DrawerPlanPanel / XBriefViewer"><DrawerPlanPanel issueId={issueId} /></div>
        </div>
      )}
    </div>
  );
}

export function IssueChangesBody({ issueId, value, onSelect }: ViewBodyProps) {
  return (
    <div data-testid="issue-tab-changes">
      <ViewSwitch entry="changes" value={value} label="Change views" onSelect={onSelect} />
      {value === 'checks' ? <IssueChecksPanel issueId={issueId} />
        : value === 'artifacts' ? <div data-testid="issue-changes-artifacts" data-section="DrawerArtifactsPanel"><DrawerArtifactsPanel issueId={issueId} /></div>
        : <div data-testid="drawer-tab-panel-files" data-section="ChangedFilesView"><ChangedFilesView issueId={issueId} /></div>}
    </div>
  );
}

export function IssueActivityBody({ issueId, value, onSelect }: ViewBodyProps) {
  return (
    <div data-testid="issue-tab-activity">
      <ViewSwitch entry="activity" value={value} label="Activity views" onSelect={onSelect} />
      {value === 'history' ? (
        <div data-testid="issue-activity-history"><ActivityTab issueId={issueId} /></div>
      ) : (
        <div data-testid="issue-activity-feed" className="space-y-[18px]">
          <HappenedFeed issueId={issueId} />
          <div data-section="DrawerActivityRail / DrawerActivityPanel"><DrawerActivityPanel issueId={issueId} /></div>
        </div>
      )}
    </div>
  );
}

export function IssueDiscussionBody({ issueId }: { issueId: string }) {
  return <div data-testid="issue-tab-discussion"><DiscussionsTab issueId={issueId} /></div>;
}
