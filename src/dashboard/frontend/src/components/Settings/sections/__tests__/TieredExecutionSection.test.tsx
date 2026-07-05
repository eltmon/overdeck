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
    expect(screen.getAllByText("tiered_execution difficulty 'trivial' is not mapped to any tier").length).toBeGreaterThan(0);
    expect(screen.getByText('Invalid')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Enable tiered execution' }).getAttribute('aria-checked')).toBe('true');
  });

  it('adds, edits, and removes tiers through tiered_execution.tiers inputs', () => {
    const onSettingsChange = vi.fn();
    const formData = baseSettings({
      tiered_execution: {
        enabled: false,
        tiers: {},
        by_kind: {},
        replay_threshold: 0.5,
      },
    });
    const { rerender } = render(
      <TieredExecutionSection
        formData={formData}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add tier' }));
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers['tier-1']).toMatchObject({
      harness: 'claude-code',
      difficulties: [],
    });

    const withTier = onSettingsChange.mock.calls.at(-1)![0] as SettingsConfig;
    rerender(
      <TieredExecutionSection
        formData={withTier}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Tier name'), { target: { value: 'cheap' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers.cheap).toBeDefined();

    const renamed = onSettingsChange.mock.calls.at(-1)![0] as SettingsConfig;
    rerender(
      <TieredExecutionSection
        formData={renamed}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getAllByLabelText('Model')[0], { target: { value: 'claude-opus-4-8' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers.cheap.model).toBe('claude-opus-4-8');

    fireEvent.change(screen.getAllByLabelText('Harness')[0], { target: { value: 'codex' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers.cheap.harness).toBe('codex');

    fireEvent.click(screen.getAllByLabelText('trivial')[0]);
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers.cheap.difficulties).toContain('trivial');

    fireEvent.click(screen.getByRole('button', { name: 'Remove tier' }));
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers).toEqual({});
  });

  it('surfaces difficulty mapping errors near the tier table controls', () => {
    const onSettingsChange = vi.fn();

    render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: true,
            tiers: {
              cheap: {
                model: 'claude-haiku-4-5',
                harness: 'claude-code',
                difficulties: ['trivial'],
              },
            },
            by_kind: {},
            replay_threshold: 0.5,
          },
        })}
        saveStatus="error"
        saveErrorMessage="tiered_execution difficulty 'simple' is not mapped to any tier"
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getAllByText("tiered_execution difficulty 'simple' is not mapped to any tier").length).toBeGreaterThan(1);
    expect(screen.getAllByText('unmapped').length).toBeGreaterThan(0);
  });

  it('edits supervisor fields through onSettingsChange', () => {
    const onSettingsChange = vi.fn();
    render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: false,
            tiers: {},
            by_kind: {},
            supervisor: {
              model: 'claude-haiku-4-5',
              harness: 'claude-code',
              subscribe: 'flagged',
              owns_inspection: false,
            },
            replay_threshold: 0.5,
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-opus-4-8' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.model).toBe('claude-opus-4-8');

    fireEvent.change(screen.getByLabelText('Harness'), { target: { value: 'codex' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.harness).toBe('codex');

    fireEvent.change(screen.getByLabelText('Subscribe'), { target: { value: 'all' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.subscribe).toBe('all');

    fireEvent.click(screen.getByRole('switch', { name: 'Supervisor owns inspection' }));
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.owns_inspection).toBe(true);
  });

  it('edits by_kind mappings to configured tier names', () => {
    const onSettingsChange = vi.fn();
    render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: false,
            tiers: {
              cheap: {
                model: 'claude-haiku-4-5',
                harness: 'claude-code',
                difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
              },
            },
            by_kind: {},
            supervisor: { model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'flagged' },
            replay_threshold: 0.5,
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('backend'), { target: { value: 'cheap' } });

    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.by_kind.backend).toBe('cheap');
  });

  it('edits feed, escalation, and replay threshold values', () => {
    const onSettingsChange = vi.fn();
    render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: false,
            tiers: {},
            by_kind: {},
            feed: { callouts: 'off', exclude: [], exclude_subjects: [], max_diff_bytes: null },
            escalation: { enabled: false, retries_at_tier: 0, max_promotions: 0, flounder_budget_minutes: {} },
            replay_threshold: 0.5,
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Call-outs'), { target: { value: 'notify' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.feed.callouts).toBe('notify');

    fireEvent.change(screen.getByLabelText('Max diff bytes'), { target: { value: '4096' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.feed.max_diff_bytes).toBe(4096);
    expect(onSettingsChange.mock.calls.at(-1)?.[1]).toEqual({ debounce: true });

    fireEvent.click(screen.getByRole('switch', { name: 'Enable tier escalation' }));
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.escalation.enabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Retries at tier'), { target: { value: '2' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.escalation.retries_at_tier).toBe(2);

    fireEvent.change(screen.getByLabelText('Max promotions'), { target: { value: '1' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.escalation.max_promotions).toBe(1);

    fireEvent.change(screen.getByLabelText('Replay threshold'), { target: { value: '0.75' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.replay_threshold).toBe(0.75);
  });

  it('renders supervisor-required and replay-threshold validation errors inline', () => {
    const onSettingsChange = vi.fn();
    const { rerender } = render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: false,
            tiers: {
              cheap: {
                model: 'claude-haiku-4-5',
                harness: 'claude-code',
                difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
              },
            },
            by_kind: {},
            replay_threshold: 0.5,
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getAllByText('tiered_execution.supervisor is required when tiered execution tiers are configured').length).toBeGreaterThan(0);

    rerender(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: false,
            tiers: {},
            by_kind: {},
            replay_threshold: 2,
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getAllByText('tiered_execution.replay_threshold must be a number > 0 and <= 1').length).toBeGreaterThan(0);
  });
});
