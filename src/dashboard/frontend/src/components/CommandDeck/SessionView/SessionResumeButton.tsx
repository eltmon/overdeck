import { Loader2, Play } from 'lucide-react';
import { IssueActionDialogHost } from '../../IssueActionMenu/IssueActionMenu';
import { useIssueActions } from '../../IssueActionMenu/useIssueActions';

/**
 * Resume affordance in the session-panel header. A stopped work-agent session
 * otherwise dead-ends — locked composer, no way back in without knowing
 * `pan resume` (2026-07-14, MIN-865 codex agent). Reuses the canonical
 * resumeSession issue action (same dialog + endpoint as the Actions menu) and
 * renders nothing while that action is unavailable, so it only appears when a
 * stopped agent actually has a resumable session.
 */
export function SessionResumeButton({ issueId }: { issueId: string }) {
  const actions = useIssueActions(issueId);
  const resumeView = actions.all.find((view) => view.action.key === 'resumeSession');
  if (!resumeView?.enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={resumeView.invoke}
        disabled={resumeView.isPending}
        data-testid="session-resume-button"
        className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-info/40 bg-info/10 px-2 py-1 text-[12px] font-semibold text-info-foreground transition-colors hover:bg-info/20 disabled:opacity-60"
      >
        {resumeView.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        Resume session
      </button>
      <IssueActionDialogHost issueId={issueId} actions={actions} />
    </>
  );
}
