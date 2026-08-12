import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ForkModal } from '../ForkModal';
import type { Conversation } from '../ConversationList';

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [
      { key: 'source-key', name: 'Source Project', path: '/tmp/acp-source' },
      { key: 'target-key', name: 'Target Project', path: '/tmp/target' },
    ],
  }),
}));

vi.mock('../../chat/defaultConversationModel', () => ({
  getDefaultConversationModel: () => 'claude-sonnet-5',
  FALLBACK_DEFAULT_CONVERSATION_MODEL: 'claude-sonnet-5',
}));

vi.mock('../../shared/ModelPicker', () => ({
  ModelHarnessPicker: ({ modelLabel, onModelChange }: { modelLabel: string; onModelChange: (model: string) => void }) => (
    <button type="button" onClick={() => onModelChange('gpt-5.6-sol')}>{modelLabel}</button>
  ),
  ModelSelect: () => <div data-testid="model-select" />,
  useAvailableModels: () => ({
    groups: [],
    compactionModel: 'claude-haiku-4-5-20251001',
    harnessPolicy: {},
  }),
}));

const ACP_CONVERSATION: Conversation = {
  id: 1,
  name: 'ACP source',
  tmuxSession: 'conv-acp-source',
  status: 'active',
  cwd: '/tmp/acp-source',
  issueId: null,
  createdAt: '2026-07-18T00:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  model: 'kimi-for-coding',
  harness: 'acp',
};

describe('ForkModal ACP source capabilities', () => {
  it('hides Exact copy and falls back to a summary when plain mode was requested', () => {
    const onConfirm = vi.fn();

    render(
      <ForkModal
        conversation={ACP_CONVERSATION}
        initialMode="plain"
        onConfirm={onConfirm}
        onClose={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.queryByText('Exact copy')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Fresh summary/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Same as source (Source Project)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onConfirm).toHaveBeenCalledWith(
      ACP_CONVERSATION,
      'kimi-for-coding',
      'claude-haiku-4-5-20251001',
      'summary',
      false,
      false,
      'Summary Fork: ACP source',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('omits hidden harness overrides when the launch model changes', () => {
    const onConfirm = vi.fn();
    const claudeConversation: Conversation = {
      ...ACP_CONVERSATION,
      name: 'Claude source',
      model: 'claude-sonnet-5',
      harness: 'claude-code',
    };

    render(
      <ForkModal
        conversation={claudeConversation}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        isPending={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Launch model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][1]).toBe('gpt-5.6-sol');
    expect(onConfirm.mock.calls[0][7]).toBeUndefined();
    expect(onConfirm.mock.calls[0][8]).toBeUndefined();
    expect(onConfirm.mock.calls[0][12]).toBeUndefined();
  });

  it('keeps the required Claude Code harness for exact-copy forks', () => {
    const onConfirm = vi.fn();
    const claudeConversation: Conversation = {
      ...ACP_CONVERSATION,
      name: 'Claude source',
      model: 'claude-sonnet-5',
      harness: 'claude-code',
    };

    render(
      <ForkModal
        conversation={claudeConversation}
        initialMode="plain"
        onConfirm={onConfirm}
        onClose={vi.fn()}
        isPending={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onConfirm.mock.calls[0][3]).toBe('plain');
    expect(onConfirm.mock.calls[0][7]).toBe('claude-code');
  });

  it('sends the selected registered project yaml key', () => {
    const onConfirm = vi.fn();

    render(
      <ForkModal
        conversation={ACP_CONVERSATION}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        isPending={false}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
      target: { value: 'target-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][13]).toBe('target-key');
  });
});
