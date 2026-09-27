/** PAN-4197 WI-6 — the Agents page shell: Live by default, History behind one link. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveCounts } from './live/LiveAgentsView';

vi.mock('./directory/AgentsDirectory', () => ({
  AgentsDirectory: () => <div data-component="agents-directory">Agents Directory</div>,
}));

let liveCounts: LiveCounts = { live: 2, needsYou: 1, waiting: 0, idle: 14 };
vi.mock('./live/LiveAgentsView', () => ({
  LiveAgentsView: ({ onCountsChange, previewHidden }: { onCountsChange?: (counts: LiveCounts) => void; previewHidden?: boolean }) => {
    useEffect(() => onCountsChange?.(liveCounts), [onCountsChange]);
    return <div data-component="agents-live" data-preview-hidden={String(previewHidden)}>Live</div>;
  },
}));

import { FleetAgentsView } from './FleetAgentsView';

const view = () => new URLSearchParams(window.location.search).get('view');

function renderAt(path: string, props: Parameters<typeof FleetAgentsView>[0] = {}) {
  window.history.replaceState(null, '', path);
  return render(<FleetAgentsView {...props} />);
}

function expectNoRemovedViews() {
  for (const component of ['agent-card', 'agents-coming-soon', 'agents-filter-row']) {
    expect(document.querySelector(`[data-component="${component}"]`)).toBeNull();
  }
}

beforeEach(() => {
  window.history.replaceState(null, '', '/agents');
  liveCounts = { live: 2, needsYou: 1, waiting: 0, idle: 14 };
});

const metaPart = (key: string) => document.querySelector(`[data-component="agents-meta"] [data-meta-part="${key}"]`) as HTMLElement;

describe('FleetAgentsView', () => {
  it('renders the Live view by default with the section counts in the header', () => {
    renderAt('/agents');
    expect(document.querySelector('[data-component="agents-live"]')).not.toBeNull();
    expect(document.querySelector('[data-component="agents-directory"]')).toBeNull();
    expect(screen.getByText('Eltmon / Agents')).toBeInTheDocument();
    expect(metaPart('live')).toHaveTextContent('●2 live');
    expect(metaPart('needs-you')).toHaveTextContent('◐1 need you');
    expect(metaPart('waiting')).toHaveTextContent('○0 waiting');
    expect(document.querySelector('[data-component="agents-meta"]')).not.toHaveTextContent('idle');
    expectNoRemovedViews();
  });

  it('dims zero counts and makes a nonzero need-you the loud, clickable count', () => {
    renderAt('/agents');
    expect(metaPart('waiting')).toHaveClass('opacity-50');
    expect(metaPart('live')).not.toHaveClass('opacity-50');
    const needsYou = metaPart('needs-you');
    expect(needsYou.tagName).toBe('BUTTON');
    expect(needsYou).toHaveClass('text-state-needs-you', 'font-medium');
  });

  it('shows a quiet need-you count when nothing needs the operator', () => {
    liveCounts = { live: 1, needsYou: 0, waiting: 0, idle: 0 };
    renderAt('/agents');
    expect(metaPart('needs-you').tagName).toBe('SPAN');
    expect(metaPart('needs-you')).toHaveClass('opacity-50');
  });

  it('the header preview toggle collapses and restores the Live preview', () => {
    renderAt('/agents');
    const toggle = screen.getByTestId('agents-live-preview-toggle');
    expect(toggle).toHaveAttribute('aria-label', 'Hide preview');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-label', 'Show preview');
    expect(document.querySelector('[data-component="agents-live"]')).toHaveAttribute('data-preview-hidden', 'true');
    fireEvent.click(toggle);
    expect(document.querySelector('[data-component="agents-live"]')).toHaveAttribute('data-preview-hidden', 'false');
  });

  it.each(['/agents?view=history', '/agents?view=directory'])('renders History at %s', (path) => {
    renderAt(path);
    expect(document.querySelector('[data-component="agents-directory"]')).not.toBeNull();
    expect(document.querySelector('[data-component="agents-live"]')).toBeNull();
    expect(document.querySelector('[data-component="agents-meta"]')).toBeNull();
    expect(screen.queryByTestId('agents-live-preview-toggle')).toBeNull();
    expectNoRemovedViews();
  });

  it.each(['/agents?view=grid', '/agents?view=table', '/agents?view=timeline', '/agents?view=junk'])('renders Live at %s', (path) => {
    renderAt(path);
    expect(document.querySelector('[data-component="agents-live"]')).not.toBeNull();
    expectNoRemovedViews();
  });

  it('the History link sets view=history and the Live link removes it', () => {
    renderAt('/agents?entry=agent-pan-1');
    const link = screen.getByTestId('agents-view-link');
    expect(link).toHaveTextContent('History');
    expect(link).toHaveAttribute('href', '/agents?entry=agent-pan-1&view=history');
    fireEvent.click(link);
    expect(view()).toBe('history');
    expect(document.querySelector('[data-component="agents-directory"]')).not.toBeNull();

    const back = screen.getByTestId('agents-view-link');
    expect(back).toHaveTextContent('Live');
    fireEvent.click(back);
    expect(view()).toBeNull();
    expect(document.querySelector('[data-component="agents-live"]')).not.toBeNull();
  });

  it('follows browser back and forward between the views', () => {
    renderAt('/agents');
    act(() => {
      window.history.pushState(null, '', '/agents?view=history');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(document.querySelector('[data-component="agents-directory"]')).not.toBeNull();
  });

  it('calls onNavigateToIssues when Start agent is clicked', () => {
    const onNavigateToIssues = vi.fn();
    renderAt('/agents', { onNavigateToIssues });
    fireEvent.click(screen.getByRole('button', { name: /Start agent/ }));
    expect(onNavigateToIssues).toHaveBeenCalledTimes(1);
  });

  it('does not render Start agent when onNavigateToIssues is omitted', () => {
    renderAt('/agents');
    expect(screen.queryByRole('button', { name: /Start agent/ })).toBeNull();
  });
});
