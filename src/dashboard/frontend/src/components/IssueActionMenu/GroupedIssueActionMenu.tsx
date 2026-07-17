import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { GROUP_LABELS, GROUP_ORDER, type PipelinePhase } from '../../lib/issueActions';
import {
  ContextMenuContent,
  ContextMenuDestructiveItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '../shared/ContextMenu';
import type { IssueActionView, UseIssueActionsResult } from './useIssueActions';

const EXPLAIN_PREFERENCE_KEY = 'overdeck.issueActions.explain';

export type IssueActionSessionExtra = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
};

export type GroupedIssueActionMenuProps = {
  actions: Pick<UseIssueActionsResult, 'all' | 'primary' | 'phase'>;
  sessionExtras?: IssueActionSessionExtra[];
  defaultExplain?: boolean;
};

function phaseLabel(phase: PipelinePhase) {
  const label = phase.replaceAll('_', ' ').toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ActionContent({ view, explain }: { view: IssueActionView; explain: boolean }) {
  const label = view.isPending ? `${view.action.label}…` : view.action.label;

  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <span>{label}</span>
        {explain && view.action.panVerb ? (
          <span
            className="shrink-0 rounded-[3px] border border-border px-1 py-px font-mono text-[9px] font-medium leading-none text-muted-foreground"
            data-testid={`issue-action-verb-${view.action.key}`}
          >
            pan {view.action.panVerb}
          </span>
        ) : null}
      </span>
      {explain ? (
        <span
          className="mt-0.5 block text-[10.5px] font-medium leading-4 text-muted-foreground"
          data-testid={`issue-action-description-${view.action.key}`}
        >
          {view.action.description}
        </span>
      ) : null}
    </span>
  );
}

function ActionRow({ view, explain }: { view: IssueActionView; explain: boolean }) {
  const reasonId = useId();
  const disabled = !view.enabled || view.isPending;
  const destructive = view.action.kind === 'destructive';
  const Item = destructive ? ContextMenuDestructiveItem : ContextMenuItem;

  if (disabled) {
    const reason = view.disabledReason ?? `${view.action.label} is unavailable while another action is running.`;
    return (
      <span
        className="block"
        title={reason}
        aria-describedby={reasonId}
        data-testid={`issue-action-disabled-${view.action.key}`}
      >
        <Item disabled aria-describedby={reasonId} className="w-full opacity-50">
          <ActionContent view={view} explain={explain} />
        </Item>
        <span id={reasonId} className="sr-only">{reason}</span>
      </span>
    );
  }

  return (
    <Item
      title={view.action.description}
      data-testid={`issue-action-${view.action.key}`}
      onSelect={view.invoke}
    >
      <ActionContent view={view} explain={explain} />
    </Item>
  );
}

function SessionExtraRow({ extra }: { extra: IssueActionSessionExtra }) {
  const Item = extra.destructive ? ContextMenuDestructiveItem : ContextMenuItem;
  return (
    <Item onSelect={extra.onSelect}>
      {extra.icon ? <span className="mr-2 inline-flex shrink-0">{extra.icon}</span> : null}
      {extra.label}
    </Item>
  );
}

export function GroupedIssueActionMenu({
  actions,
  sessionExtras = [],
  defaultExplain = false,
}: GroupedIssueActionMenuProps) {
  const [dangerOpen, setDangerOpen] = useState(false);
  const [explain, setExplain] = useState(() => {
    const stored = localStorage.getItem(EXPLAIN_PREFERENCE_KEY);
    return stored === null ? defaultExplain : stored === 'true';
  });
  const availableCount = actions.all.filter((view) => view.enabled).length;
  const phasePrimary = actions.primary.filter((view) => view.enabled);
  const dangerActions = actions.all.filter((view) => view.action.group === 'danger');
  const availableDangerCount = dangerActions.filter((view) => view.enabled).length;

  const toggleDanger = () => setDangerOpen((open) => !open);
  const toggleExplain = () => {
    const next = !explain;
    localStorage.setItem(EXPLAIN_PREFERENCE_KEY, String(next));
    setExplain(next);
  };

  return (
    <ContextMenuContent className="w-[320px] font-sans">
      <ContextMenuLabel>
        <span className="flex items-center gap-2">
          <span>Issue actions</span>
          <span className="inline-flex h-[18px] items-center rounded-[3px] border border-primary/30 bg-primary/10 px-[7px] text-[10px] font-medium normal-case tracking-[0.04em] text-foreground">
            {phaseLabel(actions.phase)}
          </span>
        </span>
      </ContextMenuLabel>
      <div className="px-3 pb-1.5 pt-1 text-[11px] text-muted-foreground">
        {availableCount} available now · {actions.all.length - availableCount} gated
      </div>

      {phasePrimary.length > 0 ? (
        <>
          <div data-issue-action-section="phase">
            <ContextMenuLabel>For this phase</ContextMenuLabel>
            {phasePrimary.map((view) => <ActionRow key={`phase-${view.action.key}`} view={view} explain={explain} />)}
          </div>
          <ContextMenuSeparator />
        </>
      ) : null}

      {GROUP_ORDER.filter((group) => group !== 'danger').map((group) => {
        const groupActions = actions.all.filter((view) => view.action.group === group);
        if (groupActions.length === 0) return null;
        return (
          <div key={group} data-issue-action-section={group}>
            <ContextMenuLabel>{GROUP_LABELS[group]}</ContextMenuLabel>
            {groupActions.map((view) => <ActionRow key={view.action.key} view={view} explain={explain} />)}
          </div>
        );
      })}

      {sessionExtras.length > 0 ? (
        <div data-issue-action-section="session">
          <ContextMenuLabel>This session</ContextMenuLabel>
          {sessionExtras.map((extra) => <SessionExtraRow key={extra.key} extra={extra} />)}
        </div>
      ) : null}

      <ContextMenuSeparator />
      <ContextMenuItem
        className="justify-between text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
        aria-expanded={dangerOpen}
        aria-controls="issue-action-danger-items"
        onSelect={(event) => event.preventDefault()}
        onClick={toggleDanger}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleDanger();
          }
        }}
      >
        <span>Danger ({availableDangerCount} available)</span>
        <ChevronRight className={`h-3 w-3 transition-transform ${dangerOpen ? 'rotate-90' : ''}`} />
      </ContextMenuItem>
      {dangerOpen ? (
        <div id="issue-action-danger-items" data-issue-action-section="danger">
          {dangerActions.map((view) => <ActionRow key={view.action.key} view={view} explain={explain} />)}
        </div>
      ) : null}

      <ContextMenuSeparator />
      <ContextMenuItem
        className="justify-between text-muted-foreground"
        role="menuitemcheckbox"
        aria-checked={explain}
        data-testid="issue-action-explain-toggle"
        onSelect={(event) => event.preventDefault()}
        onClick={toggleExplain}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleExplain();
          }
        }}
      >
        <span>Explain actions</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.04em]">
          {explain ? 'On' : 'Off'}
        </span>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
