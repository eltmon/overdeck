import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('./StartAgentCta', () => ({
  StartAgentCta: ({ density }: { density: IssueViewDensity }) => <span data-section="StartAgentCta">start {density}</span>,
}));

describe('IssueView', () => {
  it('keeps one view instance while rail expands through cockpit and console', () => {
    function Harness() {
      const [density, setDensity] = useState<IssueViewDensity>('rail');
      return <IssueView issueId="PAN-2499" density={density}><button onClick={() => setDensity('cockpit')}>expand</button><button onClick={() => setDensity('console')}>full screen</button><button onClick={() => setDensity('rail')}>collapse</button></IssueView>;
    }
    const { container } = render(<Harness />);
    const root = container.querySelector('[data-component="issue-view"]');
    expect(root).toHaveAttribute('data-density', 'rail');
    fireEvent.click(screen.getByRole('button', { name: 'expand' }));
    expect(root).toHaveAttribute('data-density', 'cockpit');
    fireEvent.click(screen.getByRole('button', { name: 'full screen' }));
    expect(root).toHaveAttribute('data-density', 'console');
    fireEvent.click(screen.getByRole('button', { name: 'collapse' }));
    expect(root).toHaveAttribute('data-density', 'rail');
  });
  it.each(['rail', 'cockpit', 'console'] as const)('renders the %s density boundary', (density) => {
    const { container } = render(<IssueView issueId="PAN-2499" density={density}><span>body</span></IssueView>);
    expect(container.querySelector('[data-component="issue-view"]')).toHaveAttribute('data-density', density);
    expect(container.querySelectorAll('span[hidden][data-section]')).toHaveLength(0);
  });

  it('forwards shell DOM attributes and handlers to the real boundary element', () => {
    const onClick = vi.fn();
    const { container } = render(<IssueView issueId="PAN-2499" density="rail" data-component="feature-item" data-issue-id="PAN-2499" onClick={onClick}><span>body</span></IssueView>);
    const root = container.querySelector('[data-component="feature-item"]');
    expect(root).toHaveAttribute('data-issue-id', 'PAN-2499');
    root?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('declares every no-loss inventory section at one or more densities', () => {
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
      expect(screen.getByText('policy PAN-2499').parentElement).toHaveAttribute(
        'data-section',
        density === 'console' ? 'IssuePolicyStrip / PoliciesControl' : 'ReviewPolicyControl',
      );
      view.unmount();
    }
  });
});
