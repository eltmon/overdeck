/**
 * PAN-4447: "Continued on <machine>" / "Local turns since then were saved as a
 * fork" composer notice, and its wiring into ComposerFooter for local rows.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VaultContinuityNotice } from '../VaultContinuityNotice';
import { ComposerFooter } from '../ComposerFooter';
import type { Conversation, VaultContinuity } from '../../CommandDeck/ConversationList';

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

afterEach(() => {
  cleanup();
});

const CONTINUED_ELSEWHERE: VaultContinuity = { kind: 'continued-elsewhere', vaultId: 'v-parent', ownerLabel: 'laptop-a' };
const FORKED_LOCALLY: VaultContinuity = { kind: 'forked-locally', forkVaultId: 'forkabcd1234', parentVaultId: 'v-parent', parentOwnerLabel: 'laptop-a' };

describe('VaultContinuityNotice', () => {
  it('composer-continuity-notice.ac1: continued-elsewhere renders "Continued on laptop-a." and no fork line', () => {
    render(<VaultContinuityNotice continuity={CONTINUED_ELSEWHERE} onOpenCopy={vi.fn()} />);
    const notice = screen.getByTestId('vault-continuity-notice');
    expect(notice).toHaveTextContent('Continued on laptop-a.');
    expect(notice).not.toHaveTextContent('saved as a fork');
  });

  it('composer-continuity-notice.ac2: forked-locally renders the fork line with its id8', () => {
    render(<VaultContinuityNotice continuity={FORKED_LOCALLY} onOpenCopy={vi.fn()} />);
    expect(screen.getByTestId('vault-continuity-notice')).toHaveTextContent('Local turns since then were saved as a fork (forkabcd).');
  });

  it('composer-continuity-notice.ac3: "View its copy" opens vault-<vaultId> or vault-<parentVaultId>', () => {
    const onOpenCopy = vi.fn();
    render(<VaultContinuityNotice continuity={CONTINUED_ELSEWHERE} onOpenCopy={onOpenCopy} />);
    fireEvent.click(screen.getByRole('button', { name: 'View its copy' }));
    expect(onOpenCopy).toHaveBeenCalledWith('vault-v-parent');

    cleanup();
    const onOpenCopyFork = vi.fn();
    render(<VaultContinuityNotice continuity={FORKED_LOCALLY} onOpenCopy={onOpenCopyFork} />);
    fireEvent.click(screen.getByRole('button', { name: 'View its copy' }));
    expect(onOpenCopyFork).toHaveBeenCalledWith('vault-v-parent');
  });
});

const localConversation: Conversation = {
  id: 1,
  name: 'local-continuity',
  tmuxSession: 'conv-local-continuity',
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

describe('ComposerFooter vault continuity notice (PAN-4447)', () => {
  it('composer-continuity-notice.ac4: renders the notice and the editor, and routes to the vault copy on click', () => {
    render(<ComposerFooter conversation={{ ...localConversation, vaultContinuity: CONTINUED_ELSEWHERE }} />);
    expect(screen.getByTestId('vault-continuity-notice')).toBeInTheDocument();
    expect(screen.getByTestId('composer-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View its copy' }));
    expect(window.location.pathname).toBe('/conv/vault-v-parent');
  });

  it('composer-continuity-notice.ac5: vaultContinuity null renders no notice', () => {
    render(<ComposerFooter conversation={{ ...localConversation, vaultContinuity: null }} />);
    expect(screen.queryByTestId('vault-continuity-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-editor')).toBeInTheDocument();
  });
});
