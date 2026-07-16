import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ISSUE_VIEW_INVENTORY, type IssueViewDensity } from './inventory';
import { DENSITY_SECTIONS } from './densitySections';
import { IssueView } from './IssueView';

vi.mock('../ReviewPolicyControl', () => ({
  ReviewPolicyControl: ({ issueId }: { issueId: string }) => <span>policy {issueId}</span>,
}));

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useReviewStatusQuery: () => ({ data: undefined }),
}));

describe('IssueView', () => {
  it.each(['rail', 'cockpit', 'console'] as const)('renders the %s density from the declarative map', (density) => {
    const { container } = render(<IssueView issueId="PAN-2499" density={density}><span>body</span></IssueView>);
    expect(container.querySelector('[data-component="issue-view"]')).toHaveAttribute('data-density', density);
    const sections = new Set(Array.from(container.querySelectorAll('[data-section]'), (node) => node.getAttribute('data-section')));
    expect(DENSITY_SECTIONS[density].filter((section) => !sections.has(section))).toEqual([]);
  });

  it('renders every no-loss inventory section at one or more densities', () => {
    const densities: IssueViewDensity[] = ['rail', 'cockpit', 'console'];
    const rendered = new Set(densities.flatMap((density) => DENSITY_SECTIONS[density]));
    expect(ISSUE_VIEW_INVENTORY.filter((entry) => !rendered.has(entry.section))).toEqual([]);
  });

  it('keeps operator policy out of rail and exposes it at cockpit and console densities', () => {
    const rail = render(<IssueView issueId="PAN-2499" density="rail"><span /></IssueView>);
    expect(rail.container.querySelector('[data-section="ReviewPolicyControl"]')).not.toBeInTheDocument();
    rail.unmount();

    for (const density of ['cockpit', 'console'] as const) {
      const view = render(<IssueView issueId="PAN-2499" density={density}><span /></IssueView>);
      expect(screen.getByText('policy PAN-2499')).toBeInTheDocument();
      view.unmount();
    }
  });
});
