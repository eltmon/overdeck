import { useMemo, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';

import { PlanDialog } from '../PlanDialog';
import { PanOpenInPicker } from '../PanOpenInPicker';
import { SwitchModelModal } from '../SwitchModelModal';
import { useSwitchModel } from '../../hooks/useSwitchModel';
import type { IssueActionKey } from '../../lib/issueActions';
import type { IssueActionView, UseIssueActionsResult } from './useIssueActions';
import { useIssueActions } from './useIssueActions';

export type IssueActionMenuMode = 'inline' | 'overflow-only' | 'hybrid';

export interface IssueActionMenuProps {
  issueId: string;
  mode: IssueActionMenuMode;
  pinRight?: IssueActionKey[];
  className?: string;
}

function actionButtonClass(view: IssueActionView, inline: boolean) {
  const base = inline
    ? 'inline-flex items-center rounded-md px-2.5 py-1.5 text-xs transition-colors'
    : 'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs transition-colors';
  if (!view.enabled) return `${base} cursor-not-allowed text-muted-foreground/55 opacity-60`;
  if (view.action.kind === 'destructive') return `${base} text-destructive hover:bg-destructive hover:text-destructive-foreground`;
  return `${base} text-foreground hover:bg-accent hover:text-accent-foreground`;
}

function ActionButton({ view, inline = false, onInvoked }: { view: IssueActionView; inline?: boolean; onInvoked?: () => void }) {
  return (
    <button
      type="button"
      data-testid={`issue-action-${view.action.key}`}
      className={actionButtonClass(view, inline)}
      disabled={!view.enabled || view.isPending}
      title={view.disabledReason ?? view.action.label}
      onClick={() => {
        view.invoke();
        onInvoked?.();
      }}
    >
      {view.isPending ? `${view.action.label}…` : view.action.label}
    </button>
  );
}

function OverflowMenu({ views, onClose }: { views: IssueActionView[]; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="menu"
        data-testid="issue-action-overflow-menu"
        className="absolute right-0 top-full z-50 mt-1 flex min-w-[190px] flex-col gap-1 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
      >
        {views.map((view) => (
          <ActionButton key={view.action.key} view={view} onInvoked={onClose} />
        ))}
      </div>
    </>
  );
}

function OverflowButton({ views }: { views: IssueActionView[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        data-testid="issue-action-overflow-button"
        aria-label="More issue actions"
        className="inline-flex items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? <OverflowMenu views={views} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function IssueActionDialogHost({ issueId, actions }: { issueId: string; actions: UseIssueActionsResult }) {
  const { activeDialog, agent, lifecycle, issue, workspace, closeDialog } = actions;
  const { switchMutation, isPending: isSwitchPending } = useSwitchModel(agent?.id, issueId);

  if (!activeDialog) return null;

  if ((activeDialog.key === 'plan' || activeDialog.key === 'autoPlan' || activeDialog.key === 'startSkipPlanning') && issue) {
    return (
      <PlanDialog
        issue={issue}
        isOpen
        autoStart={activeDialog.key === 'startSkipPlanning'}
        onClose={closeDialog}
        onComplete={closeDialog}
      />
    );
  }

  if (activeDialog.key === 'switchModel' && agent) {
    return (
      <SwitchModelModal
        currentModel={agent.model}
        currentHarness={agent.harness ?? null}
        agentId={agent.id}
        issueId={issueId}
        agentStatus={agent.status}
        hasResumableSession={lifecycle?.canResumeSession === true}
        onClose={closeDialog}
        onSwitch={(model, message, harness) => switchMutation.mutate({ model, message, harness })}
        isPending={isSwitchPending}
      />
    );
  }

  if (activeDialog.key === 'open' && workspace?.path) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeDialog}>
        <div
          role="dialog"
          aria-label="Open workspace"
          className="min-w-[260px] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Open workspace</h3>
            <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={closeDialog}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <PanOpenInPicker cwd={workspace.path} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeDialog}>
      <div
        role="dialog"
        aria-label={activeDialog.action.label}
        className="min-w-[260px] rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-medium">{activeDialog.action.label}</h3>
          <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={closeDialog}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">This action opens from the shared issue action surface.</p>
      </div>
    </div>
  );
}

export function IssueActionMenu({ issueId, mode, pinRight = [], className }: IssueActionMenuProps) {
  const actions = useIssueActions(issueId);
  const pinSet = useMemo(() => new Set(pinRight), [pinRight]);
  const pinned = pinRight
    .map((key) => actions.all.find((view) => view.action.key === key))
    .filter((view): view is IssueActionView => !!view);
  const primary = actions.primary.filter((view) => !pinSet.has(view.action.key));
  const hybridOverflow = [...actions.secondary, ...actions.overflow].filter((view) => !pinSet.has(view.action.key));
  const overflowOnly = actions.all.filter((view) => !pinSet.has(view.action.key));

  return (
    <div data-testid="issue-action-menu" className={className ?? 'flex items-center gap-1'}>
      {mode !== 'overflow-only' ? primary.map((view) => (
        <ActionButton key={view.action.key} view={view} inline />
      )) : null}
      {mode === 'overflow-only' ? <OverflowButton views={overflowOnly} /> : null}
      {mode === 'hybrid' && hybridOverflow.length > 0 ? <OverflowButton views={hybridOverflow} /> : null}
      {pinned.length > 0 ? <div data-testid="issue-action-pin-spacer" className="flex-1" /> : null}
      {pinned.map((view) => (
        <ActionButton key={view.action.key} view={view} inline />
      ))}
      <IssueActionDialogHost issueId={issueId} actions={actions} />
    </div>
  );
}
