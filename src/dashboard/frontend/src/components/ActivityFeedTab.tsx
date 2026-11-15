/**
 * ActivityFeedTab — the Awareness feed as the first tab of /activity
 * (PAN-5293 F-D21). The rail the Command Deck used to show: the Needs you /
 * Project / Global scopes (Needs you carries the DecisionsPanel cards) and
 * the All / Chats / Activity tabs. Project scope uses the selected project's
 * issues and conversations; with no project, or No project, both are
 * undefined, as the deck passed for No project.
 */

import { SessionFeedSidebar } from './sessionFeed/SessionFeedSidebar';
import { NO_PROJECT_KEY } from './CommandDeck/projectsData';
import { useProjectScope } from './frame/deck/useProjectScope';

export function ActivityFeedTab({ selectedProjectKey }: { selectedProjectKey: string | null }) {
  const scoped = selectedProjectKey !== null && selectedProjectKey !== NO_PROJECT_KEY;
  const { projectIssueIds, projectConvIdSet } = useProjectScope(scoped ? selectedProjectKey : null);
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col" data-testid="activity-feed-tab">
      <SessionFeedSidebar
        embedded
        heading="Feed"
        scopeSwitcher
        projectIssueIds={scoped ? projectIssueIds : undefined}
        projectConversationIds={scoped ? projectConvIdSet : undefined}
      />
    </div>
  );
}
