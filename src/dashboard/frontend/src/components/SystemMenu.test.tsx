import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SystemMenu } from './SystemMenu';

// The menu just hosts CloisterStatusBar — mock it so we test the dropdown shell.
vi.mock('./CloisterStatusBar', () => ({
  CloisterStatusBar: () => <div data-testid="cloister-controls" />,
}));

describe('SystemMenu', () => {
  it('is collapsed by default and opens on click', () => {
    render(<SystemMenu />);
    expect(screen.queryByTestId('cloister-controls')).toBeNull();
    fireEvent.click(screen.getByLabelText('System controls'));
    expect(screen.getByTestId('cloister-controls')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<SystemMenu />);
    fireEvent.click(screen.getByLabelText('System controls'));
    expect(screen.getByTestId('cloister-controls')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('cloister-controls')).toBeNull();
  });

  it('toggles closed on a second trigger click', () => {
    render(<SystemMenu />);
    const trigger = screen.getByLabelText('System controls');
    fireEvent.click(trigger);
    expect(screen.getByTestId('cloister-controls')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByTestId('cloister-controls')).toBeNull();
  });
});
