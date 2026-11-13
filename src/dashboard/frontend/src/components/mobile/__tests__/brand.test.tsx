import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LogoWatermark, MobileEmptyState, MobileScreenHeader, OverdeckLockup } from '../brand';

describe('phone brand pieces (PAN-5208)', () => {
  it('LogoWatermark is hidden, takes no taps and is faint in both themes', () => {
    const { container } = render(<LogoWatermark />);
    const watermark = container.querySelector('[data-component="logo-watermark"]');
    expect(watermark).not.toBeNull();
    expect(watermark?.getAttribute('aria-hidden')).toBe('true');
    expect(watermark?.classList.contains('pointer-events-none')).toBe(true);
    expect(watermark?.classList.contains('absolute')).toBe(true);
    const svg = watermark?.querySelector('svg');
    expect(svg?.classList.contains('opacity-[0.05]')).toBe(true);
    expect(svg?.classList.contains('dark:opacity-[0.04]')).toBe(true);
  });

  it('OverdeckLockup renders the wordmark and the three mark circles', () => {
    const { container } = render(<OverdeckLockup className="h-6" />);
    expect(screen.getByText('Overdeck')).toBeTruthy();
    const radii = [...container.querySelectorAll('circle')].map((circle) => circle.getAttribute('r'));
    expect(radii).toEqual(['12.5', '4.5', '3.4']);
  });

  it('MobileEmptyState renders the title and the detail', () => {
    const { container } = render(<MobileEmptyState title="Nothing needs you." detail="Questions show up here." />);
    const empty = container.querySelector('[data-component="mobile-empty-state"]');
    expect(empty?.textContent).toContain('Nothing needs you.');
    expect(empty?.textContent).toContain('Questions show up here.');
  });

  it('MobileScreenHeader is a header with the safe-area top padding', () => {
    const { container } = render(<MobileScreenHeader title="Settings" trailing={<button type="button">Go</button>} />);
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header?.classList.contains('pt-[env(safe-area-inset-top)]')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
  });
});
