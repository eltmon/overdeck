import { IssueActionMenu } from '../IssueActionMenu';
import { useDrawerData } from './useDrawerData';

export default function DrawerActionBar() {
  const { issue } = useDrawerData();
  const issueId = issue?.identifier;

  return (
    // PAN-5244: the action strip sits in the drawer's one-row header.
    <div data-component="drawer-action-bar" data-testid="drawer-action-bar" className="flex shrink-0 items-center">
      {issueId ? (
        // PAN-2908 C-ACTIONS: merge is a first-class registry entry — it renders
        // in the primary strip at READY_TO_MERGE. The bespoke pinned MergeButton
        // (which shadowed the registry entry via the shared 'merge' key) is gone.
        <IssueActionMenu
          issueId={issueId}
          mode="primary-strip"
          pinRight={['viewPr']}
          className="flex items-center gap-1"
        />
      ) : null}
    </div>
  );
}
