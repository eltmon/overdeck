import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundAiSection } from '../BackgroundAiSection';
import type { SettingsConfig } from '../../types';

function settings(typesafe?: string): SettingsConfig {
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
    api_keys: typesafe === undefined ? {} : { typesafe },
    background_ai: { cheap_mode: false, features: {} },
  };
}

function renderSection(formData: SettingsConfig, onSettingsChange = vi.fn()) {
  render(
    <BackgroundAiSection
      chatModelOptionEls={<option value="claude-haiku-4-5">Haiku</option>}
      formData={formData}
      onSettingsChange={onSettingsChange}
    />,
  );
  return onSettingsChange;
}

describe('BackgroundAiSection TypeSafe key (PAN-4369)', () => {
  it('shows the saved key in a password input', () => {
    renderSection(settings('abc'));
    const input = screen.getByLabelText('TypeSafe API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('abc');
  });

  it('writes a typed key to api_keys.typesafe with a debounced save', () => {
    const onSettingsChange = renderSection(settings());
    fireEvent.change(screen.getByLabelText('TypeSafe API key'), { target: { value: 'xyz' } });
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].api_keys.typesafe).toBe('xyz');
    expect(onSettingsChange.mock.calls[0][1]).toEqual({ debounce: true });
  });

  it('renders the three Jev toggles', () => {
    renderSection(settings());
    expect(screen.getByText('Jev: turn-end classification')).toBeTruthy();
    expect(screen.getByText('Jev: acceptance-criteria review')).toBeTruthy();
    expect(screen.getByText('Jev: memory relevance filter')).toBeTruthy();
  });
});

describe('BackgroundAiSection Jev settings panel (PAN-4508)', () => {
  it('renders no JevSettingsPanel when the jev prop is absent', () => {
    renderSection(settings());
    expect(screen.queryByTestId('jev-settings-panel')).toBeNull();
  });

  it('renders JevSettingsPanel when jev.settings is provided', () => {
    render(
      <BackgroundAiSection
        chatModelOptionEls={<option value="claude-haiku-4-5">Haiku</option>}
        formData={settings()}
        onSettingsChange={vi.fn()}
        jev={{
          settings: { configured: true, route: 'zen', model: 'jev-1.13-free', timeoutMs: 2000, apiKeyRef: 'TYPESAFE_API_KEY' },
          serverError: null,
          onSave: vi.fn(),
        }}
      />,
    );
    expect(screen.getByTestId('jev-settings-panel')).toBeTruthy();
  });
});
