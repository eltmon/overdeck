/** PAN-4455 WI-10: the About drawer extracted from ConversationPanel renders the same states. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConversationAboutDrawer, type ConversationAboutDrawerProps } from '../ConversationAboutDrawer';

function props(overrides: Partial<ConversationAboutDrawerProps> = {}): ConversationAboutDrawerProps {
  return { loading: false, error: false, summary: null, messageCount: 0, refreshing: false, onRefresh: vi.fn(), ...overrides };
}

describe('ConversationAboutDrawer (PAN-4455 WI-10)', () => {
  it('loading shows the summarizing line', () => {
    render(<ConversationAboutDrawer {...props({ loading: true })} />);
    expect(screen.getByText('Summarizing conversation…')).toBeInTheDocument();
  });

  it('an error says the summary could not load', () => {
    render(<ConversationAboutDrawer {...props({ error: true })} />);
    expect(screen.getByText("Couldn't load the conversation summary.")).toBeInTheDocument();
  });

  it('no summary says there is not enough conversation yet', () => {
    render(<ConversationAboutDrawer {...props()} />);
    expect(screen.getByText('Not enough conversation yet to summarize.')).toBeInTheDocument();
  });

  it('a summary shows its text and the message count, singular and plural', () => {
    const { rerender } = render(<ConversationAboutDrawer {...props({ summary: 'Fixed the parser.', messageCount: 1 })} />);
    expect(screen.getByText('Fixed the parser.')).toBeInTheDocument();
    expect(screen.getByText(/Summary of 1\s+message$/)).toBeInTheDocument();
    rerender(<ConversationAboutDrawer {...props({ summary: 'Fixed the parser.', messageCount: 2 })} />);
    expect(screen.getByText(/Summary of 2\s+messages/)).toBeInTheDocument();
  });

  it('the regenerate button calls onRefresh and is disabled while refreshing', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ConversationAboutDrawer {...props({ summary: 'S', messageCount: 2, onRefresh })} />);
    await user.click(screen.getByRole('button', { name: 'Regenerate conversation summary' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(<ConversationAboutDrawer {...props({ summary: 'S', messageCount: 2, onRefresh, refreshing: true })} />);
    expect(screen.getByRole('button', { name: 'Regenerate conversation summary' })).toBeDisabled();
  });
});
