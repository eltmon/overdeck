import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TelemetrySection } from '../TelemetrySection';
import type { SettingsConfig } from '../../types';

function settings(
  enabled: boolean,
  effectiveEnabled = enabled,
  disabledBy?: NonNullable<SettingsConfig['telemetry']>['disabledBy'],
): SettingsConfig {
  return {
    models: {
      providers: {
        anthropic: true,
        openai: false,
        google: false,
        minimax: false,
        zai: false,
        kimi: false,
        mimo: false,
        openrouter: false,
        nous: false,
        dashscope: false,
      },
    },
    api_keys: {},
    telemetry: {
      enabled,
      effectiveEnabled,
      installId: '123e4567-e89b-42d3-a456-426614174000',
      ...(disabledBy ? { disabledBy } : {}),
    },
  };
}

describe('TelemetrySection', () => {
  it('toggles telemetry through the settings autosave callback', () => {
    const onSettingsChange = vi.fn();
    render(
      <TelemetrySection
        formData={settings(true)}
        saveStatus="idle"
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Share anonymous usage data' }));

    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].telemetry).toEqual({
      enabled: false,
      effectiveEnabled: false,
      installId: '123e4567-e89b-42d3-a456-426614174000',
    });
  });

  it('shows an environment-forced opt-out without changing the configured switch', () => {
    render(
      <TelemetrySection
        formData={settings(true, false)}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Share anonymous usage data' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('telemetry-status').textContent).toContain('Disabled by OVERDECK_TELEMETRY');
    expect(screen.getByTestId('telemetry-sent-list').className).toContain('opacity-45');
    expect(screen.getByText(/enabled: true/)).toBeTruthy();
  });

  // PAN-5084: the status line names the specific forced-off reason.
  it('shows "Disabled in CI" when disabledBy is ci', () => {
    render(
      <TelemetrySection
        formData={settings(true, false, 'ci')}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('telemetry-status').textContent).toContain('Disabled in CI');
  });

  it('shows "Disabled for a temporary Overdeck home" when disabledBy is temporary_home', () => {
    render(
      <TelemetrySection
        formData={settings(true, false, 'temporary_home')}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('telemetry-status').textContent).toContain('Disabled for a temporary Overdeck home');
  });

  it('falls back to "Disabled by OVERDECK_TELEMETRY" for disabledBy environment or missing', () => {
    render(
      <TelemetrySection
        formData={settings(true, false, 'environment')}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('telemetry-status').textContent).toContain('Disabled by OVERDECK_TELEMETRY');

    render(
      <TelemetrySection
        formData={settings(true, false)}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('telemetry-status').at(-1)?.textContent).toContain('Disabled by OVERDECK_TELEMETRY');
  });

  it('corrects the override footer to describe OVERDECK_TELEMETRY=1', () => {
    render(
      <TelemetrySection
        formData={settings(true)}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );

    const footer = screen.getByText(/Changes apply on the next dashboard load/).textContent ?? '';
    expect(footer).toContain('OVERDECK_TELEMETRY=1');
    expect(footer).not.toContain('can only force telemetry off');
  });

  it('renders disabled state, privacy details, and configuration equivalents', () => {
    render(
      <TelemetrySection
        formData={settings(false)}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Share anonymous usage data' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('telemetry-sent-list').className).toContain('opacity-45');
    expect(screen.getByTestId('telemetry-status').textContent).toContain('123e4567…4000');
    expect(screen.getByText('OVERDECK_TELEMETRY=0')).toBeTruthy();
    expect(screen.getByText(/Source code, prompts, conversation content/)).toBeTruthy();
    expect(screen.getByText(/Changes apply on the next dashboard load/)).toBeTruthy();
  });

  // PAN-4264: the opt-in operator grouping switch.
  it('shows operator grouping off by default and sends operatorGrouping: true when clicked', () => {
    const onSettingsChange = vi.fn();
    render(
      <TelemetrySection
        formData={settings(true)}
        saveStatus="idle"
        onSettingsChange={onSettingsChange}
      />,
    );

    const toggle = screen.getByTestId('telemetry-operator-grouping-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);

    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].telemetry).toMatchObject({ enabled: true, operatorGrouping: true });
  });

  it('disables operator grouping while telemetry is off', () => {
    render(
      <TelemetrySection
        formData={settings(false)}
        saveStatus="idle"
        onSettingsChange={vi.fn()}
      />,
    );
    expect((screen.getByTestId('telemetry-operator-grouping-toggle') as HTMLButtonElement).disabled).toBe(true);
  });
});
