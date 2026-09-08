import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Conversation } from '../CommandDeck/ConversationList';
import { SubagentComposer } from './SubagentComposer';

vi.mock('./ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: ({ onChange, disabled, placeholder }: { onChange: (text: string) => void; disabled: boolean; placeholder: string }) => (
    <textarea disabled={disabled} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
  ),
}));
const conversation = { name: 'parent', harness: 'codex', sessionAlive: true, endedAt: null } as Conversation;
const child = { agentId: 'child', agentType: 'Avicenna', description: 'Audit', toolUseId: 'call-1', spawnDepth: 1, status: 'running' as const };
function renderComposer(parent = conversation) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SubagentComposer conversation={parent} subagent={child} /></QueryClientProvider>);
}
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('SubagentComposer', () => {
  it('does not render a composer while capability is unknown or unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ direct: false }) });
    renderComposer();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it.each(['claude-code', 'pi'] as const)('does not offer a relay or probe for %s', harness => {
    renderComposer({ ...conversation, harness });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('submits only to the selected child and acknowledges its recipient', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ direct: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, threadId: 'child' }) });
    renderComposer();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'Please check this');
    await user.click(screen.getByRole('button', { name: 'Send to Avicenna' }));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/conversations/parent/subagents/child/input', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Please check this' }),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to Avicenna.');
  });
  it('keeps failed text and does not automatically retry an uncertain delivery', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ direct: true }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Check the transcript before retrying.' }) });
    renderComposer();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Send to Avicenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the transcript');
    expect(screen.getByRole('textbox')).toHaveValue('Keep this draft');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
