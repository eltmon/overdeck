import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HarnessSelect, ModelSelect, type HarnessPolicyDecisions, type ModelGroup } from './ModelPicker';

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
        groups={groups}
      />,
    );

    expect(screen.getByLabelText('Claude Code logo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Claude Code/i }));

    expect(screen.getAllByLabelText('Claude Code logo').length).toBeGreaterThan(1);
    expect(screen.getByLabelText('oh-my-pi logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Codex logo')).toBeInTheDocument();
  });

  it('disables the blocked ohmypi option and shows the reason inline', async () => {
    const user = userEvent.setup();
    const harnessPolicy: HarnessPolicyDecisions = {
      'claude-sonnet-4-6': {
        ohmypi: { allowed: false, reason: 'Blocked by Claude Code subscription Terms of Service' },
      },
    };
    render(
      <HarnessSelect
        value="claude-code"
        onChange={vi.fn()}
        modelId="claude-sonnet-4-6"
        groups={groups}
        harnessPolicy={harnessPolicy}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Code/i }));

    const blockedHarnessButton = screen.getByRole('button', { name: /oh-my-pi/i });
    expect(blockedHarnessButton).toBeDisabled();
    expect(blockedHarnessButton).toHaveTextContent('Blocked by Claude Code subscription Terms of Service');
  });
});
