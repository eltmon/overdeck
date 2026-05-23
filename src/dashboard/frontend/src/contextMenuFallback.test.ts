import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showContextMenu } from './contextMenuFallback';

describe('showContextMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders menu items and dismisses after selecting an item', async () => {
    const onClick = vi.fn();

    showContextMenu({
      items: [{ label: 'Open', onClick }],
      x: 12,
      y: 24,
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('dismisses on outside click', async () => {
    showContextMenu({
      items: [{ label: 'Copy', onClick: vi.fn() }],
      x: 10,
      y: 10,
    });

    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('dismisses on Escape', async () => {
    showContextMenu({
      items: [{ label: 'Copy full path', onClick: vi.fn() }],
      x: 10,
      y: 10,
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('auto-positions inside the viewport near right and bottom edges', async () => {
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);

    showContextMenu({
      items: [{ label: 'Open', onClick: vi.fn() }],
      x: 790,
      y: 590,
    });

    await waitFor(() => {
      expect(screen.getByRole('menu')).toHaveStyle({ left: '596px', top: '496px' });
    });
  });
});
