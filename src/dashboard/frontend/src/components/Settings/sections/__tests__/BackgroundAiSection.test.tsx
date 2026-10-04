import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundAiSection } from '../BackgroundAiSection';
import type { JevSettingsView, SettingsConfig } from '../../types';

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

describe('BackgroundAiSection Jev toggle gating (PAN-4508)', () => {
  function jevSettings(model: JevSettingsView['model']): JevSettingsView {
    return { configured: true, route: 'zen', model, timeoutMs: 2000, apiKeyRef: 'TYPESAFE_API_KEY' };
  }

  // The switch itself defaults to "on" when background_ai.features omits the key, so these
  // cases set jevTurnEndAssessment: false explicitly to represent the off switch the ACs describe.
  function offSettings(): SettingsConfig {
    return { ...settings(), background_ai: { cheap_mode: false, features: { jevTurnEndAssessment: false } } };
  }

  it('blocks turning a Jev toggle on with no model and does not call onSettingsChange', () => {
    const onSettingsChange = vi.fn();
    render(
      <BackgroundAiSection
        chatModelOptionEls={<option value="claude-haiku-4-5">Haiku</option>}
        formData={offSettings()}
        onSettingsChange={onSettingsChange}
        jev={{ settings: jevSettings(undefined), serverError: null, onSave: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Toggle Jev: turn-end classification'));
    expect(screen.getByTestId('jev-toggle-error')).toHaveTextContent('Set a Jev model below before turning on a Jev feature.');
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('turns a Jev toggle on when a model is set', () => {
    const onSettingsChange = vi.fn();
    render(
      <BackgroundAiSection
        chatModelOptionEls={<option value="claude-haiku-4-5">Haiku</option>}
        formData={offSettings()}
        onSettingsChange={onSettingsChange}
        jev={{ settings: jevSettings('jev-1.13-free'), serverError: null, onSave: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Toggle Jev: turn-end classification'));
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].background_ai.features.jevTurnEndAssessment).toBe(true);
    expect(screen.queryByTestId('jev-toggle-error')).toBeNull();
  });

  it('never blocks turning a Jev toggle off, even with no model', () => {
    const onSettingsChange = vi.fn();
    render(
      <BackgroundAiSection
        chatModelOptionEls={<option value="claude-haiku-4-5">Haiku</option>}
        formData={{ ...settings(), background_ai: { cheap_mode: false, features: { jevTurnEndAssessment: true } } }}
        onSettingsChange={onSettingsChange}
        jev={{ settings: jevSettings(undefined), serverError: null, onSave: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Toggle Jev: turn-end classification'));
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].background_ai.features.jevTurnEndAssessment).toBe(false);
    expect(screen.queryByTestId('jev-toggle-error')).toBeNull();
  });

  it('does not block when the jev prop is absent', () => {
    const onSettingsChange = renderSection(settings());
    fireEvent.click(screen.getByLabelText('Toggle Jev: turn-end classification'));
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('jev-toggle-error')).toBeNull();
  });
});
