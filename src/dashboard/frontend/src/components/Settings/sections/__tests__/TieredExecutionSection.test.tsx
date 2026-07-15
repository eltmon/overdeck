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
    expect(screen.getByText(/^Invalid — tiered_execution difficulty/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Enable tiered execution' }).getAttribute('aria-checked')).toBe('true');
  });

  it('renders five required difficulty columns with the binding subtitles and reassigns one crew', () => {
    const onSettingsChange = vi.fn();
    const formData = baseSettings({
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
          capable: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'] },
        },
        by_kind: {},
        supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
        replay_threshold: 0.5,
      },
    });
    render(
      <TieredExecutionSection
        formData={formData}
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getAllByLabelText(/^crew for /)).toHaveLength(5);
    for (const subtitle of ['typo-level fixes', 'small scoped edits', 'typical tasks', 'multi-file work', 'judgment calls']) {
      expect(screen.getByText(subtitle)).toBeTruthy();
    }
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getAllByLabelText(/^crew for /).every((select) => select.hasAttribute('required'))).toBe(true);

    fireEvent.change(screen.getByLabelText('crew for medium'), { target: { value: 'cheap' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers['trivial-simple-medium'].difficulties)
      .toEqual(['trivial', 'simple', 'medium']);
  });

  it('creates a Haiku crew from the board, assigns every difficulty, and opens it', () => {
    const onSettingsChange = vi.fn();
    const { rerender } = render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: false,
            tiers: {},
            by_kind: {},
            replay_threshold: 0.5,
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('crew for trivial'), { target: { value: 'new' } });
    const next = onSettingsChange.mock.calls.at(-1)?.[0] as SettingsConfig;
    expect(next.tiered_execution?.tiers['trivial-simple-medium-complex-expert']).toMatchObject({
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
    });
    rerender(
      <TieredExecutionSection
        formData={next}
        onSettingsChange={onSettingsChange}
      />,
    );
    expect(screen.getAllByLabelText('Model')[0].closest('details')).toHaveAttribute('open');
  });

  it('warns on a provider harness mismatch and auto writes the provider default', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({
      models: { ...baseSettings().models, providers: { ...baseSettings().models.providers, kimi: true } },
      tiered_execution: {
        enabled: true,
        tiers: { all: { model: 'kimi-k2.7-code', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
        supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
        by_kind: {}, replay_threshold: 0.5,
      },
    })} onSettingsChange={onSettingsChange} />);

    const warning = screen.getByText('⚠ harness overrides provider default — PAN-1865');
    fireEvent.click(warning.closest('summary')!);
    fireEvent.change(screen.getAllByLabelText('Harness')[0], { target: { value: 'auto' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.tiers['trivial-simple-medium-complex-expert'].harness).toBe('ohmypi');
  });

  it('blocks removal while a crew owns difficulties and surfaces invalid mix totals', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: { all: {
        model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
        distribution: [
          { model: 'claude-sonnet-5', harness: 'claude-code', weight: 70 },
          { model: 'gpt-5.6-terra', harness: 'codex', weight: 20 },
        ],
      } },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: {}, replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    expect(screen.getByText(/Invalid — .*weights must total exactly 100/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('2-model mix').find((element) => element.closest('summary'))!.closest('summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove crew' }));
    expect(screen.getByText('Assign these difficulties to another crew before removing it.')).toBeTruthy();
    expect(onSettingsChange).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole('button', { name: /Standing reviewer/ }));

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-opus-4-8' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.model).toBe('claude-opus-4-8');

    fireEvent.change(screen.getByLabelText('Harness'), { target: { value: 'codex' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.harness).toBe('codex');

    fireEvent.change(screen.getByLabelText('Subscribe'), { target: { value: 'all' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.subscribe).toBe('all');

    fireEvent.click(screen.getByRole('switch', { name: 'Supervisor owns inspection' }));
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor.owns_inspection).toBe(true);
  });

  it('adds and removes overrides while the default stays quiet', () => {
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

    expect(screen.getByText('All kinds follow difficulty routing.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Kind to override'), { target: { value: 'backend' } });
    fireEvent.change(screen.getByLabelText('Crew for kind override'), { target: { value: 'cheap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.by_kind.backend).toBe('trivial-simple-medium-complex-expert');
  });

  it('prefers editable by_kind over stale derived byKind values', () => {
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
                difficulties: ['trivial', 'simple'],
              },
              expensive: {
                model: 'claude-opus-4-8',
                harness: 'claude-code',
                difficulties: ['medium', 'complex', 'expert'],
              },
            },
            by_kind: { backend: 'cheap' },
            byKind: { backend: 'expensive' },
            supervisor: { model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'flagged' },
            replay_threshold: 0.5,
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getByText('backend → Claude Haiku 4.5')).toBeTruthy();
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

// 2026-07-05 incident guard: new-tier and supervisor DEFAULTS silently
// pre-populated with the most premium catalog entry (Fable 5) and burned the
// operator's Anthropic plan. Frontier models must never be an unchosen default.
describe('frontier models are never the default', () => {
  it('DEFAULT_MODEL and DEFAULT_SUPERVISOR_MODEL are not fable/opus', async () => {
    const mod = await import('../TieredExecutionSection');
    expect(mod.DEFAULT_MODEL).not.toMatch(/fable|opus/i);
    expect(mod.DEFAULT_SUPERVISOR_MODEL).not.toMatch(/fable|opus/i);
  });
});
