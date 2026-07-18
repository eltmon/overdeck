import { useId, useState, type AriaRole, type ComponentType, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import {
  GROUP_LABELS,
  GROUP_ORDER,
  type NonIssueActionContext,
  type NonIssueActionEntry,
  type PipelinePhase,
} from '../../lib/issueActions';
import type { IssueActionView, UseIssueActionsResult } from './useIssueActions';

const EXPLAIN_PREFERENCE_KEY = 'overdeck.issueActions.explain';

export type NonIssueActionInvocation = {
  action: NonIssueActionEntry;
  context: NonIssueActionContext;
};

export type IssueActionMenuItemPrimitiveProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  role?: AriaRole;
  'aria-describedby'?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-checked'?: boolean | 'mixed';
  'data-testid'?: string;
  onActivate?: () => void;
  preventClose?: boolean;
};

export type IssueActionMenuPrimitives = {
  Item: ComponentType<IssueActionMenuItemPrimitiveProps>;
  DestructiveItem: ComponentType<IssueActionMenuItemPrimitiveProps>;
  Label: ComponentType<{ children: ReactNode }>;
  Separator: ComponentType;
};

export type IssueActionGroupedBodyProps = {
  actions: Pick<UseIssueActionsResult, 'all' | 'primary' | 'phase'>;
  primitives: IssueActionMenuPrimitives;
  nonIssueActions?: NonIssueActionInvocation[];
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

function ActionRow({
  view,
  explain,
  primitives,
}: {
  view: IssueActionView;
  explain: boolean;
  primitives: IssueActionMenuPrimitives;
}) {
  const reasonId = useId();
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const disabled = !view.enabled || view.isPending;
  const Item = view.action.kind === 'destructive' ? primitives.DestructiveItem : primitives.Item;

  if (disabled) {
    const reason = view.disabledReason ?? `${view.action.label} is unavailable while another action is running.`;
    return (
      <span
        className="block"
        title={reason}
        aria-describedby={reasonId}
        data-testid={`issue-action-disabled-${view.action.key}`}
      >
        <Item
          disabled
          aria-describedby={reasonId}
          className="w-full opacity-50"
          data-testid={`issue-action-${view.action.key}`}
        >
          <ActionContent view={view} explain={explain} />
        </Item>
        <span id={reasonId} className="sr-only">{reason}</span>
      </span>
    );
  }

  if (view.submenu) {
    return (
      <div data-testid={`issue-action-submenu-${view.action.key}`}>
        <Item
          title={view.action.description}
          data-testid={`issue-action-${view.action.key}`}
          aria-expanded={submenuOpen}
          onActivate={() => setSubmenuOpen((open) => !open)}
          preventClose
        >
          <ActionContent view={view} explain={explain} />
          <ChevronRight className={`ml-2 h-3 w-3 shrink-0 transition-transform ${submenuOpen ? 'rotate-90' : ''}`} />
        </Item>
        {submenuOpen ? (
          <div className="ml-3 border-l border-border pl-1" role="group" aria-label={`${view.action.label} options`}>
            {view.submenu.map((option) => (
              <primitives.Item key={option.key} data-testid={`issue-action-${view.action.key}-${option.key}`} onActivate={option.invoke}>
                {option.label}
              </primitives.Item>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Item
      title={view.action.description}
      data-testid={`issue-action-${view.action.key}`}
      onActivate={view.invoke}
    >
      <ActionContent view={view} explain={explain} />
    </Item>
  );
}

function NonIssueActionRow({
  invocation,
  primitives,
}: {
  invocation: NonIssueActionInvocation;
  primitives: IssueActionMenuPrimitives;
}) {
  const { action, context } = invocation;
  const Item = action.kind === 'destructive' ? primitives.DestructiveItem : primitives.Item;
  return (
    <Item
      title={action.description}
      data-testid={`non-issue-action-${action.key}`}
      onActivate={() => { void action.invoke(context); }}
    >
      {action.label}
    </Item>
  );
}

export function IssueActionGroupedBody({
  actions,
  primitives,
  nonIssueActions = [],
  defaultExplain = false,
}: IssueActionGroupedBodyProps) {
  const { Item, Label, Separator } = primitives;
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
    <>
      <Label>
        <span className="flex items-center gap-2">
          <span>Issue actions</span>
          <span className="inline-flex h-[18px] items-center rounded-[3px] border border-primary/30 bg-primary/10 px-[7px] text-[10px] font-medium normal-case tracking-[0.04em] text-foreground">
            {phaseLabel(actions.phase)}
          </span>
        </span>
      </Label>
      <div className="px-3 pb-1.5 pt-1 text-[11px] text-muted-foreground">
        {availableCount} available now · {actions.all.length - availableCount} gated
      </div>

      {phasePrimary.length > 0 ? (
        <>
          <div data-issue-action-section="phase">
            <Label>For this phase</Label>
            {phasePrimary.map((view) => (
              <ActionRow key={`phase-${view.action.key}`} view={view} explain={explain} primitives={primitives} />
            ))}
          </div>
          <Separator />
        </>
      ) : null}

      {GROUP_ORDER.filter((group) => group !== 'danger').map((group) => {
        const groupActions = actions.all.filter((view) => view.action.group === group);
        if (groupActions.length === 0) return null;
        return (
          <div key={group} data-issue-action-section={group}>
            <Label>{GROUP_LABELS[group]}</Label>
            {groupActions.map((view) => (
              <ActionRow key={view.action.key} view={view} explain={explain} primitives={primitives} />
            ))}
          </div>
        );
      })}

      {nonIssueActions.length > 0 ? (
        <div data-issue-action-section="session">
          <Label>This session</Label>
          {nonIssueActions.map((invocation) => (
            <NonIssueActionRow
              key={invocation.action.key}
              invocation={invocation}
              primitives={primitives}
            />
          ))}
        </div>
      ) : null}

      <Separator />
      <Item
        className="justify-between text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
        aria-expanded={dangerOpen}
        aria-controls="issue-action-danger-items"
        onActivate={toggleDanger}
        preventClose
      >
        <span>Danger ({availableDangerCount} available)</span>
        <ChevronRight className={`h-3 w-3 transition-transform ${dangerOpen ? 'rotate-90' : ''}`} />
      </Item>
      {dangerOpen ? (
        <div id="issue-action-danger-items" data-issue-action-section="danger">
          {dangerActions.map((view) => (
            <ActionRow key={view.action.key} view={view} explain={explain} primitives={primitives} />
          ))}
        </div>
      ) : null}

      <Separator />
      <Item
        className="justify-between text-muted-foreground"
        role="menuitemcheckbox"
        aria-checked={explain}
        data-testid="issue-action-explain-toggle"
        onActivate={toggleExplain}
        preventClose
      >
        <span>Explain actions</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.04em]">
          {explain ? 'On' : 'Off'}
        </span>
      </Item>
    </>
  );
}
