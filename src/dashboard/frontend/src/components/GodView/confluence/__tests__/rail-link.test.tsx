import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfluenceData, ConfluenceOrb } from '../useConfluenceData';
import { GodViewConfluence } from '../GodViewConfluence';

vi.mock('../RiverCanvas', () => ({
  RiverCanvas: ({ onSelect, selectedId }: {
    onSelect?: (orb: ConfluenceOrb | null) => void;
    selectedId?: string | null;
  }) => (
    <div aria-label="Stubbed river canvas" data-selected-id={selectedId ?? ''}>
      <button type="button" onClick={() => onSelect?.({ id: 'PAN-3447' } as ConfluenceOrb)}>
        Orb hit
      </button>
      <button type="button" onClick={() => onSelect?.(null)}>
        Canvas miss
      </button>
    </div>
  ),
}));

vi.mock('../useConfluenceChoreography', () => ({
  useConfluenceChoreography: vi.fn(),
  useSweepChoreography: vi.fn(),
}));

vi.mock('../../Sidebar', () => ({
  GodViewSidebar: () => <aside aria-label="Stubbed sidebar" />,
}));

const data = {
  orbs: [{
    id: 'PAN-3447',
    project: 'overdeck',
    role: 'work',
    stage: 'WORK',
    title: 'God View Confluence',
    state: 'active',
    labels: [],
    staleMin: 0,
    yieldReason: null,
    warn: null,
    broken: false,
  } as unknown as ConfluenceOrb],
  hookStream: { entries: [], eventsPerMin: 0 },
  meta: { conversations: 0, mergeQ: 0, roleCounts: {} },
} as unknown as ConfluenceData;

function renderConfluence() {
  return render(
    <GodViewConfluence
      data={data}
      helpOpen={false}
      onHelpOpenChange={vi.fn()}
      onToggleFullscreen={vi.fn()}
    />,
  );
}

describe('Confluence issue drawer link', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/god-view');
  });

  it('opens the in-canvas issue rail for a picked orb without leaving the god view', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    renderConfluence();

    fireEvent.click(screen.getByRole('button', { name: 'Orb hit' }));

    expect(screen.getByLabelText('Issue rail for PAN-3447')).toBeInTheDocument();
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/god-view');
  });

  it('navigates to the real issue page only via the rail action button', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    renderConfluence();

    fireEvent.click(screen.getByRole('button', { name: 'Orb hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open issue page →' }));

    expect(pushState).toHaveBeenCalledWith({}, '', '/issues/PAN-3447');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(PopStateEvent));
  });

  it('closes the rail on canvas miss and on Escape', () => {
    renderConfluence();

    fireEvent.click(screen.getByRole('button', { name: 'Orb hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Canvas miss' }));
    expect(screen.queryByLabelText('Issue rail for PAN-3447')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Orb hit' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Issue rail for PAN-3447')).not.toBeInTheDocument();
  });

  it('drives the selection ring from the open rail', () => {
    renderConfluence();

    fireEvent.click(screen.getByRole('button', { name: 'Orb hit' }));

    expect(screen.getByLabelText('Stubbed river canvas')).toHaveAttribute('data-selected-id', 'PAN-3447');
  });

  it('drives the selected ring from the current issue route', () => {
    window.history.replaceState({}, '', '/issues/PAN-3447');
    renderConfluence();

    expect(screen.getByLabelText('Stubbed river canvas')).toHaveAttribute('data-selected-id', 'PAN-3447');
  });

  it('publishes the production orb set for debugging and cleans it up on unmount', () => {
    const { unmount } = renderConfluence();

    expect(window.__orbs).toBe(data.orbs);
    unmount();
    expect(window.__orbs).toBeUndefined();
  });

  it('contains no preview issue rail', () => {
    renderConfluence();
    expect(document.querySelector('.confluence-issue-rail')).toBeNull();
  });
});
