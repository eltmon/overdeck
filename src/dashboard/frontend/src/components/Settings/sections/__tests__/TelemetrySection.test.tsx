import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TelemetrySection } from '../TelemetrySection';
import type { SettingsConfig } from '../../types';

function settings(enabled: boolean): SettingsConfig {
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
      installId: '123e4567-e89b-42d3-a456-426614174000',
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
      installId: '123e4567-e89b-42d3-a456-426614174000',
    });
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
});
