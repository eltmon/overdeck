import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GROUP_LABELS, GROUP_ORDER, ISSUE_ACTIONS, type IssueActionKey, type PipelinePhase } from '../../lib/issueActions';
import { ContextMenuRoot, ContextMenuTrigger } from '../shared/ContextMenu';
import { GroupedIssueActionMenu, type IssueActionSessionExtra } from './GroupedIssueActionMenu';
import type { IssueActionView } from './useIssueActions';

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

function renderMenu({
  phase,
  primaryKeys,
  enabledKeys,
  actionKeys,
  sessionExtras = [],
}: {
  phase: PipelinePhase;
  primaryKeys: IssueActionKey[];
  enabledKeys: IssueActionKey[];
  actionKeys?: IssueActionKey[];
  sessionExtras?: IssueActionSessionExtra[];
}) {
  const all = actionViews(enabledKeys, actionKeys);
  const byKey = new Map(all.map((view) => [view.action.key, view]));
  const primary = primaryKeys.map((key) => byKey.get(key)).filter((view): view is IssueActionView => !!view);

  render(
    <ContextMenuRoot>
      <ContextMenuTrigger>Open menu</ContextMenuTrigger>
      <GroupedIssueActionMenu actions={{ all, primary, phase }} sessionExtras={sessionExtras} />
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
      sessionExtras: [{ key: 'state', label: 'Open State Dir', onSelect: sessionExtra }],
    });

    expect(screen.getByText('Work running')).toBeInTheDocument();
    expect(screen.getByText(`4 available now · ${ISSUE_ACTIONS.length - 4} gated`)).toBeInTheDocument();
    expect(screen.getAllByText('Tell agent')).toHaveLength(2);
    expect(screen.getAllByText('Done — mark work complete & start review')).toHaveLength(2);

    const sectionLabels = [
      screen.getByText('For this phase'),
      ...GROUP_ORDER.filter((group) => group !== 'danger').map((group) => {
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
    expect(recoverRows[0]).toHaveFocus();
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
    expect(within(wrapper).getByRole('menuitem')).toHaveAttribute('data-disabled');

    fireEvent.click(within(wrapper).getByRole('menuitem'));
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
    expect(document.querySelector('[data-issue-action-section="planning"]')).toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="work"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="agent"]')).toBeInTheDocument();
    expect(screen.queryByText('This session')).not.toBeInTheDocument();
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
