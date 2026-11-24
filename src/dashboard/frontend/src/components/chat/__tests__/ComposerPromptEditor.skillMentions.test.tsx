/**
 * PAN-5662 WI-7: the composer's $ Skill menu. Lexical is mocked with a fake
 * collapsed caret inside one fake text node (as in the @ files test); fetch is
 * stubbed with the skills overrides response.
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
    slashMenuHint: 'slashMenuHint',
  },
}));

vi.mock('../useFileMentionItems', () => ({ useFileMentionItems: () => ({ items: [] }) }));

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

let capturedRootElement: HTMLDivElement;
let caretText = '';
const spliceText = vi.fn();
const fakeTextNode = {
  getTextContent: () => caretText,
  spliceText,
};
const fakeSelection = {
  isCollapsed: () => true,
  anchor: {
    getNode: () => fakeTextNode,
    get offset() { return caretText.length; },
  },
};

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

const getSelectionStub = vi.fn(() => ({
  rangeCount: 1,
  getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 80, bottom: 100, left: 50, right: 50, width: 0, height: 20 }) }),
}));
vi.stubGlobal('getSelection', getSelectionStub);

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
    getTextContent: () => caretText,
    clear: () => {},
    append: () => {},
    getLastChild: () => null,
  }),
  $createParagraphNode: () => ({ append: () => {} }),
  $createTextNode: (text: string) => ({ text }),
  $getSelection: () => fakeSelection,
  $isRangeSelection: (selection: unknown) => selection === fakeSelection,
  $isTextNode: (node: unknown) => node === fakeTextNode,
  KEY_ENTER_COMMAND: 'enter',
  COMMAND_PRIORITY_HIGH: 1,
  LexicalEditor: class {},
}));

function type(text: string): void {
  act(() => {
    caretText = text;
    onChangePluginCallback?.({}, mockEditor, new Set());
  });
}

function renderEditor(harness: 'claude-code' | 'codex' | 'pi') {
  return render(
    <ComposerPromptEditor
      conversationName="test-conversation"
      onCommandKeyDown={vi.fn()}
      harness={harness}
      skillContext={{ conversationName: 'conv-skills' }}
    />,
  );
}

const skillsResponse = {
  skills: [
    { name: 'pan-flywheel', description: 'Run the flywheel', enabled: true },
    { name: 'docx', enabled: false },
  ],
};

describe('ComposerPromptEditor $ Skill menu (PAN-5662)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    capturedRootElement = undefined as unknown as HTMLDivElement;
    caretText = '';
    onChangePluginCallback = null;
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => skillsResponse });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('getSelection', getSelectionStub);
  });

  it('claude-code lists skills as /<name> and inserts /pan-flywheel on Enter', async () => {
    renderEditor('claude-code');
    type('$');

    const option = await screen.findByRole('option', { name: /\/pan-flywheel/ });
    expect(screen.getByRole('listbox', { name: 'Skills' })).toBeInTheDocument();
    expect(option).toBeInTheDocument();
    expect(screen.queryByText('docx')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/overrides?conversation=conv-skills', expect.anything());

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(spliceText).toHaveBeenCalledWith(0, 1, '/pan-flywheel ', true);
  });

  it('codex lists skills as $<name> and inserts $pan-flywheel on Enter', async () => {
    renderEditor('codex');
    type('$');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    type('$fly');

    expect(await screen.findByRole('option', { name: /\$pan-\s*fly\s*wheel/ })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(spliceText).toHaveBeenCalledWith(0, 4, '$pan-flywheel ', true);
  });

  it.each(['echo $HOME', 'foo$bar'])('shows no Skills menu and fetches nothing for %s', async (text) => {
    renderEditor('claude-code');
    type(text);
    await act(async () => {});

    expect(screen.queryByRole('listbox', { name: 'Skills' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows no Skills menu and fetches nothing for a harness without a skill mention form', async () => {
    renderEditor('pi');
    type('$');
    await act(async () => {});

    expect(screen.queryByRole('listbox', { name: 'Skills' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
