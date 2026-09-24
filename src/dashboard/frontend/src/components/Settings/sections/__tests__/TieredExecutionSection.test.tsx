import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('creates and expands a Haiku crew from the roster difficulty prompt', () => {
    const onSettingsChange = vi.fn();
    const formData = baseSettings({
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
          capable: { model: 'gpt-5.6-terra', harness: 'codex', difficulties: ['medium', 'complex', 'expert'] },
        },
        by_kind: {},
        supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
        replay_threshold: 0.5,
      },
    });
    const { rerender } = render(
      <TieredExecutionSection
        formData={formData}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Add crew' }));
    expect(screen.getByText('The new crew starts on Haiku 4.5. Which difficulty does it take over?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assign medium to new crew' }));

    const next = onSettingsChange.mock.calls.at(-1)?.[0] as SettingsConfig;
    expect(next.tiered_execution?.tiers.medium).toMatchObject({
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      difficulties: ['medium'],
    });
    rerender(
      <TieredExecutionSection
        formData={next}
        onSettingsChange={onSettingsChange}
      />,
    );
    expect(screen.getAllByLabelText('Model').at(-1)?.closest('details')).toHaveAttribute('open');
  });

  it('keeps a new default Haiku crew distinct from an existing Haiku crew after rerender', () => {
    const onSettingsChange = vi.fn();
    const formData = baseSettings({
      tiered_execution: {
        enabled: true,
        tiers: {
          all: {
            model: 'claude-haiku-4-5',
            harness: 'claude-code',
            difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
          },
        },
        by_kind: {},
        supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
        replay_threshold: 0.5,
      },
    });
    const { rerender } = render(
      <TieredExecutionSection
        formData={formData}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Add crew' }));
    expect(screen.getAllByText('now Claude Haiku 4.5 (200K context)')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Assign medium to new crew' }));

    const next = onSettingsChange.mock.calls.at(-1)?.[0] as SettingsConfig;
    expect(next.tiered_execution?.tiers.medium).toMatchObject({
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      difficulties: ['medium'],
    });
    rerender(
      <TieredExecutionSection
        formData={next}
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getAllByText('edit')).toHaveLength(2);
    const trivialCrew = screen.getByLabelText('crew for trivial') as HTMLSelectElement;
    const mediumCrew = screen.getByLabelText('crew for medium') as HTMLSelectElement;
    expect(mediumCrew.value).not.toBe(trivialCrew.value);
    expect(screen.getAllByText('edit')[1].closest('details')).toHaveAttribute('open');
  });

  it('creates the first crew from the empty roster without teaching the board shortcut in prose', () => {
    const onSettingsChange = vi.fn();
    render(
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

    expect(screen.queryByText('Choose “+ new crew…” on the board to create the first crew.')).toBeNull();
    expect(screen.getByText('No crews yet — every difficulty needs one before tiered execution can route work.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add crew' }));

    const next = onSettingsChange.mock.calls.at(-1)?.[0] as SettingsConfig;
    expect(next.tiered_execution?.tiers['trivial-simple-medium-complex-expert']).toMatchObject({
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
    });
    expect(next.tiered_execution?.supervisor).toEqual({
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      subscribe: 'flagged',
    });
  });

  it('disables a roster difficulty that would strand a kind override', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial'] },
        standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['simple', 'medium', 'complex', 'expert'] },
      },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: { docs: 'cheap' }, replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add crew' }));
    const guardedDifficulty = screen.getByRole('button', { name: 'Assign trivial to new crew' });
    expect(guardedDifficulty).toBeDisabled();
    expect(screen.getByText("Move or remove docs kind overrides before reassigning this crew's final difficulty.")).toBeTruthy();
    expect(onSettingsChange).not.toHaveBeenCalled();
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

  it('hands a collapsed crew difficulties to an heir in one write without toggling the row', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: {
        mixed: {
          model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['trivial', 'simple'],
          distribution: [
            { model: 'claude-sonnet-5', harness: 'claude-code', weight: 70 },
            { model: 'gpt-5.6-terra', harness: 'codex', weight: 20 },
          ],
        },
        capable: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'] },
      },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: {}, replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    expect(screen.getByText(/Invalid — .*weights must total exactly 100/)).toBeTruthy();
    const removeButton = screen.getByRole('button', { name: 'Remove crew 2-model mix' });
    const row = removeButton.closest('details');
    expect(row).not.toHaveAttribute('open');
    fireEvent.click(removeButton);
    // happy-dom applies the native <details> toggle after React prevents the
    // summary default action. The button only renders while React's row state is closed.
    expect(removeButton).toBeInTheDocument();
    expect(screen.getByText('Removing 2-model mix — give trivial · simple to:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Give trivial · simple to Claude Haiku 4.5 (200K context)' }));

    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    const next = onSettingsChange.mock.calls[0][0] as SettingsConfig;
    expect(next.tiered_execution?.tiers['trivial-simple-medium-complex-expert']).toMatchObject({
      model: 'claude-haiku-4-5',
      difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'],
    });
    expect(Object.values(next.tiered_execution?.tiers ?? {}).some((tier) => tier.distribution)).toBe(false);
    expect(screen.queryByText('Assign these difficulties to another crew before removing it.')).toBeNull();
  });

  it('revalidates kind overrides before confirming an open heir prompt', () => {
    const onSettingsChange = vi.fn();
    const formData = baseSettings({ tiered_execution: {
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
        capable: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'] },
      },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: {}, replay_threshold: 0.5,
    } });
    const { rerender } = render(
      <TieredExecutionSection formData={formData} onSettingsChange={onSettingsChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove crew Claude Haiku 4.5 (200K context)' }));
    expect(screen.getByText('Removing Claude Haiku 4.5 (200K context) — give trivial · simple to:')).toBeTruthy();

    rerender(
      <TieredExecutionSection
        formData={baseSettings({
          ...formData,
          tiered_execution: {
            ...formData.tiered_execution!,
            by_kind: { docs: 'cheap' },
          },
        })}
        onSettingsChange={onSettingsChange}
      />,
    );
    onSettingsChange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Give trivial · simple to Claude Sonnet 5 (1M context)' }));
    expect(screen.getByText('Move or remove these kind overrides before removing this crew.')).toBeTruthy();
    expect(screen.queryByText('Removing Claude Haiku 4.5 (200K context) — give trivial · simple to:')).toBeNull();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('blocks reassigning the final difficulty from a kind-routed crew', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial'] },
        standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['simple', 'medium', 'complex', 'expert'] },
      },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: { docs: 'cheap' }, replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    fireEvent.change(screen.getByLabelText('crew for trivial'), { target: { value: 'standard' } });
    expect(screen.getByText("Move or remove docs kind overrides before reassigning this crew's final difficulty.")).toBeTruthy();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('blocks removing a crew referenced solely by a kind override', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: false,
      tiers: { legacy: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: [] } },
      by_kind: { docs: 'legacy' }, replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove crew Claude Haiku 4.5 (200K context)' }));
    expect(screen.getByText('Move or remove these kind overrides before removing this crew.')).toBeTruthy();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('blocks removing the last crew because every difficulty needs an owner', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: { all: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: {}, replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove crew Claude Haiku 4.5 (200K context)' }));
    expect(screen.getByText('This is the only crew, and every difficulty needs one. Add another crew first — or turn tiered execution off.')).toBeTruthy();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('routes the expanded Remove crew button through the heir prompt', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
        capable: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'] },
      },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: {}, replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    const summary = screen.getAllByText('Claude Haiku 4.5 (200K context)').find((element) => element.closest('summary'))!.closest('summary')!;
    const row = summary.closest('details')!;
    fireEvent.click(summary);
    fireEvent.click(within(row).getByRole('button', { name: 'Remove crew' }));
    expect(screen.getByText('Removing Claude Haiku 4.5 (200K context) — give trivial · simple to:')).toBeTruthy();
    expect(screen.queryByText('Assign these difficulties to another crew before removing it.')).toBeNull();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('shows the collapsed-row edit cue through hover and focus classes', () => {
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: { all: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: {}, replay_threshold: 0.5,
    } })} onSettingsChange={vi.fn()} />);

    const summary = screen.getByText('edit').closest('summary');
    expect(summary).toHaveClass('hover:bg-muted/40', 'focus-visible:bg-muted/40', 'focus-within:bg-muted/40');
    expect(screen.getByText('edit')).toHaveClass('opacity-0', 'group-hover:opacity-100', 'group-focus-visible:opacity-100', 'group-focus-within:opacity-100');
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
  });

  it('shows no inspection-ownership control for the retired owns_inspection setting', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: false,
      tiers: {},
      by_kind: {},
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    expect(screen.getByRole('button', { name: /Standing reviewer/ }).textContent).not.toContain('inspection');
    fireEvent.click(screen.getByRole('button', { name: /Standing reviewer/ }));
    expect(screen.queryByRole('switch', { name: 'Supervisor owns inspection' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Subscribe'), { target: { value: 'all' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.supervisor).not.toHaveProperty('owns_inspection');
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

    expect(screen.getByText('backend → Claude Haiku 4.5 (200K context)')).toBeTruthy();
  });

  it('normalizes alias-only byKind before an unrelated crew edit', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: false,
      tiers: { all: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
      byKind: { docs: 'all' },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    expect(screen.getByText('docs → Claude Haiku 4.5 (200K context)')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Claude Haiku 4.5 (200K context)').find((element) => element.closest('summary'))!.closest('summary')!);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-sonnet-5' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.by_kind.docs).toBe('trivial-simple-medium-complex-expert');
  });

  it('canonicalizes alias-only byKind through an unrelated replay edit', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: false,
      tiers: { all: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] } },
      byKind: { docs: 'all' },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
    } })} onSettingsChange={onSettingsChange} />);

    fireEvent.change(screen.getByLabelText('Replay threshold'), { target: { value: '0.75' } });
    const saved = onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution;
    expect(saved.by_kind).toEqual({ docs: 'all' });
    expect(saved.byKind).toBeUndefined();
    expect(saved.replay_threshold).toBe(0.75);
  });

  it('edits feed, escalation, and replay threshold values', () => {
    const onSettingsChange = vi.fn();
    const { container } = render(
      <TieredExecutionSection
        formData={baseSettings({
          tiered_execution: {
            enabled: false,
            tiers: {},
            by_kind: {},
            feed: { callouts: 'off', exclude: [], exclude_subjects: [], max_diff_bytes: null },
            escalation: { enabled: false, retries_at_tier: 0, max_promotions: 0 },
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

    fireEvent.change(screen.getByLabelText('Compaction reroute'), { target: { value: 'on' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.compaction_reroute).toBe('on');
    expect(screen.getByText(/Commit feed/)).toBeTruthy();
    expect(screen.getByText(/off — failures never change crews/)).toBeTruthy();
    fireEvent.click(screen.getByText(/What this writes to config.yaml/));
    expect(container.querySelector('pre')?.textContent).toContain('tiered_execution:\n  enabled: false');
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

describe('no-loss inventory', () => {
  it('keeps every legacy control and its settings write path on the crews surface', () => {
    const onSettingsChange = vi.fn();
    render(<TieredExecutionSection formData={baseSettings({ tiered_execution: {
      enabled: true,
      tiers: {
        solo: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
        mix: {
          model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'],
          distribution: [
            { model: 'claude-sonnet-5', harness: 'claude-code', weight: 60 },
            { model: 'gpt-5.6-terra', harness: 'codex', weight: 40 },
          ],
        },
      },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      by_kind: {},
      feed: { callouts: 'off', max_diff_bytes: null, exclude: [], exclude_subjects: [] },
      escalation: { enabled: false, retries_at_tier: 0, max_promotions: 0 },
      replay_threshold: 0.5, compaction_reroute: 'off',
    } })} onSettingsChange={onSettingsChange} />);

    expect(screen.getByRole('switch', { name: 'Enable tiered execution' })).toBeTruthy();
    expect(screen.getByText('On · valid')).toBeTruthy();
    expect(screen.getAllByLabelText(/^crew for /)).toHaveLength(5);
    expect(screen.getAllByRole('option', { name: '+ new crew…' })).toHaveLength(5);
    expect(screen.getAllByLabelText(/^Model/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByLabelText(/^Harness/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByLabelText(/^Weight/)).toHaveLength(2);
    expect(screen.getByText('Total: 100%')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Use (one model|a weighted mix)/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Remove crew' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Remove crew .+/ })).toHaveLength(2);
    expect(screen.getAllByText('edit')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add model' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Remove model/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Standing reviewer/ }));
    expect(screen.getByLabelText('Subscribe')).toBeTruthy();
    expect(screen.getByLabelText('Kind to override').querySelectorAll('option')).toHaveLength(9);
    expect(screen.getByLabelText('Crew for kind override')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add override' })).toBeTruthy();

    for (const label of ['Call-outs', 'Max diff bytes', 'Exclude paths', 'Exclude subjects', 'Retries at tier', 'Max promotions', 'Replay threshold', 'Compaction reroute']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole('switch', { name: 'Enable tier escalation' })).toBeTruthy();
    expect(screen.getByText(/What this writes to config.yaml/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Call-outs'), { target: { value: 'notify' } });
    fireEvent.change(screen.getByLabelText('Compaction reroute'), { target: { value: 'on' } });
    expect(onSettingsChange.mock.calls.some((call) => call[0].tiered_execution.feed.callouts === 'notify')).toBe(true);
    expect(onSettingsChange.mock.calls.at(-1)?.[0].tiered_execution.compaction_reroute).toBe('on');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('tier fitness badges (PAN-3842)', () => {
  function settingsWith(tiered_execution: SettingsConfig['tiered_execution']): SettingsConfig {
    return baseSettings({ tiered_execution });
  }

  it('renders one badge naming small-class and expert for a haiku crew that owns expert', () => {
    render(
      <TieredExecutionSection
        formData={settingsWith({
          enabled: true,
          tiers: {
            cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
            capable: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
            frontier: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['expert'] },
          },
          by_kind: {},
          supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
          replay_threshold: 0.5,
        })}
        onSettingsChange={vi.fn()}
      />,
    );

    const badges = screen.getAllByTestId('tier-fitness-warning');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('small-class');
    expect(badges[0].textContent).toContain('expert');
  });

  it('renders no badge for the same haiku crew owning only trivial and simple', () => {
    render(
      <TieredExecutionSection
        formData={settingsWith({
          enabled: true,
          tiers: {
            cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
            capable: { model: 'claude-opus-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'] },
          },
          by_kind: {},
          supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
          replay_threshold: 0.5,
        })}
        onSettingsChange={vi.fn()}
      />,
    );

    expect(screen.queryAllByTestId('tier-fitness-warning')).toHaveLength(0);
  });

  it("renders a 'would cost less' badge for a claude-opus-5 crew owning only trivial", () => {
    render(
      <TieredExecutionSection
        formData={settingsWith({
          enabled: true,
          tiers: {
            cheap: { model: 'claude-opus-5', harness: 'claude-code', difficulties: ['trivial'] },
            capable: { model: 'claude-fable-5-1', harness: 'claude-code', difficulties: ['simple', 'medium', 'complex', 'expert'] },
          },
          by_kind: {},
          supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
          replay_threshold: 0.5,
        })}
        onSettingsChange={vi.fn()}
      />,
    );

    const badges = screen.getAllByTestId('tier-fitness-warning');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('would cost less');
  });

  it('renders a badge in the supervisor block for a haiku supervisor', () => {
    render(
      <TieredExecutionSection
        formData={settingsWith({
          enabled: true,
          tiers: {
            cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
            capable: { model: 'claude-opus-5', harness: 'claude-code', difficulties: ['medium', 'complex', 'expert'] },
          },
          by_kind: {},
          supervisor: { model: 'claude-haiku-4-5', harness: 'claude-code', subscribe: 'flagged' },
          replay_threshold: 0.5,
        })}
        onSettingsChange={vi.fn()}
      />,
    );

    const badges = screen.getAllByTestId('tier-fitness-warning');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('supervisor');
  });

  it("renders a 'not enabled' badge when the crew model's provider is disabled", () => {
    render(
      <TieredExecutionSection
        formData={settingsWith({
          enabled: true,
          tiers: {
            cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
            capable: { model: 'gpt-5.6-luna', harness: 'codex', difficulties: ['medium', 'complex', 'expert'] },
          },
          by_kind: {},
          supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
          replay_threshold: 0.5,
        })}
        onSettingsChange={vi.fn()}
      />,
    );

    const texts = screen.getAllByTestId('tier-fitness-warning').map((badge) => badge.textContent ?? '');
    expect(texts.some((text) => text.includes('not enabled'))).toBe(true);
  });

  it('removes the badge when the crew model changes to a fitting model, before any save', () => {
    const onSettingsChange = vi.fn();
    const formData = settingsWith({
      enabled: true,
      tiers: {
        only: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
      },
      by_kind: {},
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
    });
    const { rerender } = render(<TieredExecutionSection formData={formData} onSettingsChange={onSettingsChange} />);

    expect(screen.getAllByTestId('tier-fitness-warning').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-fable-5-1' } });
    expect(onSettingsChange).toHaveBeenCalled();
    const draft = onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1][0] as SettingsConfig;

    rerender(<TieredExecutionSection formData={draft} onSettingsChange={onSettingsChange} />);
    expect(screen.queryAllByTestId('tier-fitness-warning')).toHaveLength(0);
  });
});

// PAN-3842 (adjudicated F-3): every fitness badge was keyed on the warning
// code alone, so a distribution whose entries share a code rendered siblings
// with the same key and React logged a duplicate-key error.
describe('fitness badge keys', () => {
  function renderWithConsoleCapture(ui: Parameters<typeof render>[0]) {
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      messages.push(args.map(String).join(' '));
    });
    try {
      render(ui);
    } finally {
      spy.mockRestore();
    }
    return messages;
  }

  it('renders one badge per warning with no duplicate-key error for a same-code distribution', () => {
    // Two small-class models on an expert crew: two 'underpowered' warnings,
    // one per distribution entry. Keyed on the code alone these collided.
    const formData = baseSettings({
      tiered_execution: {
        enabled: true,
        tiers: {
          top: {
            model: 'claude-haiku-4-5',
            harness: 'claude-code',
            difficulties: ['expert'],
            distribution: [
              { model: 'claude-haiku-4-5', harness: 'claude-code', weight: 50 },
              { model: 'gpt-5.6-luna', harness: 'codex', weight: 50 },
            ],
          },
        },
        by_kind: {},
        replay_threshold: 0.5,
      },
    } as never);

    const messages = renderWithConsoleCapture(
      <TieredExecutionSection formData={formData} onSettingsChange={vi.fn()} />,
    );

    const duplicateKeyErrors = messages.filter((message) => /same key|duplicate key|Encountered two children/i.test(message));
    expect(duplicateKeyErrors, duplicateKeyErrors.join('\n')).toEqual([]);

    const badges = screen.getAllByTestId('tier-fitness-warning');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every badge message rather than collapsing duplicates', () => {
    const formData = baseSettings({
      tiered_execution: {
        enabled: true,
        tiers: {
          top: {
            model: 'claude-haiku-4-5',
            harness: 'claude-code',
            difficulties: ['expert'],
            distribution: [
              { model: 'claude-haiku-4-5', harness: 'claude-code', weight: 50 },
              { model: 'gpt-5.6-luna', harness: 'codex', weight: 50 },
            ],
          },
        },
        by_kind: {},
        replay_threshold: 0.5,
      },
    } as never);

    render(<TieredExecutionSection formData={formData} onSettingsChange={vi.fn()} />);

    const titles = screen.getAllByTestId('tier-fitness-warning').map((badge) => badge.getAttribute('title') ?? '');
    expect(titles.some((title) => title.includes('claude-haiku-4-5'))).toBe(true);
    expect(titles.some((title) => title.includes('gpt-5.6-luna'))).toBe(true);
  });
});
