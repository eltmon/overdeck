import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackerKeysSection } from './TrackerKeysSection';
import type { SettingsConfig } from '../types';

function renderSection(formData: Partial<SettingsConfig> = {}) {
  const onSettingsChange = vi.fn();
  render(<TrackerKeysSection formData={formData as SettingsConfig} onSettingsChange={onSettingsChange} />);
  return onSettingsChange;
}

describe('TrackerKeysSection Jira rows (PAN-5152)', () => {
  it('renders the Jira token, email and site URL rows', () => {
    renderSection();

    expect(screen.getByText('Jira API token')).toBeTruthy();
    expect(screen.getByText('Jira account email')).toBeTruthy();
    expect(screen.getByText('Jira site URL')).toBeTruthy();
    expect(screen.getByText('JIRA_BASE_URL')).toBeTruthy();
  });

  it('writes tracker_keys.jira_base_url from a plain text input', () => {
    const onSettingsChange = renderSection({ tracker_keys: { linear: 'kept' } });

    const site = screen.getByLabelText('Jira site URL') as HTMLInputElement;
    expect(site.type).toBe('text');
    fireEvent.change(site, { target: { value: 'https://acme.atlassian.net' } });

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ tracker_keys: { linear: 'kept', jira_base_url: 'https://acme.atlassian.net' } }),
      { debounce: true },
    );
  });

  it('keeps the email as text and the token as a password field', () => {
    renderSection();

    expect((screen.getByLabelText('Jira account email') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('Jira API token') as HTMLInputElement).type).toBe('password');
  });
});
