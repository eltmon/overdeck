import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PaneTabMenu } from '../PaneTabMenu';

describe('PaneTabMenu scroll dismissal', () => {
  it('stays open when the menu itself scrolls, and closes when the page scrolls', () => {
    const onClose = vi.fn();
    render(
      <PaneTabMenu
        position={{ top: 10, left: 10 }}
        onClose={onClose}
        onOpenInSplit={() => {}}
        onSplitDown={() => {}}
        onCloseAll={() => {}}
      />,
    );

    fireEvent.scroll(screen.getByRole('menu'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
