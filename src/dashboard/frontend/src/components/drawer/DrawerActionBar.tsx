import { IssueActionMenu } from '../IssueActionMenu';
import { useDrawerData } from './useDrawerData';

export default function DrawerActionBar() {
  const { issue } = useDrawerData();
  const issueId = issue?.identifier;

  return (
    <footer data-component="drawer-action-bar" data-testid="drawer-action-bar" className="flex items-center gap-[10px] border-t border-border bg-card/70 px-[22px] py-[12px]">
      {issueId ? (
        // PAN-2908 C-ACTIONS: merge is a first-class registry entry — it renders
        // in the primary strip at READY_TO_MERGE. The bespoke pinned MergeButton
        // (which shadowed the registry entry via the shared 'merge' key) is gone.
        <IssueActionMenu
          issueId={issueId}
          mode="primary-strip"
          pinRight={['viewPr']}
          className="flex min-w-0 flex-1 items-center gap-1"
        />
      ) : <div className="flex-1" />}
    </footer>
  );
}
