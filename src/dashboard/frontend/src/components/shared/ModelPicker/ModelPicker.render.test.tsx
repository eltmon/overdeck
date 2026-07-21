import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  HarnessSelect,
  ModelSelect,
  PI_TOS_BLOCK_REASON,
  type HarnessPolicyDecisions,
  type ModelGroup,
} from './ModelPicker';

const groups: ModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' }],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [{ id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai' }],
  },
];

describe('shared ModelPicker branding', () => {
  it('renders registry provider logos in model group headers', async () => {
    const user = userEvent.setup();
    render(<ModelSelect value="claude-sonnet-4-6" onChange={vi.fn()} groups={groups} label="Model" />);

    await user.click(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i }));

    expect(screen.getByLabelText('Anthropic logo')).toBeInTheDocument();
    expect(screen.getByLabelText('OpenAI logo')).toBeInTheDocument();
  });

  it('renders registry harness logos in harness options', async () => {
    const user = userEvent.setup();
    render(
      <HarnessSelect
        value="claude-code"
        onChange={vi.fn()}
        modelId="claude-sonnet-4-6"
      />,
    );

    expect(screen.getByLabelText('Claude Code logo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Claude Code/i }));

    expect(screen.getAllByLabelText('Claude Code logo').length).toBeGreaterThan(1);
    expect(screen.getByLabelText('oh-my-pi logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Codex logo')).toBeInTheDocument();
  });
});

describe('shared HarnessSelect blocked harness (PAN-2528)', () => {
  const BLOCK_REASON = PI_TOS_BLOCK_REASON;
  const blockedPolicy: HarnessPolicyDecisions = {
    'claude-sonnet-4-6': {
      ohmypi: { allowed: false, reason: BLOCK_REASON },
    },
  };

  it('disables the blocked ohmypi option with the inline reason visible (ac1, ac2)', async () => {
    const user = userEvent.setup();
    render(
      <HarnessSelect
        value="claude-code"
        onChange={vi.fn()}
        modelId="claude-sonnet-4-6"
        harnessPolicy={blockedPolicy}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Code/i }));

    const ohmypi = screen.getByRole('button', { name: /^oh-my-pi/i });
    // ac1: blocked option carries the disabled attribute
    expect(ohmypi).toBeDisabled();
    // ac2: the decision reason renders as visible inline text, not just title
    expect(within(ohmypi).getByText(BLOCK_REASON)).toBeInTheDocument();
    expect(ohmypi).toHaveAttribute('title', BLOCK_REASON);
  });

  it('clicking a blocked harness does not fire onChange (ac3)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <HarnessSelect
        value="claude-code"
        onChange={onChange}
        modelId="claude-sonnet-4-6"
        harnessPolicy={blockedPolicy}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Code/i }));

    // fireEvent bypasses the user-event disabled-button guard so we exercise
    // the handleClick early-return path the disabled attribute would otherwise
    // short-circuit at the DOM layer.
    fireEvent.click(screen.getByRole('button', { name: /^oh-my-pi/i }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicking an allowed harness still fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <HarnessSelect
        value="claude-code"
        onChange={onChange}
        modelId="claude-sonnet-4-6"
        harnessPolicy={blockedPolicy}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Code/i }));
    await user.click(screen.getByRole('button', { name: /^Codex/i }));

    expect(onChange).toHaveBeenCalledWith('codex');
  });
});
