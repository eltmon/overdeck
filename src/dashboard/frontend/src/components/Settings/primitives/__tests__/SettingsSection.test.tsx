/**
 * PAN-5000: the Anywhere section's description was cut off next to its
 * actions at narrow widths. The header row wraps instead of truncating.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsSection } from '../SettingsSection';

describe('SettingsSection header wrap (PAN-5000)', () => {
  it('renders the full description text next to an action instead of cutting it off', () => {
    render(
      <SettingsSection id="anywhere" title="Anywhere" description="Reach this machine from your other devices" actions={<button type="button">Set up</button>}>
        <div>Content</div>
      </SettingsSection>
    );
    expect(screen.getByText('— Reach this machine from your other devices')).toBeInTheDocument();
  });

  it('does not truncate the description, and lets the header row wrap', () => {
    render(
      <SettingsSection id="anywhere" title="Anywhere" description="Reach this machine from your other devices" actions={<button type="button">Set up</button>}>
        <div>Content</div>
      </SettingsSection>
    );
    const description = screen.getByText('— Reach this machine from your other devices');
    expect(description.className).not.toContain('truncate');
    const headerRow = description.parentElement?.parentElement;
    expect(headerRow?.className).toContain('flex-wrap');
  });
});
