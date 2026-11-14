import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FlywheelLaneBoard } from '../FlywheelLaneBoard';
import { NOW, boardStatus } from './fixtures';

describe('FlywheelLaneBoard (PAN-5283 FR-7)', () => {
  it('renders seven lanes in pipeline order', () => {
    render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    const lanes = screen.getAllByRole('region').map((lane) => lane.getAttribute('data-testid'));
    expect(lanes).toEqual([
      'flywheel-lane-plan', 'flywheel-lane-build', 'flywheel-lane-checks', 'flywheel-lane-review',
      'flywheel-lane-merge', 'flywheel-lane-deploy', 'flywheel-lane-done',
    ]);
    expect(within(screen.getByTestId('flywheel-lane-done')).getByRole('heading')).toHaveTextContent('Done today · 1');
  });

  it('places each row in its stage lane', () => {
    render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    expect(within(screen.getByTestId('flywheel-lane-build')).getAllByTestId(/^flywheel-card-PAN-\d+$/).map((card) => card.dataset.testid))
      .toEqual(['flywheel-card-PAN-5276', 'flywheel-card-PAN-5095']);
    expect(within(screen.getByTestId('flywheel-lane-checks')).getByTestId('flywheel-card-PAN-5275')).toHaveAttribute('data-stage', 'checks');
    expect(within(screen.getByTestId('flywheel-lane-review')).getByTestId('flywheel-card-PAN-5278')).toBeInTheDocument();
    expect(within(screen.getByTestId('flywheel-lane-merge')).getByTestId('flywheel-card-PAN-5281')).toBeInTheDocument();
    expect(within(screen.getByTestId('flywheel-lane-plan')).getByTestId('flywheel-card-PAN-5290')).toBeInTheDocument();
    expect(within(screen.getByTestId('flywheel-lane-build')).getByRole('heading')).toHaveTextContent('Build · 2');
  });

  it('a row without board fields falls back to its state lane and shows no agent', () => {
    const status = boardStatus({ inFlight: [{ issueId: 'PAN-1', title: 'Old', state: 'in-review', liveAgents: 0, inTick: false, lastJournal: null }] });
    render(<FlywheelLaneBoard status={status} nowMs={NOW} />);
    expect(within(screen.getByTestId('flywheel-lane-review')).getByTestId('flywheel-card-PAN-1')).toBeInTheDocument();
    expect(screen.getByTestId('flywheel-agentline-PAN-1')).toHaveTextContent('no agent');
  });

  it('card shows the blocker text and never the raw journal type', () => {
    const { container } = render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-blocker-PAN-5095')).toHaveTextContent('test-skip gate failed: needs your test-removal waiver');
    expect(screen.getByTestId('flywheel-blocker-PAN-5095')).toHaveAttribute('data-severity', 'needs-you');
    expect(screen.getByTestId('flywheel-card-PAN-5095')).toHaveTextContent('last: checks failed');
    expect(container.textContent).not.toContain('verification.failed');
    const exact = Array.from(container.querySelectorAll('*')).filter((el) => el.textContent?.trim() === 'verification.failed');
    expect(exact).toHaveLength(0);
  });

  it('a gate-queued row shows its blocker and no "no agent" text', () => {
    render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    const card = screen.getByTestId('flywheel-card-PAN-5275');
    expect(screen.getByTestId('flywheel-blocker-PAN-5275')).toHaveTextContent('typecheck queued: 11.5 GB free, needs 2.2 GB, gates keep 12.0 GB (20 min)');
    expect(card).not.toHaveTextContent('no agent');
    expect(screen.getByTestId('flywheel-agentline-PAN-5275')).toHaveTextContent('work · claude-sonnet-5 · waiting');
  });

  it('a handoff agent shows role handoff and the conversation name', () => {
    render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-agentline-PAN-5276')).toHaveTextContent('handoff 20261114-d9c5 · claude-opus-5-5 · working');
    expect(screen.getByTestId('flywheel-owner-PAN-5276')).toHaveTextContent('conv 20261114-d9c5');
    expect(screen.getByTestId('flywheel-owner-PAN-5276')).toHaveAttribute('title', 'Handoff for PAN-5276');
  });

  it('shows time in stage, cost and the full title with a two-line clamp', () => {
    render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-since-PAN-5276')).toHaveTextContent('42m in stage');
    expect(screen.getByTestId('flywheel-cost-PAN-5095')).toHaveTextContent('$7.84');
    expect(screen.queryByTestId('flywheel-cost-PAN-5281')).toBeNull();
    const title = screen.getByTestId('flywheel-title-PAN-5276');
    expect(title).toHaveClass('line-clamp-2');
    expect(title).toHaveAttribute('title', 'Add the shipped-today timeline to the Flywheel page');
  });

  it('deploy and done lanes come from shipped merges', () => {
    render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    const deploy = within(screen.getByTestId('flywheel-lane-deploy')).getByTestId('flywheel-shipped-card-aaaaaaaa');
    expect(deploy).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/pull/5273');
    expect(deploy).toHaveTextContent('PAN-5246');
    expect(within(screen.getByTestId('flywheel-lane-done')).getByTestId('flywheel-shipped-card-cccccccc')).toHaveTextContent('Fast-forwarded batch heads');
  });

  it('clicking a card navigates to the issue', () => {
    const onNavigateIssue = vi.fn();
    render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} onNavigateIssue={onNavigateIssue} />);
    fireEvent.click(screen.getByTestId('flywheel-blocker-PAN-5095'));
    expect(onNavigateIssue).toHaveBeenCalledTimes(1);
    expect(onNavigateIssue).toHaveBeenCalledWith('PAN-5095');
  });

  it('no button-role element contains another button or link', () => {
    const { container } = render(<FlywheelLaneBoard status={boardStatus()} nowMs={NOW} />);
    for (const button of Array.from(container.querySelectorAll('button, [role="button"]'))) {
      expect(button.querySelector('button, a, [role="button"], input, select, textarea')).toBeNull();
    }
  });
});
