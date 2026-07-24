import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandResultRow } from '../CommandResultRow';
import type { ChatMessage } from '../../chat-types';

function commandMessage(commandResult: ChatMessage['commandResult']): ChatMessage {
  return {
    id: 'command-result-1',
    role: 'system',
    text: '/pan status',
    commandText: '/pan status',
    commandResult,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}

describe('CommandResultRow', () => {
  it('renders captured output and an explicit truncation notice', () => {
    render(
      <CommandResultRow
        message={commandMessage({
          kind: 'captured',
          status: 'completed',
          command: '/pan status',
          output: 'Ready.\nMore output.',
          truncated: true,
        })}
      />,
    );

    expect(screen.getByText('/pan status completed successfully.')).toBeInTheDocument();
    expect(screen.getByText(/Ready/)).toBeInTheDocument();
    expect(screen.getByText('The captured output was truncated at the server limit.')).toBeInTheDocument();
  });

  it('renders detached activity identity in a complete accepted-state message', () => {
    render(
      <CommandResultRow
        message={commandMessage({
          kind: 'activity',
          status: 'accepted',
          command: '/pan start PAN-1525',
          activityId: 'activity-42',
          message: 'Started work.',
        })}
      />,
    );

    expect(screen.getByText('/pan start PAN-1525 was accepted and is running in the background.')).toBeInTheDocument();
    expect(screen.getByText('Activity: activity-42')).toBeInTheDocument();
  });

  it('requires exact typed text before resubmitting a confirmation', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CommandResultRow
        message={commandMessage({
          kind: 'confirmation',
          status: 'confirmation_required',
          nonce: 'nonce-1',
          consequence: 'This will update the selected target.',
          typedText: 'CONFIRM',
        })}
        onConfirm={onConfirm}
      />,
    );

    const button = screen.getByRole('button', { name: 'Confirm command' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type CONFIRM to confirm'), {
      target: { value: 'CONFIRM' },
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(onConfirm).toHaveBeenCalledWith('command-result-1', 'CONFIRM');
  });
});
