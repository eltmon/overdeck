import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { DeckEmptyState } from '../DeckEmptyState';

describe('DeckEmptyState', () => {
  it('Start without a project selects the no-project deck', () => {
    const onStartWithoutProject = vi.fn();
    render(<DeckEmptyState onStartWithoutProject={onStartWithoutProject} />);

    expect(screen.getByText('Select a project to open its deck')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start without a project' }));
    expect(onStartWithoutProject).toHaveBeenCalledTimes(1);
  });
});
