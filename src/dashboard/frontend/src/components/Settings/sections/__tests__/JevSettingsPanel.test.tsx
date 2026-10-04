import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JevSettingsPanel } from '../JevSettingsPanel';
import type { JevSettingsView } from '../../types';

function settings(overrides: Partial<JevSettingsView> = {}): JevSettingsView {
  return {
    configured: true,
    route: 'zen',
    model: 'jev-1.13-free',
    timeoutMs: 2000,
    apiKeyRef: 'TYPESAFE_API_KEY',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<JevSettingsView> = {}, anyJevToggleOn = false, serverError: string | null = null) {
  const onSave = vi.fn();
  render(
    <JevSettingsPanel settings={settings(overrides)} anyJevToggleOn={anyJevToggleOn} serverError={serverError} onSave={onSave} />,
  );
  return onSave;
}

describe('JevSettingsPanel (PAN-4508)', () => {
  it('renders the current route, model and timeout', () => {
    renderPanel();
    expect((screen.getByTestId('jev-route-select') as HTMLSelectElement).value).toBe('zen');
    expect((screen.getByTestId('jev-model-input') as HTMLInputElement).value).toBe('jev-1.13-free');
    expect((screen.getByTestId('jev-timeout-input') as HTMLInputElement).value).toBe('2000');
  });

  it('saves a typed model with debounce', () => {
    const onSave = renderPanel();
    fireEvent.change(screen.getByTestId('jev-model-input'), { target: { value: 'jev-1.13' } });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ route: 'zen', model: 'jev-1.13', timeoutMs: 2000 }, { debounce: true });
  });

  it('saves a route change immediately, without debounce', () => {
    const onSave = renderPanel();
    fireEvent.change(screen.getByTestId('jev-route-select'), { target: { value: 'direct' } });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ route: 'direct', model: 'jev-1.13-free', timeoutMs: 2000 });
  });

  it('blocks a blank model while a Jev feature is on and does not save', () => {
    const onSave = renderPanel({}, true);
    fireEvent.change(screen.getByTestId('jev-model-input'), { target: { value: '' } });
    expect(screen.getByTestId('jev-settings-error')).toHaveTextContent('jev.model is required while a Jev feature is on');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('allows a blank model when no Jev feature is on', () => {
    const onSave = renderPanel({}, false);
    fireEvent.change(screen.getByTestId('jev-model-input'), { target: { value: '' } });
    expect(screen.queryByTestId('jev-settings-error')).toBeNull();
    expect(onSave).toHaveBeenCalledWith({ route: 'zen', model: '', timeoutMs: 2000 }, { debounce: true });
  });

  it.each([0, 30001])('rejects an out-of-range timeout %s and does not save', (timeoutMs) => {
    const onSave = renderPanel();
    fireEvent.change(screen.getByTestId('jev-timeout-input'), { target: { value: String(timeoutMs) } });
    expect(screen.getByTestId('jev-settings-error')).toHaveTextContent(
      'jev.timeout_ms must be an integer between 1 and 30000',
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a server error when there is no client-side problem', () => {
    renderPanel({}, false, 'route custom keeps an existing custom base_url; none is set');
    expect(screen.getByTestId('jev-settings-error')).toHaveTextContent(
      'route custom keeps an existing custom base_url; none is set',
    );
  });

  it('renders the custom route option only when the saved route is custom', () => {
    renderPanel({ route: 'custom', baseUrl: 'https://example.test/jev' });
    expect(screen.getByText('Custom: https://example.test/jev')).toBeTruthy();
  });

  it('omits the custom route option when the saved route is not custom', () => {
    renderPanel();
    expect(screen.queryByText(/^Custom:/)).toBeNull();
  });

  it('shows the key env fallback', () => {
    renderPanel({ apiKeyRef: 'MY_KEY' });
    expect(screen.getByText('Key env fallback: MY_KEY')).toBeTruthy();
  });
});
