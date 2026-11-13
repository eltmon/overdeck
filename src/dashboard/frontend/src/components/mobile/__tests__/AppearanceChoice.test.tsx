import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AppearanceChoice } from '../AppearanceChoice';

describe('AppearanceChoice (PAN-5208)', () => {
  it('renders the radiogroup with the checked choice and calls onChange', () => {
    const onChange = vi.fn();
    render(<AppearanceChoice value="dark" onChange={onChange} note="Stored here." />);
    const group = screen.getByRole('radiogroup', { name: 'Appearance' });
    expect(group).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Dark/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /System/ }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));
    expect(onChange).toHaveBeenCalledWith('light');
    expect(screen.getByText('Stored here.')).toBeTruthy();
  });

  it('gives two instances distinct label ids', () => {
    render(
      <>
        <AppearanceChoice value="system" onChange={() => {}} note="One." />
        <AppearanceChoice value="light" onChange={() => {}} note="Two." />
      </>,
    );
    const groups = screen.getAllByRole('radiogroup');
    expect(groups).toHaveLength(2);
    const [first, second] = groups.map((group) => group.getAttribute('aria-labelledby'));
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
    for (const group of groups) {
      const heading = document.getElementById(group.getAttribute('aria-labelledby') ?? '');
      expect(heading?.textContent).toBe('Appearance');
      expect(heading?.parentElement?.contains(group)).toBe(true);
    }
  });
});
