/**
 * ActivityFeedTab — the Awareness feed as the first tab of /activity
 * (PAN-5293 F-D21). The rail the Command Deck used to show: the Needs you /
 * Project / Global scopes (Needs you carries the DecisionsPanel cards) and
 * the All / Chats / Activity tabs. Project scope uses the selected project's
 * issues and conversations; with no project, or No project, both are
 * undefined, as the deck passed for No project (and for All projects, PAN-5343). The tab header already names
 * the view (PAN-5335 WI-6), so the sidebar renders without its own heading,
 * and the Project chip hides when there is no project to scope to.
 */

import { SessionFeedSidebar } from './sessionFeed/SessionFeedSidebar';
import { isRealProjectKey } from './CommandDeck/projectsData';
import { useProjectScope } from './frame/deck/useProjectScope';

export function ActivityFeedTab({ selectedProjectKey }: { selectedProjectKey: string | null }) {
  // PAN-5343 H-D17: No project and the All projects deck are both unscoped.
  const scoped = isRealProjectKey(selectedProjectKey);
  const { projectIssueIds, projectConvIdSet } = useProjectScope(scoped ? selectedProjectKey : null);
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col" data-testid="activity-feed-tab">
      <SessionFeedSidebar
        embedded
        hideHeader
        scopeSwitcher
        projectScopeAvailable={scoped}
        projectIssueIds={scoped ? projectIssueIds : undefined}
        projectConversationIds={scoped ? projectConvIdSet : undefined}
      />
    </div>
  );
}
