import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { ChevronRight, MoreHorizontal, X } from 'lucide-react';
import { useMenuOpen } from '../../lib/menuOpenState';

import { AgentTellForm } from '../AgentTellForm';
import { PlanDialog } from '../PlanDialog';
import type { IssueActionKey } from '../../lib/issueActions';
import {
  ContextMenuContent,
  ContextMenuDestructiveItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '../shared/ContextMenu';
import {
  IssueActionGroupedBody,
  type IssueActionGroupedBodyProps,
  type IssueActionMenuItemPrimitiveProps,
  type IssueActionMenuPrimitives,
  type NonIssueActionInvocation,
} from './IssueActionGroupedBody';
import { IssueOpenInDialog } from './IssueOpenInDialog';
import type { IssueActionView, UseIssueActionsResult } from './useIssueActions';
import { useIssueActions } from './useIssueActions';

export type IssueActionMenuMode = 'inline' | 'overflow-only' | 'primary-strip';

export type IssueActionPinnedComponent = {
  key: string;
  render: ReactNode;
};

export interface IssueActionMenuProps {
  issueId: string;
  mode: IssueActionMenuMode;
  pinRight?: IssueActionKey[];
  pinned?: IssueActionPinnedComponent[];
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
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const hasSubmenu = !!view.submenu?.length;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        data-testid={`issue-action-${view.action.key}`}
        className={actionButtonClass(view, inline)}
        disabled={!view.enabled || view.isPending}
        title={view.disabledReason ?? view.action.label}
        aria-haspopup={hasSubmenu ? 'menu' : undefined}
        aria-expanded={hasSubmenu ? submenuOpen : undefined}
        onClick={() => {
          if (hasSubmenu) {
            setSubmenuOpen((open) => !open);
            return;
          }
          view.invoke();
          onInvoked?.();
        }}
      >
        {view.isPending ? `${view.action.label}…` : view.action.label}
        {hasSubmenu ? <ChevronRight className="ml-1 h-3 w-3 opacity-50" /> : null}
      </button>
      {hasSubmenu && submenuOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSubmenuOpen(false)} />
          <div
            role="menu"
            data-testid={`issue-action-submenu-${view.action.key}`}
            className="absolute left-0 top-full z-50 mt-1 w-[220px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {view.submenu!.map((option) => (
              <button
                key={option.key}
                type="button"
                role="menuitem"
                data-testid={`issue-action-${view.action.key}-option-${option.key}`}
                className="relative flex w-full cursor-pointer select-none items-center rounded px-3 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setSubmenuOpen(false);
                  option.invoke();
                  onInvoked?.();
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </span>
  );
}

function createPopoverMenuItem(onClose: () => void, destructive: boolean) {
  return function PopoverMenuItem({
    children,
    className = '',
    disabled,
    role = 'menuitem',
    onActivate,
    preventClose,
    ...props
  }: IssueActionMenuItemPrimitiveProps) {
    const colorClass = destructive
      ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
      : 'text-foreground hover:bg-accent hover:text-accent-foreground';

    return (
      <button
        {...props}
        type="button"
        role={role}
        disabled={disabled}
        className={`relative flex w-full cursor-pointer select-none items-center rounded px-3 py-1.5 text-left text-xs outline-none transition-colors disabled:pointer-events-none disabled:opacity-40 ${colorClass} ${className}`}
        onClick={() => {
          onActivate?.();
          if (!preventClose) onClose();
        }}
      >
        {children}
      </button>
    );
  };
}

function PopoverMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function PopoverMenuSeparator() {
  return <div className="mx-1 my-1 h-px bg-border" />;
}

function popoverMenuPrimitives(onClose: () => void): IssueActionMenuPrimitives {
  return {
    Item: createPopoverMenuItem(onClose, false),
    DestructiveItem: createPopoverMenuItem(onClose, true),
    Label: PopoverMenuLabel,
    Separator: PopoverMenuSeparator,
  };
}

function OverflowMenu({
  actions,
  onClose,
}: {
  actions: Pick<UseIssueActionsResult, 'all' | 'primary' | 'phase'>;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="menu"
        data-testid="issue-action-overflow-menu"
        className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-[320px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        <IssueActionGroupedBody actions={actions} primitives={popoverMenuPrimitives(onClose)} />
      </div>
    </>
  );
}

/* ── context presentation (right-click) — the third IssueActionMenu
 *  presentation (strip · overflow · context), folded in from the deleted
 *  GroupedIssueActionMenu skin (PAN-2908 C-ACTIONS §8.3). */

function ContextMenuItemPrimitive({
  onActivate,
  preventClose,
  ...props
}: IssueActionMenuItemPrimitiveProps) {
  return (
    <ContextMenuItem
      {...props}
      onSelect={(event) => {
        if (preventClose) event.preventDefault();
        onActivate?.();
      }}
    />
  );
}

function ContextMenuDestructiveItemPrimitive({
  onActivate,
  preventClose,
  ...props
}: IssueActionMenuItemPrimitiveProps) {
  return (
    <ContextMenuDestructiveItem
      {...props}
      onSelect={(event) => {
        if (preventClose) event.preventDefault();
        onActivate?.();
      }}
    />
  );
}

const contextMenuPrimitives: IssueActionMenuPrimitives = {
  Item: ContextMenuItemPrimitive,
  DestructiveItem: ContextMenuDestructiveItemPrimitive,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
};

export type { NonIssueActionInvocation };

export type IssueActionContextMenuProps = Omit<IssueActionGroupedBodyProps, 'primitives'> & {
  'data-section'?: string;
};

/** Right-click presentation of the one grouped body, for ContextMenuRoot hosts. */
export function IssueActionContextMenu({
  actions,
  nonIssueActions,
  defaultExplain,
  'data-section': dataSection,
}: IssueActionContextMenuProps) {
  return (
    <ContextMenuContent className="w-[320px] font-sans" data-section={dataSection}>
      <IssueActionGroupedBody
        actions={actions}
        primitives={contextMenuPrimitives}
        nonIssueActions={nonIssueActions}
        defaultExplain={defaultExplain}
      />
    </ContextMenuContent>
  );
}

function OverflowButton({
  actions,
  triggerRef,
  openSignal,
  count,
  menuKey,
}: {
  actions: Pick<UseIssueActionsResult, 'all' | 'primary' | 'phase'>;
  triggerRef?: RefObject<HTMLButtonElement>;
  openSignal?: number;
  count?: number;
  menuKey?: string;
}) {
  // PAN-2937: open state lives in the store so live re-renders can't close it.
  const openMenuKey = useMenuOpen((s) => s.openMenuKey);
  const setOpenMenu = useMenuOpen((s) => s.setOpenMenu);
  const key = menuKey ?? `issue-action:${actions.phase}`;
  const open = openMenuKey === key;
  const more = count ?? actions.all.length;

  useEffect(() => {
    if (openSignal) setOpenMenu(key);
  }, [openSignal]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        data-testid="issue-action-overflow-button"
        aria-label={`${more} more issue actions`}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => setOpenMenu(open ? null : key)}
      >
        <MoreHorizontal className="h-4 w-4" />
        <span>{more} more</span>
      </button>
      {open ? <OverflowMenu actions={actions} onClose={() => setOpenMenu(null)} /> : null}
    </div>
  );
}

type TaskTask = {
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


function NewOrderBookDialog({ actions, onClose }: { actions: UseIssueActionsResult; onClose: () => void }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await actions.createOrderBookForIssue(trimmed);
      onClose();
    } catch {
      // The shared action hook presents the server error.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialogFrame label="New order book" onClose={onClose}>
      <form className="space-y-3" onSubmit={(event) => { void onSubmit(event); }}>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>Book name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
        </label>
        <p className="text-[11px] text-muted-foreground">The issue will be added to Lane A. Arrange the book on the Order Book page.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!name.trim() || submitting} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{submitting ? 'Creating…' : 'Create & add'}</button>
        </div>
      </form>
    </ActionDialogFrame>
  );
}

function InspectTaskDialog({ issueId, actions, onClose }: { issueId: string; actions: UseIssueActionsResult; onClose: () => void }) {
  const action = actions.activeDialog?.action;
  const [tasks, setTasks] = useState<TaskTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/issues/${encodeURIComponent(issueId)}/tasks`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load tasks');
        return response.json() as Promise<{ tasks?: TaskTask[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const nextTasks = data.tasks ?? [];
        setTasks(nextTasks);
        setSelectedTaskId(nextTasks[0]?.id ?? '');
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
    if (!selectedTaskId) return;
    actions.submitDialogAction(action, undefined, selectedTaskId);
    onClose();
  };

  return (
    <ActionDialogFrame label={action.label} onClose={onClose}>
      <form className="space-y-3" onSubmit={onSubmit}>
        {loading ? <p className="text-xs text-muted-foreground">Loading tasks…</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {!loading && !error && tasks.length === 0 ? <p className="text-xs text-muted-foreground">No tasks are available for inspection.</p> : null}
        {tasks.length > 0 ? (
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Task</span>
            <select
              value={selectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
              aria-label="Task to inspect"
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
          <button type="submit" disabled={!selectedTaskId || actions.isActionPending(action.key)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
            {actions.isActionPending(action.key) ? 'Starting…' : 'Inspect task'}
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
            actions.submitDialogAction(activeDialog.action, { message }, undefined, activeDialog.targetAgentId);
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

  if (activeDialog.key === 'inspectTask') {
    return <InspectTaskDialog issueId={issueId} actions={actions} onClose={handleClose} />;
  }

  if (activeDialog.key === 'addToOrderBook') {
    return <NewOrderBookDialog actions={actions} onClose={handleClose} />;
  }

  return (
    <ActionDialogFrame label={activeDialog.action.label} onClose={handleClose}>
      <p className="text-xs text-muted-foreground">This action opens from the shared issue action surface.</p>
    </ActionDialogFrame>
  );
}

export function IssueActionMenu({
  issueId,
  mode,
  pinRight = [],
  pinned = [],
  className,
  agentScopeOnly = false,
  openSignal,
}: IssueActionMenuProps) {
  const actions = useIssueActions(issueId);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreOverflowFocus = () => overflowTriggerRef.current?.focus();
  const componentPinSet = useMemo(
    () => new Set<string>(pinned.map((component) => component.key)),
    [pinned],
  );
  const requestedPinSet = useMemo(
    () => new Set<string>([...pinRight, ...componentPinSet]),
    [pinRight, componentPinSet],
  );
  const inScope = (view: IssueActionView) => !agentScopeOnly || AGENT_SCOPE_ACTION_KEYS.has(view.action.key);
  const scopedAll = actions.all.filter(inScope);
  const scopedPrimary = actions.primary.filter(inScope);
  const scopedSecondary = actions.secondary.filter(inScope);
  const scopedOverflow = actions.overflow.filter(inScope);
  const registryPins = pinRight
    .map((key) => scopedAll.find((view) => view.action.key === key && view.enabled))
    .filter((view): view is IssueActionView => !!view);
  const enabledRegistryPinSet = new Set(registryPins.map((view) => view.action.key));
  const excludedFromOverflow = (view: IssueActionView) =>
    enabledRegistryPinSet.has(view.action.key) || componentPinSet.has(view.action.key);
  const primary = scopedPrimary.filter((view) => !requestedPinSet.has(view.action.key));
  const primaryStripOverflow = [...scopedSecondary, ...scopedOverflow]
    .filter((view) => !excludedFromOverflow(view));
  const overflowOnly = scopedAll.filter((view) => !excludedFromOverflow(view));
  // The overflow body is the FULL menu (phase section + every group) minus
  // pinned entries — one complete menu everywhere (C-ACTIONS). The button
  // count stays cosmetic: items beyond the inline strip.
  const menuAll = mode === 'overflow-only' ? overflowOnly : [...primary, ...primaryStripOverflow];
  const overflowPrimary = scopedPrimary.filter((view) => !excludedFromOverflow(view));
  const overflowCount = (mode === 'overflow-only' ? overflowOnly : primaryStripOverflow).length;
  const overflowActions = {
    all: menuAll,
    primary: overflowPrimary,
    phase: actions.phase,
  };
  const hasPins = registryPins.length > 0 || pinned.length > 0;

  return (
    <div data-testid="issue-action-menu" className={className ?? 'flex items-center gap-1'}>
      {mode !== 'overflow-only' ? primary.map((view) => (
        <ActionButton key={view.action.key} view={view} inline />
      )) : null}
      {mode === 'overflow-only' || (mode === 'primary-strip' && menuAll.length > 0) ? (
        <OverflowButton actions={overflowActions} count={overflowCount} triggerRef={overflowTriggerRef} openSignal={openSignal} menuKey={`issue-action:${issueId}`} />
      ) : null}
      {hasPins ? <div data-testid="issue-action-pin-spacer" className="flex-1" /> : null}
      {registryPins.map((view) => (
        <ActionButton key={view.action.key} view={view} inline />
      ))}
      {pinned.map((component) => (
        <span key={component.key} data-issue-action-pinned-component={component.key} className="inline-flex">
          {component.render}
        </span>
      ))}
      <IssueActionDialogHost issueId={issueId} actions={actions} onAfterClose={restoreOverflowFocus} />
    </div>
  );
}
