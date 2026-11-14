import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Phase, PhaseRailState, PhaseStepState } from '../../lib/simple/phases';
import { PipelineStripView, pipelineStepKind, type PipelineStepKind } from './IssuePipelineStrip';

const RAIL: PhaseRailState = {
  plan: 'done',
  work: 'current',
  review: 'pending',
  test: 'pending',
  ship: 'pending',
  done: 'pending',
};

function phaseButton(phase: Phase) {
  const button = screen.getByTestId('drawer-pipeline-strip').querySelector(`button[data-phase="${phase}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no button for ${phase}`);
  return button;
}

describe('pipelineStepKind', () => {
  it.each<[Phase, PhaseStepState, boolean, boolean, PipelineStepKind]>([
    ['work', 'current', true, true, 'paused'],
    ['work', 'current', true, false, 'live'],
    ['review', 'attention', false, false, 'attention'],
    ['plan', 'done', false, false, 'done'],
    ['done', 'current', false, false, 'done'],
    ['work', 'current', false, false, 'next'],
    ['test', 'pending', false, false, 'pending'],
  ])('pipelineStepKind follows the D-6 table: (%s, %s, live=%s, paused=%s) -> %s', (phase, state, live, paused, kind) => {
    expect(pipelineStepKind(phase, state, live, paused)).toBe(kind);
  });
});

describe('PipelineStripView', () => {
  it('renders six phase buttons in pipeline order with their labels', () => {
    render(<PipelineStripView rail={RAIL} />);
    const group = screen.getByRole('group', { name: 'Pipeline' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('data-phase'))).toEqual(['plan', 'work', 'review', 'test', 'ship', 'done']);
    expect(buttons.map((button) => button.textContent)).toEqual(['Plan', 'Work', 'Review', 'Test', 'Ship', 'Done']);
  });

  it('a live phase carries the pulse dot and data-kind="live"', () => {
    render(<PipelineStripView rail={RAIL} agents={{ work: { name: 'agent-pan-1', live: true, hasConversation: true } }} />);
    const work = phaseButton('work');
    expect(work).toHaveAttribute('data-kind', 'live');
    expect(within(work).getByTestId('pipeline-step-pulse')).toBeInTheDocument();
  });

  it('a phase with a live pane and no agent is live and disabled', () => {
    render(<PipelineStripView rail={RAIL} livePhases={new Set<Phase>(['review'])} />);
    const review = phaseButton('review');
    expect(review).toHaveAttribute('data-kind', 'live');
    expect(review).toBeDisabled();
    expect(review.title).toBe('Review is running');
  });

  it('a paused phase wins over live', () => {
    render(
      <PipelineStripView
        rail={RAIL}
        agents={{ work: { name: 'agent-pan-1', live: true, hasConversation: true } }}
        pausedPhases={new Set<Phase>(['work'])}
      />,
    );
    const work = phaseButton('work');
    expect(work).toHaveAttribute('data-kind', 'paused');
    expect(within(work).queryByTestId('pipeline-step-pulse')).toBeNull();
    expect(work.title).toContain('Work agent is paused');
  });

  it('a finished phase puts its date in the title', () => {
    render(<PipelineStripView rail={RAIL} meta={{ plan: '05/18' }} />);
    expect(phaseButton('plan').title).toContain('05/18');
  });

  it('a phase without an agent is disabled; a phase with one calls onSelectPhase', () => {
    const onSelectPhase = vi.fn();
    render(
      <PipelineStripView
        rail={RAIL}
        agents={{ work: { name: 'agent-pan-1', live: true, hasConversation: true } }}
        onSelectPhase={onSelectPhase}
      />,
    );
    expect(phaseButton('review')).toBeDisabled();
    expect(phaseButton('done')).toBeDisabled();
    const work = phaseButton('work');
    expect(work).toBeEnabled();
    expect(work.title).toContain('Open its conversation.');
    fireEvent.click(work);
    expect(onSelectPhase).toHaveBeenCalledWith('work');
  });

  it('the active phase is aria-pressed', () => {
    render(<PipelineStripView rail={RAIL} activePhase="work" />);
    expect(phaseButton('work')).toHaveAttribute('aria-pressed', 'true');
    expect(phaseButton('work')).toHaveClass('chip-selected');
    expect(phaseButton('plan')).toHaveAttribute('aria-pressed', 'false');
    expect(phaseButton('plan')).toHaveClass('border-transparent');
  });

  it('Review shows the reviewer count', () => {
    render(<PipelineStripView rail={RAIL} reviewCount={{ done: 2, total: 4 }} />);
    expect(within(phaseButton('review')).getByTestId('pipeline-review-count')).toHaveTextContent('2/4');
  });

  it('shows no count when reviewCount is null', () => {
    render(<PipelineStripView rail={RAIL} reviewCount={null} />);
    expect(screen.queryByTestId('pipeline-review-count')).toBeNull();
  });

  it('renders children in the right-hand cluster', () => {
    render(
      <PipelineStripView rail={RAIL}>
        <span data-testid="strip-child">checks</span>
      </PipelineStripView>,
    );
    const child = screen.getByTestId('strip-child');
    expect(child.parentElement).toHaveClass('ml-auto');
    expect(screen.getByRole('group', { name: 'Pipeline' })).not.toContainElement(child);
  });
});
