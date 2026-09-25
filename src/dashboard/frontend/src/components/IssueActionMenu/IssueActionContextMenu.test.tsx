import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GROUP_LABELS,
  ISSUE_ACTIONS,
  PROJECT_TREE_CONTEXT_ACTIONS,
  type IssueActionKey,
  type PipelinePhase,
} from '../../lib/issueActions';
import { ContextMenuRoot, ContextMenuTrigger } from '../shared/ContextMenu';
import { IssueActionContextMenu, type NonIssueActionInvocation } from './IssueActionMenu';
import {
  IssueActionGroupedBody,
  type IssueActionMenuItemPrimitiveProps,
  type IssueActionMenuPrimitives,
} from './IssueActionGroupedBody';
import type { IssueActionView } from './useIssueActions';

// PAN-4198: four groups — 'recover' folded into lifecycle, 'navigation' into inspect.
const NON_DANGER_GROUPS = ['communicate', 'lifecycle', 'inspect'] as const;

const invokes = new Map<IssueActionKey, ReturnType<typeof vi.fn>>();

function actionViews(enabledKeys: IssueActionKey[], actionKeys?: IssueActionKey[]) {
  const enabled = new Set(enabledKeys);
  const included = actionKeys ? new Set(actionKeys) : undefined;
  return ISSUE_ACTIONS.filter((action) => !included || included.has(action.key)).map<IssueActionView>((action) => {
    const invoke = vi.fn();
    invokes.set(action.key, invoke);
    return {
      action,
      enabled: enabled.has(action.key),
      disabledReason: enabled.has(action.key) ? undefined : `${action.label} is gated for this test.`,
      isPending: false,
      invoke,
    };
  });
}

function sessionArtifactInvocation(onOpenStateDir: () => void): NonIssueActionInvocation {
  const action = PROJECT_TREE_CONTEXT_ACTIONS.find((entry) => entry.key === 'openStateDir');
  if (!action) throw new Error('Missing openStateDir action');
  return {
    action,
    context: { sessionId: 'agent-pan-1610', onOpenStateDir },
  };
}

function PlainMenuItem({
  children,
  onActivate,
  preventClose: _preventClose,
  role = 'menuitem',
  ...props
}: IssueActionMenuItemPrimitiveProps) {
  return (
    <button type="button" role={role} onClick={onActivate} {...props}>
      {children}
    </button>
  );
}

const plainMenuPrimitives: IssueActionMenuPrimitives = {
  Item: PlainMenuItem,
  DestructiveItem: PlainMenuItem,
  Label: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Separator: () => <hr />,
};

function renderMenu({
  phase,
  primaryKeys,
  enabledKeys,
  actionKeys,
  nonIssueActions = [],
}: {
  phase: PipelinePhase;
  primaryKeys: IssueActionKey[];
  enabledKeys: IssueActionKey[];
  actionKeys?: IssueActionKey[];
  nonIssueActions?: NonIssueActionInvocation[];
}) {
  const all = actionViews(enabledKeys, actionKeys);
  const byKey = new Map(all.map((view) => [view.action.key, view]));
  const primary = primaryKeys.map((key) => byKey.get(key)).filter((view): view is IssueActionView => !!view);

  render(
    <ContextMenuRoot>
      <ContextMenuTrigger>Open menu</ContextMenuTrigger>
      <IssueActionContextMenu actions={{ all, primary, phase }} nonIssueActions={nonIssueActions} />
    </ContextMenuRoot>,
  );
  fireEvent.contextMenu(screen.getByText('Open menu'));
  return screen.getByRole('menu');
}

function expectInDocumentOrder(elements: HTMLElement[]) {
  for (let index = 1; index < elements.length; index += 1) {
    expect(elements[index - 1].compareDocumentPosition(elements[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  invokes.clear();
});

describe('IssueActionContextMenu', () => {
  it('renders the binding WORK_RUNNING structure with each primary exactly once', () => {
    const sessionExtra = vi.fn();
    const menu = renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['tell', 'doneWork'],
      // syncMain is enabled but lands in Actions; resetIssue is the Danger row.
      enabledKeys: ['tell', 'doneWork', 'syncMain', 'resetIssue'],
      nonIssueActions: [sessionArtifactInvocation(sessionExtra)],
    });

    expect(screen.getByText('Work running')).toBeInTheDocument();
    // PAN-4198 (FR-1): no "N available · M gated" line — a gated action is not
    // rendered at all, so there is nothing to count.
    expect(screen.queryByText(/available now/)).not.toBeInTheDocument();
    // FR-3: a primary appears under "Next step" and nowhere else.
    expect(screen.getAllByText('Message agent')).toHaveLength(1);
    expect(screen.getAllByText('Finish work and start review')).toHaveLength(1);
    const phaseSection = menu.querySelector('[data-issue-action-section="phase"]') as HTMLElement;
    expect(within(phaseSection).getByText('Message agent')).toBeInTheDocument();
    expect(within(menu.querySelector('[data-issue-action-section="lifecycle"]') as HTMLElement)
      .queryByText('Message agent')).not.toBeInTheDocument();
    // communicate held only `tell`, which is a primary here, so it renders no section.
    expect(menu.querySelector('[data-issue-action-section="communicate"]')).toBeNull();

    expectInDocumentOrder([
      screen.getByText('Next step'),
      within(menu.querySelector('[data-issue-action-section="lifecycle"]') as HTMLElement).getByText(GROUP_LABELS.lifecycle),
      screen.getByRole('menuitem', { name: 'Debug' }),
      screen.getByRole('menuitem', { name: 'Danger' }),
    ]);

    // Both disclosures start collapsed.
    expect(screen.queryByText('Reset to Todo')).not.toBeInTheDocument();
    expect(screen.queryByText('Open State Dir')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Danger' })).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveClass('max-h-[70vh]', 'overflow-y-auto');

    // D13: session utilities live under Debug.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }));
    expect(menu.querySelector('[data-issue-action-section="session"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open State Dir' }));
    expect(sessionExtra).toHaveBeenCalledOnce();
  });

  it('renders the complete grouped body inside a plain non-Radix menu host', () => {
    const sessionExtra = vi.fn();
    const all = actionViews(['plan', 'resetIssue'], ['plan', 'tell', 'resetIssue']);
    const plan = all.find((view) => view.action.key === 'plan');
    expect(plan).toBeDefined();

    const { container } = render(
      <div role="menu" data-testid="plain-menu-host">
        <IssueActionGroupedBody
          actions={{ all, primary: [plan!], phase: 'QUEUED_FOR_PLAN' }}
          primitives={plainMenuPrimitives}
          nonIssueActions={[sessionArtifactInvocation(sessionExtra)]}
        />
      </div>,
    );

    expect(screen.getByTestId('plain-menu-host')).toBeInTheDocument();
    // `plan` is the primary and `resetIssue` is Danger, so lifecycle has no
    // remaining row; `tell` is gated, so communicate renders nothing (FR-1).
    for (const section of ['phase']) {
      expect(container.querySelector(`[data-issue-action-section="${section}"]`)).toBeInTheDocument();
    }
    expect(container.querySelector('[data-issue-action-section="communicate"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-issue-action-section="danger"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-issue-action-section="session"]')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-action-resetIssue')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Danger' }));
    expect(container.querySelector('[data-issue-action-section="danger"]')).toBeInTheDocument();
    expect(screen.getByTestId('issue-action-resetIssue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }));
    expect(container.querySelector('[data-issue-action-section="session"]')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('issue-action-explain-toggle'));
    expect(localStorage.getItem('overdeck.issueActions.explain')).toBe('true');
    // Two enabled rows: the Plan… primary and the Reset to Todo Danger row.
    expect(screen.getAllByTestId(/^issue-action-description-/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open State Dir' }));
    expect(sessionExtra).toHaveBeenCalledOnce();
  });

  it('leads a STUCK phase with Restart agent then Message agent and preserves arrow-key focus', () => {
    const menu = renderMenu({
      phase: 'STUCK',
      primaryKeys: ['restartAgent', 'tell'],
      enabledKeys: ['restartAgent', 'tell'],
    });

    expect(screen.getByText('Stuck')).toBeInTheDocument();
    const restartRows = screen.getAllByText('Restart agent…');
    const tellRows = screen.getAllByText('Message agent');
    // FR-3: once each, in the "Next step" section, in the order the phase map declares.
    expect(restartRows).toHaveLength(1);
    expect(tellRows).toHaveLength(1);
    expectInDocumentOrder([restartRows[0], tellRows[0]]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(restartRows[0].closest('[role="menuitem"]')).toHaveFocus();
  });

  it('omits gated actions entirely instead of showing them with a reason (PAN-4198 FR-1)', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['tell', 'doneWork'],
      enabledKeys: ['tell', 'doneWork'],
    });

    expect(screen.getAllByTestId('issue-action-tell')[0]).toHaveAttribute(
      'title',
      ISSUE_ACTIONS.find((action) => action.key === 'tell')?.description,
    );

    // A gated action leaves no row, no tooltip, and nothing to click.
    expect(screen.queryByTestId('issue-action-disabled-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-action-plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Plan…')).not.toBeInTheDocument();
    expect(invokes.get('plan')).not.toHaveBeenCalled();

    // Contextual entries are not listed either, however their state reads.
    for (const key of ['pause', 'recoverAgent', 'rebuildAndStart', 'createWorkspace']) {
      expect(screen.queryByTestId(`issue-action-${key}`), key).not.toBeInTheDocument();
    }
  });

  it('marks a pending action disabled with its own row (the one surviving disabled case)', () => {
    const all = actionViews(['tell'], ['tell']).map((view) => ({ ...view, isPending: true }));
    render(
      <div role="menu" data-testid="plain-menu-host">
        <IssueActionGroupedBody
          actions={{ all, primary: [], phase: 'WORK_RUNNING' }}
          primitives={plainMenuPrimitives}
        />
      </div>,
    );

    const wrapper = screen.getByTestId('issue-action-disabled-tell');
    const reasonId = wrapper.getAttribute('aria-describedby');
    expect(wrapper).toHaveClass('block');
    expect(reasonId).toBeTruthy();
    expect(within(wrapper).getByRole('menuitem')).toBeDisabled();
    expect(screen.getByText('Message agent…')).toBeInTheDocument();
  });

  it('shows only enabled phase-primary rows and hides empty groups', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['plan', 'tell'],
      enabledKeys: ['tell'],
      actionKeys: ['plan', 'tell'],
    });

    const phaseSection = document.querySelector('[data-issue-action-section="phase"]') as HTMLElement;
    expect(within(phaseSection).queryByText('Plan…')).not.toBeInTheDocument();
    // `tell` is the only enabled row and it is a primary, so it renders once in
    // the phase section and every group section is empty.
    expect(screen.getAllByText('Message agent')).toHaveLength(1);
    expect(document.querySelector('[data-issue-action-section="lifecycle"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="communicate"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="inspect"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Danger' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Debug' })).not.toBeInTheDocument();
  });

  it('starts with explanations off and keeps the footer toggle visible', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: [],
      enabledKeys: ['plan', 'watchPlanning'],
      actionKeys: ['plan', 'watchPlanning'],
    });

    expect(screen.getByTestId('issue-action-explain-toggle')).toHaveTextContent('Explain actions');
    expect(screen.getByTestId('issue-action-explain-toggle')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('issue-action-description-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-action-verb-plan')).not.toBeInTheDocument();
  });

  it('renders every description and available pan verb after toggling and persists the preference', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: [],
      enabledKeys: ISSUE_ACTIONS.map((action) => action.key),
    });

    const menuPlaced = ISSUE_ACTIONS.filter((action) => action.placement === 'menu');

    fireEvent.click(screen.getByTestId('issue-action-explain-toggle'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Danger' }));

    expect(localStorage.getItem('overdeck.issueActions.explain')).toBe('true');
    expect(screen.getByTestId('issue-action-explain-toggle')).toHaveAttribute('aria-checked', 'true');
    // Only menu-placed entries render, so only they carry copy (FR-1).
    expect(screen.getAllByTestId(/^issue-action-description-/)).toHaveLength(menuPlaced.length);
    expect(screen.getAllByTestId(/^issue-action-verb-/)).toHaveLength(
      menuPlaced.filter((action) => action.panVerb !== null).length,
    );
    expect(screen.getByTestId('issue-action-verb-plan')).toHaveTextContent('pan plan');
    expect(screen.queryByTestId('issue-action-verb-watchPlanning')).not.toBeInTheDocument();
  });

  it('starts with explanations on when the stored preference is true', () => {
    localStorage.setItem('overdeck.issueActions.explain', 'true');

    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: [],
      enabledKeys: ['plan'],
      actionKeys: ['plan'],
    });

    expect(screen.getByTestId('issue-action-explain-toggle')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('issue-action-description-plan')).toHaveTextContent(
      ISSUE_ACTIONS.find((action) => action.key === 'plan')?.description ?? '',
    );
    expect(screen.getByTestId('issue-action-verb-plan')).toHaveTextContent('pan plan');
  });

  it('toggles Danger with pointer, Enter, and Space and keeps destructive styling inside it', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['tell', 'doneWork'],
      enabledKeys: ['tell', 'doneWork', 'recoverAgent', 'resetIssue'],
    });

    const disclosure = screen.getByRole('menuitem', { name: 'Danger' });
    expect(screen.queryByTestId('issue-action-resetIssue')).not.toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('issue-action-resetIssue')).toHaveClass('text-destructive');

    fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('issue-action-resetIssue')).not.toBeInTheDocument();

    fireEvent.keyDown(disclosure, { key: ' ' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('issue-action-resetIssue')).toBeInTheDocument();
  });
});
