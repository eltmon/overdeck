import { IssueActionMenu } from '../IssueActionMenu';
import { MergeButton } from '../MergeButton';
import { useDrawerData } from './useDrawerData';

export default function DrawerActionBar() {
  const { issue, reviewStatus } = useDrawerData();
  const issueId = issue?.identifier;

  return (
    <footer data-component="drawer-action-bar" data-testid="drawer-action-bar" className="flex items-center gap-[10px] border-t border-border bg-card/70 px-[22px] py-[12px]">
      {issueId ? (
        <IssueActionMenu
          issueId={issueId}
          mode="hybrid"
          pinRight={['viewPr']}
          className="flex min-w-0 flex-1 items-center gap-1"
        />
      ) : <div className="flex-1" />}
      {issueId ? (
        <MergeButton
          issueId={issueId}
          reviewStatus={reviewStatus}
          variant="inspector"
          issueState={issue?.state ?? issue?.status}
        />
      ) : null}
    </footer>
  );
}
