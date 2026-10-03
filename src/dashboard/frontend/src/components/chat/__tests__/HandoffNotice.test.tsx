/**
 * PAN-4455 WI-13: the "Handed off at …" composer notice and its wiring into
 * ComposerFooter (D-15, D-16).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, VaultContinuity } from '../../CommandDeck/ConversationList';
import { installEffortDefaultFetchMock } from '../../../test-utils/strictFetchMock';

const stop = vi.hoisted(() => vi.fn());
vi.mock('../../CommandDeck/useConversationMutations', () => ({ useConversationMutations: () => ({ stop }) }));
vi.mock('../../DialogProvider', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

// The composer's editor and pickers, stubbed the way VaultBrowseCopy.test.tsx does.
vi.mock('lexical', () => ({ $getRoot: () => ({ getTextContent: () => '', clear: () => {} }) }));
vi.mock('../ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: ({ editorRef }: { editorRef: { current: unknown } }) => {
    editorRef.current = { read: (callback: () => void) => callback(), update: (callback: () => void) => callback(), focus: vi.fn() };
    return <textarea aria-label="Composer editor" data-testid="composer-editor" />;
  },
}));
vi.mock('../ModelPicker', () => ({
  ModelPicker: ({ value }: { value: string }) => <div data-testid="model-picker">{value}</div>,
  MODEL_EFFORT_SUPPORT: { 'claude-sonnet-4-6': ['low', 'medium', 'high'] },
  loadStoredHarness: () => 'claude-code',
  saveStoredHarness: vi.fn(),
  saveStoredModel: vi.fn(),
}));
vi.mock('../defaultConversationModel', () => ({ getDefaultConversationModel: () => 'claude-sonnet-4-6' }));
vi.mock('../EffortPicker', () => ({ EffortPicker: () => <div data-testid="effort-picker" />, loadStoredEffort: () => 'medium' }));
vi.mock('../VoiceWidget', () => ({ VoiceWidget: () => <div data-testid="voice-widget" /> }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('../../Settings/modelCatalog', () => ({
  modelSupportsImages: vi.fn(() => true),
  findModelDef: vi.fn(() => ({ name: 'Claude Sonnet 4.6' })),
}));

const { ComposerFooter } = await import('../ComposerFooter');
const { useHandoffNoticeStore } = await import('../continueOnDevice/handoffNoticeStore');

const AT = '2026-10-01T10:00:00.000Z';

const conversation: Conversation = {
  id: 1,
  name: 'local-handoff',
  tmuxSession: 'conv-local-handoff',
  status: 'active',
  cwd: '/home/me/proj',
  issueId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Local conversation',
  origin: 'local',
};

describe('HandoffNotice in ComposerFooter (PAN-4455 WI-13)', () => {
  let fetchControl: ReturnType<typeof installEffortDefaultFetchMock>;

  beforeEach(() => {
    stop.mockReset();
    useHandoffNoticeStore.setState({ notices: {} });
    fetchControl = installEffortDefaultFetchMock();
  });

  afterEach(async () => {
    cleanup();
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
  });

  it('a recorded hand-off of a live conversation shows the notice above the editor', () => {
    act(() => useHandoffNoticeStore.getState().record('local-handoff', AT));
    render(<ComposerFooter conversation={conversation} />);
    const time = new Date(AT).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByTestId('handoff-notice')).toHaveTextContent(`Handed off at ${time}. New messages here will be saved as a separate copy.`);
    expect(screen.getByTestId('composer-editor')).toBeInTheDocument();
  });

  it('Keep working here removes the notice', () => {
    act(() => useHandoffNoticeStore.getState().record('local-handoff', AT));
    render(<ComposerFooter conversation={conversation} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep working here' }));
    expect(screen.queryByTestId('handoff-notice')).not.toBeInTheDocument();
    expect(useHandoffNoticeStore.getState().notices).toEqual({});
    expect(stop).not.toHaveBeenCalled();
  });

  it('Stop this session stops the conversation and removes the notice', () => {
    act(() => useHandoffNoticeStore.getState().record('local-handoff', AT));
    render(<ComposerFooter conversation={conversation} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop this session' }));
    expect(stop).toHaveBeenCalledWith('local-handoff');
    expect(screen.queryByTestId('handoff-notice')).not.toBeInTheDocument();
  });

  it('a stopped conversation shows no notice and clears its entry', () => {
    act(() => useHandoffNoticeStore.getState().record('local-handoff', AT));
    render(<ComposerFooter conversation={{ ...conversation, sessionAlive: false }} />);
    expect(screen.queryByTestId('handoff-notice')).not.toBeInTheDocument();
    expect(useHandoffNoticeStore.getState().notices).toEqual({});
  });

  it('PAN-4447 continuity supersedes: only the continuity notice shows', () => {
    const continuity: VaultContinuity = { kind: 'continued-elsewhere', vaultId: 'v-parent', ownerLabel: 'laptop-a' };
    act(() => useHandoffNoticeStore.getState().record('local-handoff', AT));
    render(<ComposerFooter conversation={{ ...conversation, vaultContinuity: continuity }} />);
    expect(screen.getByTestId('vault-continuity-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('handoff-notice')).not.toBeInTheDocument();
  });
});
