import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfluenceOrb } from '../useConfluenceData';
import { GodViewConfluence } from '../GodViewConfluence';

vi.mock('../RiverCanvas', () => ({
  RiverCanvas: ({ onSelect }: {
    onSelect?: (orb: ConfluenceOrb | null) => void;
  }) => (
    <div aria-label="Stubbed river canvas">
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
}));

vi.mock('../useConfluenceData', async (importOriginal) => {
  const original = await importOriginal<typeof import('../useConfluenceData')>();
  return {
    ...original,
    useConfluenceData: () => ({
      orbs: [],
      hookStream: { entries: [], eventsPerMin: 0 },
      meta: { conversations: 0, mergeQ: 0, roleCounts: {} },
    }),
  };
});

vi.mock('../../Sidebar', () => ({
  GodViewSidebar: () => <aside aria-label="Stubbed sidebar" />,
}));

describe('Confluence issue drawer link', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/god-view');
  });

  it('navigates a picked orb to the real issue drawer route', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    render(<GodViewConfluence />);

    fireEvent.click(screen.getByRole('button', { name: 'Orb hit' }));

    expect(pushState).toHaveBeenCalledWith({}, '', '/issues/PAN-3447');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(PopStateEvent));
  });

  it('does not navigate when canvas picking misses', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    render(<GodViewConfluence />);

    fireEvent.click(screen.getByRole('button', { name: 'Canvas miss' }));

    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/god-view');
  });

  it('contains no preview issue rail', () => {
    render(<GodViewConfluence />);
    expect(document.querySelector('.confluence-issue-rail')).toBeNull();
  });
});
