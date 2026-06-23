import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { MoreHorizontal, X } from 'lucide-react';

import { AgentTellForm } from '../AgentTellForm';
import { PlanDialog } from '../PlanDialog';
import type { IssueActionKey } from '../../lib/issueActions';
import { IssueOpenInDialog } from './IssueOpenInDialog';
import type { IssueActionView, UseIssueActionsResult } from './useIssueActions';
import { useIssueActions } from './useIssueActions';

export type IssueActionMenuMode = 'inline' | 'overflow-only' | 'hybrid';

export interface IssueActionMenuProps {
  issueId: string;
  mode: IssueActionMenuMode;
  pinRight?: IssueActionKey[];
  className?: string;
  agentScopeOnly?: boolean;
  openSignal?: number;
}

const AGENT_SCOPE_ACTION_KEYS = new Set<IssueActionKey>([
  'tell',
  'stopAgent',
  'pause',
  'unpause',
  'untroubled',
  'recoverAgent',
  'resumeSession',
]);

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

function OverflowButton({ views, triggerRef, openSignal }: { views: IssueActionView[]; triggerRef?: RefObject<HTMLButtonElement>; openSignal?: number }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
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

type BeadTask = {
  id: string;
  title: string;
  status: string;
};

type ActionDialogFrameProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

function ActionDialogFrame({ label, onClose, children }: ActionDialogFrameProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label}
        className="w-full max-w-md rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-medium">{label}</h3>
          <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}


function InspectBeadDialog({ issueId, actions, onClose }: { issueId: string; actions: UseIssueActionsResult; onClose: () => void }) {
  const action = actions.activeDialog?.action;
  const [tasks, setTasks] = useState<BeadTask[]>([]);
  const [selectedBeadId, setSelectedBeadId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/issues/${encodeURIComponent(issueId)}/beads`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load beads');
        return response.json() as Promise<{ tasks?: BeadTask[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const nextTasks = data.tasks ?? [];
        setTasks(nextTasks);
        setSelectedBeadId(nextTasks[0]?.id ?? '');
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [issueId]);

  if (!action) return null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBeadId) return;
    actions.submitDialogAction(action, undefined, selectedBeadId);
    onClose();
  };

  return (
    <ActionDialogFrame label={action.label} onClose={onClose}>
      <form className="space-y-3" onSubmit={onSubmit}>
        {loading ? <p className="text-xs text-muted-foreground">Loading beads…</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {!loading && !error && tasks.length === 0 ? <p className="text-xs text-muted-foreground">No beads are available for inspection.</p> : null}
        {tasks.length > 0 ? (
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Bead</span>
            <select
              value={selectedBeadId}
              onChange={(event) => setSelectedBeadId(event.target.value)}
              aria-label="Bead to inspect"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>{task.id} — {task.title}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!selectedBeadId || actions.isActionPending(action.key)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
            {actions.isActionPending(action.key) ? 'Starting…' : 'Inspect bead'}
          </button>
        </div>
      </form>
    </ActionDialogFrame>
  );
}

export function IssueActionDialogHost({ issueId, actions, onAfterClose }: { issueId: string; actions: UseIssueActionsResult; onAfterClose?: () => void }) {
  const { activeDialog, issue, workspace, closeDialog } = actions;
  const handleClose = () => {
    const restoreFocus = activeDialog?.key === 'open';
    closeDialog();
    if (restoreFocus) onAfterClose?.();
  };

  if (!activeDialog) return null;

  if ((activeDialog.key === 'plan' || activeDialog.key === 'autoPlan' || activeDialog.key === 'startSkipPlanning') && issue) {
    return (
      <PlanDialog
        issue={issue}
        isOpen
        autoStart={activeDialog.key === 'startSkipPlanning'}
        onClose={handleClose}
        onComplete={handleClose}
      />
    );
  }

  if (activeDialog.key === 'open' && workspace?.path) {
    return <IssueOpenInDialog cwd={workspace.path} onClose={handleClose} />;
  }

  if (activeDialog.key === 'tell') {
    return (
      <ActionDialogFrame label={activeDialog.action.label} onClose={handleClose}>
        <AgentTellForm
          onSend={(message) => {
            actions.submitDialogAction(activeDialog.action, { message });
            handleClose();
          }}
          onCancel={handleClose}
          sending={actions.isActionPending(activeDialog.action.key)}
          ariaLabel="Message to send to the agent"
          placeholder="Tell the agent what to do..."
          multiline
          className="space-y-3"
          inputClassName="min-h-[110px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          actionsClassName="flex justify-end gap-2"
        />
      </ActionDialogFrame>
    );
  }

  if (activeDialog.key === 'inspectBead') {
    return <InspectBeadDialog issueId={issueId} actions={actions} onClose={handleClose} />;
  }

  return (
    <ActionDialogFrame label={activeDialog.action.label} onClose={handleClose}>
      <p className="text-xs text-muted-foreground">This action opens from the shared issue action surface.</p>
    </ActionDialogFrame>
  );
}

export function IssueActionMenu({ issueId, mode, pinRight = [], className, agentScopeOnly = false, openSignal }: IssueActionMenuProps) {
  const actions = useIssueActions(issueId);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreOverflowFocus = () => overflowTriggerRef.current?.focus();
  const pinSet = useMemo(() => new Set(pinRight), [pinRight]);
  const inScope = (view: IssueActionView) => !agentScopeOnly || AGENT_SCOPE_ACTION_KEYS.has(view.action.key);
  const scopedAll = actions.all.filter(inScope);
  const scopedPrimary = actions.primary.filter(inScope);
  const scopedSecondary = actions.secondary.filter(inScope);
  const scopedOverflow = actions.overflow.filter(inScope);
  const pinned = pinRight
    .map((key) => scopedAll.find((view) => view.action.key === key && view.enabled))
    .filter((view): view is IssueActionView => !!view);
  const primary = scopedPrimary.filter((view) => !pinSet.has(view.action.key));
  const hybridOverflow = [...scopedSecondary, ...scopedOverflow].filter((view) => !pinSet.has(view.action.key));
  const overflowOnly = scopedAll.filter((view) => !pinSet.has(view.action.key));

  return (
    <div data-testid="issue-action-menu" className={className ?? 'flex items-center gap-1'}>
      {mode !== 'overflow-only' ? primary.map((view) => (
        <ActionButton key={view.action.key} view={view} inline />
      )) : null}
      {mode === 'overflow-only' ? <OverflowButton views={overflowOnly} triggerRef={overflowTriggerRef} openSignal={openSignal} /> : null}
      {mode === 'hybrid' && hybridOverflow.length > 0 ? <OverflowButton views={hybridOverflow} triggerRef={overflowTriggerRef} openSignal={openSignal} /> : null}
      {pinned.length > 0 ? <div data-testid="issue-action-pin-spacer" className="flex-1" /> : null}
      {pinned.map((view) => (
        <ActionButton key={view.action.key} view={view} inline />
      ))}
      <IssueActionDialogHost issueId={issueId} actions={actions} onAfterClose={restoreOverflowFocus} />
    </div>
  );
}
