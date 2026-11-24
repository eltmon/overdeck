/**
 * PAN-5662 WI-5: the composer's @ File menu. Lexical is mocked with a fake
 * collapsed caret inside one fake text node; useFileMentionItems is mocked
 * with fixed rows, so no timers or RPC are involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

const COMPOSER_PATH = 'src/dashboard/frontend/src/components/chat/ComposerPromptEditor.tsx';

const fileMentionCalls = vi.hoisted(() => [] as Array<[string | null, string | null]>);
vi.mock('../useFileMentionItems', async () => {
  const { toFileMentionItems } = await import('../composerTriggers');
  const items = toFileMentionItems(['src/dashboard/frontend/src/components/chat/ComposerPromptEditor.tsx']);
  return {
    useFileMentionItems: (rootId: string | null, filter: string | null) => {
      fileMentionCalls.push([rootId, filter]);
      return { items: rootId && filter ? items : [] };
    },
  };
});

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

vi.stubGlobal('getSelection', vi.fn(() => ({
  rangeCount: 1,
  getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 80, bottom: 100, left: 50, right: 50, width: 0, height: 20 }) }),
})));

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

function renderEditor(fileRootId?: string | null) {
  return render(
    <ComposerPromptEditor conversationName="test-conversation" onCommandKeyDown={vi.fn()} fileRootId={fileRootId} />,
  );
}

describe('ComposerPromptEditor @ File menu (PAN-5662)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    capturedRootElement = undefined as unknown as HTMLDivElement;
    caretText = '';
    onChangePluginCallback = null;
    fileMentionCalls.length = 0;
  });

  it('lists matching files with name and directory for @comp', () => {
    renderEditor('project:overdeck');
    type('@comp');

    const menu = screen.getByRole('listbox', { name: 'Files' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Comp\s*oserPromptEditor\.tsx/ })).toBeInTheDocument();
    expect(screen.getByText('src/dashboard/frontend/src/components/chat')).toBeInTheDocument();
    expect(fileMentionCalls.at(-1)).toEqual(['project:overdeck', 'comp']);
  });

  it('splices the root-relative path over the token on Enter', () => {
    renderEditor('project:overdeck');
    type('@comp');

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(spliceText).toHaveBeenCalledWith(0, 5, `@${COMPOSER_PATH} `, true);
  });

  it('splices on Tab too, keeping text before the token', () => {
    renderEditor('project:overdeck');
    type('see @comp');

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(spliceText).toHaveBeenCalledWith(4, 5, `@${COMPOSER_PATH} `, true);
  });

  it('shows no Files menu for an @ inside a word', () => {
    renderEditor('project:overdeck');
    type('foo@bar.com');

    expect(screen.queryByRole('listbox', { name: 'Files' })).not.toBeInTheDocument();
  });

  it('shows no Files menu without an explorer root', () => {
    renderEditor(null);
    type('@comp');

    expect(screen.queryByRole('listbox', { name: 'Files' })).not.toBeInTheDocument();
  });

  it('closes on Escape and stays closed while the same token remains', () => {
    renderEditor('project:overdeck');
    type('@comp');
    expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Files' })).not.toBeInTheDocument();

    type('@compo');
    expect(screen.queryByRole('listbox', { name: 'Files' })).not.toBeInTheDocument();

    // A new token at another index opens again.
    type('@compo @comp');
    expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument();
  });

  it('shows the search hint for a bare @', () => {
    renderEditor('project:overdeck');
    type('@');

    expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText('Type to search files')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('hides the slash menu while an @ token is live', () => {
    renderEditor('project:overdeck');
    fireEvent.keyDown(capturedRootElement, { key: '/' });
    type('/');
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    type('/review @comp');
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument();
  });
});
