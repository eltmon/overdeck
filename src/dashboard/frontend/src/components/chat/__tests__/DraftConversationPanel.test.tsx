import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DraftConversationPanel } from '../DraftConversationPanel';

const mockLoadStoredModel = vi.fn();
const mockLoadStoredEffort = vi.fn(() => 'medium');
const mockEnsureDefaultConversationModel = vi.fn(() => Promise.resolve());
const mockGetDefaultConversationModel = vi.fn(() => 'claude-sonnet-4-6');

vi.mock('../ComposerPromptEditor', () => ({
  ComposerPromptEditor: () => <div data-testid="composer-editor" />,
}));

vi.mock('../ModelPicker', () => ({
  ModelPicker: ({ value }: { value: string }) => <div data-testid="model-picker">{value}</div>,
  MODEL_EFFORT_SUPPORT: {
    'claude-sonnet-4-6': ['low', 'medium', 'high'],
    'gpt-5.5': [],
    'gpt-5.4': [],
  },
  FALLBACK_DEFAULT_MODEL: 'claude-sonnet-4-6',
  loadStoredModel: (...args: unknown[]) => mockLoadStoredModel(...args),
  saveStoredModel: vi.fn(),
}));

vi.mock('../EffortPicker', () => ({
  EffortPicker: ({ value }: { value: string }) => <div data-testid="effort-picker">{value}</div>,
  loadStoredEffort: () => mockLoadStoredEffort(),
}));

vi.mock('../defaultConversationModel', () => ({
  ensureDefaultConversationModel: () => mockEnsureDefaultConversationModel(),
  getDefaultConversationModel: () => mockGetDefaultConversationModel(),
}));

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe('DraftConversationPanel defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadStoredEffort.mockReturnValue('medium');
    mockEnsureDefaultConversationModel.mockResolvedValue(undefined);
    mockGetDefaultConversationModel.mockReturnValue('claude-sonnet-4-6');
  });

  it('uses the resolved provider default for a first-time user', async () => {
    mockLoadStoredModel.mockImplementation((resolvedDefault?: string) => resolvedDefault ?? 'claude-sonnet-4-6');
    mockGetDefaultConversationModel.mockReturnValue('gpt-5.4');

    render(<DraftConversationPanel onPromoted={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('model-picker')).toHaveTextContent('gpt-5.4');
    });
    expect(mockLoadStoredModel).toHaveBeenCalledWith('gpt-5.4');
  });

  it('prefers the last stored model over the provider default', async () => {
    mockLoadStoredModel.mockReturnValue('claude-opus-4-6');
    mockGetDefaultConversationModel.mockReturnValue('claude-sonnet-4-6');

    render(<DraftConversationPanel onPromoted={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('model-picker')).toHaveTextContent('claude-opus-4-6');
    });
    expect(mockLoadStoredModel).toHaveBeenCalledWith('claude-sonnet-4-6');
  });
});
