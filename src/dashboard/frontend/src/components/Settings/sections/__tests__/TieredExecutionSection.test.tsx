import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TieredExecutionSection } from '../TieredExecutionSection';
import type { SettingsConfig } from '../../types';

function baseSettings(overrides: Partial<SettingsConfig> = {}): SettingsConfig {
  return {
    models: {
      providers: {
        anthropic: true,
        openai: false,
        google: false,
        zai: false,
        kimi: false,
        minimax: false,
        mimo: false,
        openrouter: false,
        nous: false,
        dashscope: false,
      },
      overrides: {},
    },
    api_keys: {},
    ...overrides,
  };
}

describe('TieredExecutionSection', () => {
  it('toggles tiered_execution.enabled through onSettingsChange', () => {
    const onSettingsChange = vi.fn();
    const formData = baseSettings({
      tiered_execution: {
        enabled: false,
        tiers: {},
        by_kind: {},
        replay_threshold: 0.5,
      },
    });

    render(
      <TieredExecutionSection
        formData={formData}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable tiered execution' }));

    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].tiered_execution.enabled).toBe(true);
    expect(onSettingsChange.mock.calls[0][1]).toBeUndefined();
  });

  it('renders server validation errors inline with a not-saved state', () => {
    const onSettingsChange = vi.fn();

    render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: true,
            tiers: {},
            by_kind: {},
            replay_threshold: 0.5,
          },
        })}
        saveStatus="error"
        saveErrorMessage="tiered_execution difficulty 'trivial' is not mapped to any tier"
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getByText('Not saved — fix errors')).toBeTruthy();
    expect(screen.getByText("tiered_execution difficulty 'trivial' is not mapped to any tier")).toBeTruthy();
    expect(screen.getByText('Invalid')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Enable tiered execution' }).getAttribute('aria-checked')).toBe('true');
  });
});
