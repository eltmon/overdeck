/**
 * PAN-4436: a Session Vault browse copy (a conversation another machine owns)
 * shows its owner on the row and a read-only notice in place of the composer.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerFooter } from '../ComposerFooter';

import { ConversationRow } from '../../CommandDeck/ConversationRow';
import type { Conversation } from '../../CommandDeck/ConversationList';
import type { ConversationMutations } from '../../CommandDeck/useConversationMutations';
import { installEffortDefaultFetchMock } from '../../../test-utils/strictFetchMock';

vi.mock('../../DialogProvider', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

// The composer's editor and pickers, stubbed the way ComposerFooter.test.tsx does.
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

let fetchControl: ReturnType<typeof installEffortDefaultFetchMock>;

beforeEach(() => {
  fetchControl = installEffortDefaultFetchMock();
});

afterEach(async () => {
  cleanup();
  await fetchControl.assertNoUnexpectedRequests();
  vi.unstubAllGlobals();
});

const VAULT_ID = '00000000-0000-4000-8000-000000000042';

const browseCopy: Conversation = {
  id: 42,
  name: `vault-${VAULT_ID}`,
  tmuxSession: `conv-vault-${VAULT_ID}`,
  status: 'ended',
  cwd: '/home/other/proj',
  issueId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-02T10:00:00.000Z',
  lastAttachedAt: null,
  sessionAlive: false,
  title: 'Saved on the laptop',
  origin: 'vault',
  vaultOwnerLabel: 'laptop-a',
};

const mutations: ConversationMutations = {
  archive: vi.fn(),
  stop: vi.fn(),
  rename: vi.fn(),
  retitle: vi.fn(),
  isRetitlePending: vi.fn(() => false),
  toggleFavorite: vi.fn(),
  move: vi.fn(),
  linkPullRequest: vi.fn(),
  unlinkPullRequest: vi.fn(),
  openForkModal: vi.fn(),
  submitFork: vi.fn(),
  forkTarget: null,
  forkTargetMode: undefined,
  forkTargetFocus: undefined,
  closeForkModal: vi.fn(),
  isForkPending: false,
};

function renderRow(conv: Conversation, variant: 'flat' | 'nested') {
  render(<ConversationRow conv={conv} variant={variant} isSelected={false} onSelect={vi.fn()} mutations={mutations} />);
}

describe('ConversationRow owner badge (PAN-4436)', () => {
  it.each(['flat', 'nested'] as const)('shows "from <machine>" on a browse copy in the %s variant', (variant) => {
    renderRow(browseCopy, variant);
    const badge = screen.getByTestId('vault-owner-badge');
    expect(badge).toHaveTextContent('from laptop-a');
    expect(badge).toHaveAttribute('title', 'Read-only copy from laptop-a');
  });

  it.each(['flat', 'nested'] as const)('shows no owner badge on a local row in the %s variant', (variant) => {
    renderRow({ ...browseCopy, name: 'local', origin: 'local', vaultOwnerLabel: null }, variant);
    expect(screen.queryByTestId('vault-owner-badge')).not.toBeInTheDocument();
  });
});

describe('ComposerFooter read-only notice (PAN-4436)', () => {
  it('shows how to continue a browse copy instead of an input', () => {
    render(<ComposerFooter conversation={browseCopy} />);
    const notice = screen.getByTestId('vault-read-only-notice');
    expect(notice).toHaveTextContent('Read-only copy from laptop-a.');
    expect(notice).toHaveTextContent(`To continue it here, run: pan vault resume ${VAULT_ID}`);
    expect(screen.getByRole('button', { name: 'Continue here' })).toBeInTheDocument(); // PAN-4437
    expect(screen.queryByTestId('composer-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders the input for a local conversation', () => {
    render(<ComposerFooter conversation={{ ...browseCopy, name: 'local', origin: 'local', status: 'active', sessionAlive: true, vaultOwnerLabel: null }} />);
    expect(screen.getByTestId('composer-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('vault-read-only-notice')).not.toBeInTheDocument();
  });
});
