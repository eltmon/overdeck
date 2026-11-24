/**
 * PAN-5347 WI-5: ComposerPromptEditor renders the composer's Skills group
 * from a conversation's skill scope. Reuses the Lexical/CSS mocks from
 * ComposerPromptEditor.test.tsx (vi.mock is per-file, so they are repeated
 * here rather than imported).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ComposerPromptEditor } from '../ComposerPromptEditor';

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: {
    composerEditor: 'composerEditor',
    composerEditorDisabled: 'composerEditorDisabled',
    composerEditable: 'composerEditable',
    composerPlaceholder: 'composerPlaceholder',
    slashMenu: 'slashMenu',
    slashMenuItem: 'slashMenuItem',
    slashMenuItemSelected: 'slashMenuItemSelected',
    slashMenuLabel: 'slashMenuLabel',
    slashMenuDescription: 'slashMenuDescription',
    slashMenuMatch: 'slashMenuMatch',
  },
}));

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

let capturedRootElement: HTMLDivElement;

const mockEditor = {
  registerCommand: vi.fn(() => () => {}),
  read: (fn: () => void) => fn(),
  update: (fn: () => void) => fn(),
  focus: vi.fn(),
  getRootElement: () => {
    if (!capturedRootElement) {
      capturedRootElement = document.createElement('div');
      capturedRootElement.contentEditable = 'true';
    }
    return capturedRootElement;
  },
};

const mockRange = {
  getBoundingClientRect: vi.fn(() => ({ top: 80, bottom: 100, left: 50, right: 50, width: 0, height: 20 })),
};
const mockSelection = {
  rangeCount: 1,
  getRangeAt: vi.fn(() => mockRange),
};
vi.stubGlobal('getSelection', vi.fn(() => mockSelection));

let mockLexicalText = '/';
let createdTextNodes: string[];

vi.mock('@lexical/react/LexicalComposer', () => ({
  LexicalComposer: ({ children }: any) => <div data-testid="lexical-composer">{children}</div>,
}));
vi.mock('@lexical/react/LexicalPlainTextPlugin', () => ({
  PlainTextPlugin: ({ contentEditable }: any) => <div data-testid="plain-text-plugin">{contentEditable}</div>,
}));
vi.mock('@lexical/react/LexicalContentEditable', () => ({
  ContentEditable: ({ className, 'aria-placeholder': ariaPlaceholder }: any) => (
    <div data-testid="contenteditable" className={className} contentEditable aria-placeholder={ariaPlaceholder} />
  ),
}));
vi.mock('@lexical/react/LexicalHistoryPlugin', () => ({ HistoryPlugin: () => null }));

let onChangePluginCallback: ((editorState: unknown, editor: unknown, tags: Set<string>) => void) | null = null;

vi.mock('@lexical/react/LexicalOnChangePlugin', () => ({
  OnChangePlugin: ({ onChange }: any) => {
    onChangePluginCallback = onChange;
    return null;
  },
}));
vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));
vi.mock('lexical', () => ({
  $getRoot: () => ({
    getTextContent: () => mockLexicalText,
    clear: () => {},
    append: () => {},
    getLastChild: () => null,
  }),
  $createParagraphNode: () => ({ append: () => {} }),
  $createTextNode: (text: string) => {
    createdTextNodes.push(text);
    return { text };
  },
  $getSelection: () => null,
  $isRangeSelection: () => false,
  $isTextNode: () => false,
  KEY_ENTER_COMMAND: 'enter',
  COMMAND_PRIORITY_HIGH: 1,
  LexicalEditor: class {},
}));

function openSlashMenu(filter = ''): void {
  fireEvent.keyDown(capturedRootElement, { key: '/' });
  act(() => {
    mockLexicalText = '/';
    onChangePluginCallback?.({}, mockEditor, new Set());
  });
  if (filter) {
    act(() => {
      mockLexicalText = `/${filter}`;
      onChangePluginCallback?.({}, mockEditor, new Set());
    });
  }
}

const skillsResponse = {
  skills: [
    { name: 'pan-consolidate-conversations', description: 'Take over every open conversation.', enabled: true },
    { name: 'grilling', description: 'Grill.', enabled: false },
  ],
};

describe('ComposerPromptEditor skills group (PAN-5347)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    capturedRootElement = undefined as unknown as HTMLDivElement;
    mockLexicalText = '/';
    createdTextNodes = [];
    onChangePluginCallback = null;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a Skills header with the enabled skill and hides the disabled one, filtered by pan-cons', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => skillsResponse });
    render(
      <ComposerPromptEditor
        conversationName="test-conversation"
        onCommandKeyDown={vi.fn()}
        skillContext={{ conversationName: 'conv-skills' }}
      />,
    );

    openSlashMenu('pan-cons');

    await waitFor(() => expect(screen.getByText('Skills')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /pan-cons\s*olidate-conversations/i })).toBeInTheDocument();
    expect(screen.getByText('Take over every open conversation.')).toBeInTheDocument();
    expect(screen.queryByText('grilling')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/overrides?conversation=conv-skills', expect.anything());
  });

  it('selects the skill command, replacing the editor text and closing the menu', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => skillsResponse });
    const editorRef = { current: mockEditor } as unknown as React.RefObject<import('lexical').LexicalEditor | null>;
    render(
      <ComposerPromptEditor
        conversationName="test-conversation"
        onCommandKeyDown={vi.fn()}
        skillContext={{ conversationName: 'conv-skills' }}
        editorRef={editorRef}
      />,
    );

    openSlashMenu('pan-cons');
    await waitFor(() => expect(screen.getByRole('option', { name: /pan-cons\s*olidate-conversations/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('option', { name: /pan-cons\s*olidate-conversations/i }));

    expect(createdTextNodes.at(-1)).toBe('/pan-consolidate-conversations ');
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
  });

  it('never shows a Skills header or calls fetch for an incapable harness', async () => {
    render(
      <ComposerPromptEditor
        conversationName="test-conversation"
        onCommandKeyDown={vi.fn()}
        harness="codex"
        skillContext={{ conversationName: 'conv-skills' }}
      />,
    );

    openSlashMenu();

    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    expect(screen.queryByText('Skills')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still renders /model under Claude Code native when the skill fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <ComposerPromptEditor
        conversationName="test-conversation"
        onCommandKeyDown={vi.fn()}
        skillContext={{ conversationName: 'conv-skills' }}
      />,
    );

    openSlashMenu();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(screen.getByText('Claude Code native')).toBeInTheDocument();
    expect(screen.getByText('/model')).toBeInTheDocument();
    expect(screen.queryByText('Skills')).not.toBeInTheDocument();
  });
});
