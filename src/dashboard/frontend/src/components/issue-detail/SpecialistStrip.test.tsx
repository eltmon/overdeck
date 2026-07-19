/**
 * PAN-2908 · C-DETAIL — SpecialistStrip + deriveSpecialists tests.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionNode } from '@overdeck/contracts';
import { SpecialistStrip, type SpecialistChip } from './SpecialistStrip';
import { deriveSpecialistChips, REVIEW_SPECIALIST_ROLES } from './deriveSpecialists';

const reviewer = (role: string, overrides: Partial<SessionNode> = {}): SessionNode => ({
  type: 'reviewer',
  role,
  sessionId: `agent-pan-1-review-${role}`,
  model: 'sonnet-5',
  status: 'running',
  presence: 'active',
  startedAt: '2026-07-19T00:00:00Z',
  ...overrides,
} as SessionNode);

describe('deriveSpecialistChips', () => {
  it('emits the four canonical roles in order, session verdicts winning', () => {
    const chips = deriveSpecialistChips(
      [
        reviewer('correctness', { presence: 'active' }),
        reviewer('security', { presence: 'ended', status: 'stopped', roundMetadata: { roundCount: 1, latestRound: 1, latestReviewResult: 'APPROVED', history: [] } }),
      ],
      { reviewSubStatuses: { performance: 'done' } },
    );
    expect(chips.map((c) => c.id)).toEqual([...REVIEW_SPECIALIST_ROLES]);
    const [security, correctness, performance, requirements] = chips;
    expect(security.verdict).toBe('APPROVED');
    expect(security.lastLine).toContain('approved');
    expect(correctness.status).toBe('running');
    expect(correctness.hasConversation).toBe(true);
    expect(performance.status).toBe('done'); // from reviewSubStatuses
    expect(performance.hasConversation).toBe(false);
    expect(requirements.status).toBe('queued');
  });

  it('marks failed reviewer sessions', () => {
    const chips = deriveSpecialistChips([
      reviewer('security', { status: 'error', presence: 'ended', roundMetadata: { roundCount: 1, latestRound: 1, latestStatus: 'failed', latestReviewResult: 'CHANGES_REQUESTED', history: [] } }),
    ], null);
    expect(chips[0].status).toBe('failed');
    expect(chips[0].verdict).toBe('CHANGES_REQUESTED');
  });

  it('a completed convoy with no per-role data shows done/verdict, never phantom queued', () => {
    const passed = deriveSpecialistChips([], { reviewStatus: 'passed' });
    expect(passed.every((c) => c.status === 'done' && c.verdict === 'APPROVED')).toBe(true);
    const blocked = deriveSpecialistChips([], { reviewStatus: 'blocked' });
    expect(blocked.every((c) => c.status === 'failed' && c.verdict === 'CHANGES_REQUESTED')).toBe(true);
    const reviewing = deriveSpecialistChips([], { reviewStatus: 'reviewing' });
    expect(reviewing.every((c) => c.status === 'queued')).toBe(true);
  });
});

describe('SpecialistStrip', () => {
  const chips: SpecialistChip[] = [
    { id: 'security', name: 'review.security', status: 'done', verdict: 'APPROVED', lastLine: 'approved · round 1', hasConversation: true },
    { id: 'correctness', name: 'review.correctness', status: 'running', lastLine: 'reviewing now…', hasConversation: true },
    { id: 'requirements', name: 'review.requirements', status: 'queued', lastLine: 'starts when the convoy slot frees', hasConversation: false },
  ];

  it('renders chips with verdict badges and status dots', () => {
    render(<SpecialistStrip specialists={chips} />);
    expect(screen.getByText('review.security')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('fires onSelect for conversation-backed chips, never for queued', () => {
    const onSelect = vi.fn();
    const { container } = render(<SpecialistStrip specialists={chips} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('[data-specialist="security"]')!);
    expect(onSelect).toHaveBeenCalledWith(chips[0]);
    expect((container.querySelector('[data-specialist="requirements"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('highlights the active chip', () => {
    const { container } = render(<SpecialistStrip specialists={chips} activeId="correctness" onSelect={() => {}} />);
    expect(container.querySelector('[data-specialist="correctness"]')?.className).toContain('border-primary/45');
  });
});
