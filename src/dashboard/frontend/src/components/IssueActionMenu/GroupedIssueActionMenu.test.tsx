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
import { GroupedIssueActionMenu, type NonIssueActionInvocation } from './GroupedIssueActionMenu';
import {
  IssueActionGroupedBody,
  type IssueActionMenuItemPrimitiveProps,
  type IssueActionMenuPrimitives,
} from './IssueActionGroupedBody';
import type { IssueActionView } from './useIssueActions';

const NON_DANGER_GROUPS = ['communicate', 'lifecycle', 'recover', 'inspect', 'navigation'] as const;

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
      <GroupedIssueActionMenu actions={{ all, primary, phase }} nonIssueActions={nonIssueActions} />
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

describe('GroupedIssueActionMenu', () => {
  it('renders the binding WORK_RUNNING structure, counts, and repeated phase-primary actions', () => {
    const sessionExtra = vi.fn();
    const menu = renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['tell', 'doneWork'],
      enabledKeys: ['tell', 'doneWork', 'purgeReview', 'wipe'],
      nonIssueActions: [sessionArtifactInvocation(sessionExtra)],
    });

    expect(screen.getByText('Work running')).toBeInTheDocument();
    expect(screen.getByText(`4 available now · ${ISSUE_ACTIONS.length - 4} gated`)).toBeInTheDocument();
    expect(screen.getAllByText('Tell agent')).toHaveLength(2);
    expect(screen.getAllByText('Done — mark work complete & start review')).toHaveLength(2);

    const sectionLabels = [
      screen.getByText('For this phase'),
      ...NON_DANGER_GROUPS.map((group) => {
        const section = menu.querySelector(`[data-issue-action-section="${group}"]`);
        expect(section).not.toBeNull();
        return within(section as HTMLElement).getByText(GROUP_LABELS[group]);
      }),
      screen.getByText('This session'),
      screen.getByRole('menuitem', { name: 'Danger (1 available)' }),
    ];
    expectInDocumentOrder(sectionLabels);

    expect(screen.queryByText('Wipe')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Danger (1 available)' })).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveClass('max-h-[70vh]', 'overflow-y-auto');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open State Dir' }));
    expect(sessionExtra).toHaveBeenCalledOnce();
  });

  it('renders the complete grouped body inside a plain non-Radix menu host', () => {
    const sessionExtra = vi.fn();
    const all = actionViews(['plan', 'wipe'], ['plan', 'tell', 'wipe']);
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
    for (const section of ['phase', 'lifecycle', 'communicate', 'session']) {
      expect(container.querySelector(`[data-issue-action-section="${section}"]`)).toBeInTheDocument();
    }
    expect(container.querySelector('[data-issue-action-section="danger"]')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-action-wipe')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Danger (1 available)' }));
    expect(container.querySelector('[data-issue-action-section="danger"]')).toBeInTheDocument();
    expect(screen.getByTestId('issue-action-wipe')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('issue-action-explain-toggle'));
    expect(localStorage.getItem('overdeck.issueActions.explain')).toBe('true');
    expect(screen.getAllByTestId(/^issue-action-description-/)).toHaveLength(4);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open State Dir' }));
    expect(sessionExtra).toHaveBeenCalledOnce();
  });

  it('leads a STUCK phase with Recover agent then Tell agent and preserves arrow-key focus', () => {
    const menu = renderMenu({
      phase: 'STUCK',
      primaryKeys: ['recoverAgent', 'tell'],
      enabledKeys: ['recoverAgent', 'tell'],
    });

    expect(screen.getByText('Stuck')).toBeInTheDocument();
    const recoverRows = screen.getAllByText('Recover agent');
    const tellRows = screen.getAllByText('Tell agent');
    expect(recoverRows).toHaveLength(2);
    expect(tellRows).toHaveLength(2);
    expectInDocumentOrder([recoverRows[0], tellRows[0]]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(recoverRows[0].closest('[role="menuitem"]')).toHaveFocus();
  });

  it('keeps disabled actions visible with their reason and never invokes them', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['tell', 'doneWork'],
      enabledKeys: ['tell', 'doneWork'],
    });

    expect(screen.getAllByTestId('issue-action-tell')[0]).toHaveAttribute(
      'title',
      ISSUE_ACTIONS.find((action) => action.key === 'tell')?.description,
    );

    const wrapper = screen.getByTestId('issue-action-disabled-plan');
    const reasonId = wrapper.getAttribute('aria-describedby');
    expect(wrapper).toHaveClass('block');
    expect(wrapper).toHaveAttribute('title', 'Plan is gated for this test.');
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)).toHaveTextContent('Plan is gated for this test.');
    const disabledItem = within(wrapper).getByRole('menuitem');
    expect(disabledItem).toHaveAttribute('data-disabled');
    expect(disabledItem).toHaveAttribute('aria-describedby', reasonId);

    fireEvent.click(disabledItem);
    expect(invokes.get('plan')).not.toHaveBeenCalled();
  });

  it('shows only enabled phase-primary rows and hides empty groups', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['plan', 'tell'],
      enabledKeys: ['tell'],
      actionKeys: ['plan', 'tell'],
    });

    const phaseSection = document.querySelector('[data-issue-action-section="phase"]') as HTMLElement;
    expect(within(phaseSection).queryByText('Plan')).not.toBeInTheDocument();
    expect(screen.getAllByText('Tell agent')).toHaveLength(2);
    expect(document.querySelector('[data-issue-action-section="lifecycle"]')).toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="communicate"]')).toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="recover"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="inspect"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="navigation"]')).not.toBeInTheDocument();
    expect(screen.queryByText('This session')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId('issue-action-explain-toggle'));
    fireEvent.click(screen.getByRole('menuitem', { name: `Danger (${ISSUE_ACTIONS.filter((action) => action.group === 'danger').length} available)` }));

    expect(localStorage.getItem('overdeck.issueActions.explain')).toBe('true');
    expect(screen.getByTestId('issue-action-explain-toggle')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByTestId(/^issue-action-description-/)).toHaveLength(ISSUE_ACTIONS.length);
    expect(screen.getAllByTestId(/^issue-action-verb-/)).toHaveLength(
      ISSUE_ACTIONS.filter((action) => action.panVerb !== null).length,
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

  it('toggles Danger with pointer, Enter, and Space and keeps destructive styling in both locations', () => {
    renderMenu({
      phase: 'WORK_RUNNING',
      primaryKeys: ['tell', 'doneWork'],
      enabledKeys: ['tell', 'doneWork', 'purgeReview', 'wipe'],
    });

    const disclosure = screen.getByRole('menuitem', { name: 'Danger (1 available)' });
    const purgeReview = screen.getByTestId('issue-action-purgeReview');
    expect(purgeReview).toHaveClass('text-destructive');

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('issue-action-wipe')).toHaveClass('text-destructive');

    fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('issue-action-wipe')).not.toBeInTheDocument();

    fireEvent.keyDown(disclosure, { key: ' ' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('issue-action-wipe')).toBeInTheDocument();
  });
});
