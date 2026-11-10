import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HarnessesSection } from '../HarnessesSection';
import type { SettingsConfig } from '../../types';

function settings(harnesses?: SettingsConfig['harnesses']): SettingsConfig {
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
    ...(harnesses ? { harnesses } : {}),
  };
}

describe('HarnessesSection (PAN-5108)', () => {
  it('shows the switch on when the harnesses block is absent', () => {
    render(<HarnessesSection formData={settings()} onSettingsChange={vi.fn()} />);

    expect(screen.getByText('Keep coding-agent CLIs up to date automatically')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the switch off when auto_update is false', () => {
    render(<HarnessesSection formData={settings({ auto_update: false })} onSettingsChange={vi.fn()} />);

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('saves auto_update: false through the settings autosave callback', () => {
    const onSettingsChange = vi.fn();
    render(<HarnessesSection formData={settings()} onSettingsChange={onSettingsChange} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].harnesses).toEqual({ auto_update: false });
  });
});
