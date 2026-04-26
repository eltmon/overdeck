/**
 * ComposerPromptEditor slash menu tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ComposerPromptEditor, SlashMenu, type SlashCommand } from '../ComposerPromptEditor';

// Mock the CSS module — must match class names used in ComposerPromptEditor
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

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Capture the root element so we can fire keydown events on it
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

// Mock window.getSelection / Range
const mockRange = {
  getBoundingClientRect: vi.fn(() => ({ top: 80, bottom: 100, left: 50, right: 50, width: 0, height: 20 })),
};
const mockSelection = {
  rangeCount: 1,
  getRangeAt: vi.fn(() => mockRange),
};
vi.stubGlobal('getSelection', vi.fn(() => mockSelection));

let mockLexicalText = '/';

// Mock Lexical
vi.mock('@lexical/react/LexicalComposer', () => ({
  LexicalComposer: ({ children }: any) => <div data-testid="lexical-composer">{children}</div>,
}));

vi.mock('@lexical/react/LexicalPlainTextPlugin', () => ({
  PlainTextPlugin: ({ contentEditable }: any) => (
    <div data-testid="plain-text-plugin">{contentEditable}</div>
  ),
}));

vi.mock('@lexical/react/LexicalContentEditable', () => ({
  ContentEditable: ({ className, 'aria-placeholder': ariaPlaceholder }: any) => (
    <div
      data-testid="contenteditable"
      className={className}
      contentEditable
      aria-placeholder={ariaPlaceholder}
    />
  ),
}));

vi.mock('@lexical/react/LexicalHistoryPlugin', () => ({
  HistoryPlugin: () => null,
}));

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
  $createParagraphNode: () => ({
    append: () => {},
  }),
  $createTextNode: (text: string) => ({ text }),
  KEY_ENTER_COMMAND: 'enter',
  COMMAND_PRIORITY_HIGH: 1,
  LexicalEditor: class {},
}));

// Test commands — mirrors SLASH_COMMANDS from ComposerPromptEditor
const TEST_COMMANDS: SlashCommand[] = [
  { id: 'model', label: '/model', description: 'Switch the AI model for this conversation', insert: '/model ' },
  { id: 'context', label: '/context', description: 'Add context from a file or URL', insert: '/context ' },
  { id: 'effort', label: '/effort', description: 'Set effort level (low, medium, high)', insert: '/effort ' },
  { id: 'cancel', label: '/cancel', description: 'Cancel the current operation', insert: '/cancel' },
];

const noop = () => {};

describe('ComposerPromptEditor', () => {
  const mockOnCommandKeyDown = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    capturedRootElement = undefined as unknown as HTMLDivElement;
    mockLexicalText = '/';
    onChangePluginCallback = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <ComposerPromptEditor
        conversationName="test-conversation"
        onCommandKeyDown={mockOnCommandKeyDown}
      />,
    );
    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });

  it('renders with placeholder text', () => {
    render(
      <ComposerPromptEditor
        conversationName="test-conversation"
        onCommandKeyDown={mockOnCommandKeyDown}
        placeholder="Type a message..."
      />,
    );
  });

  it('accepts disabled prop', () => {
    render(
      <ComposerPromptEditor
        conversationName="test-conversation"
        onCommandKeyDown={mockOnCommandKeyDown}
        disabled={true}
      />,
    );
  });

  describe('slash menu', () => {
    it('does not show slash menu by default', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );
      expect(
        screen.queryByRole('listbox', { name: 'Slash commands' }),
      ).not.toBeInTheDocument();
    });

    it('opens slash menu when / key is pressed in editor', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });

      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    });

    it('shows all slash commands in the menu', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });

      const menu = screen.getByRole('listbox', { name: 'Slash commands' });
      expect(menu).toBeInTheDocument();
      expect(screen.getByText('/model')).toBeInTheDocument();
      expect(screen.getByText('/context')).toBeInTheDocument();
      expect(screen.getByText('/effort')).toBeInTheDocument();
      expect(screen.getByText('/cancel')).toBeInTheDocument();
    });

    it('falls back to the editor bounds when the caret rect is empty for the first slash', () => {
      mockRange.getBoundingClientRect.mockReturnValueOnce({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
      });
      const rootRect = {
        top: 120,
        bottom: 156,
        left: 24,
        right: 424,
        width: 400,
        height: 36,
        x: 24,
        y: 120,
        toJSON: () => ({}),
      } as DOMRect;
      const getRootRect = vi.fn(() => rootRect);

      capturedRootElement = document.createElement('div');
      capturedRootElement.contentEditable = 'true';
      capturedRootElement.getBoundingClientRect = getRootRect;

      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });

      const menu = screen.getByRole('listbox', { name: 'Slash commands' });
      expect(menu).toBeInTheDocument();
      expect(getRootRect).toHaveBeenCalled();
      expect(menu).toHaveStyle({ left: '24px' });
    });

    it('closes menu on Escape', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

      // Escape handler is on document
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(
        screen.queryByRole('listbox', { name: 'Slash commands' }),
      ).not.toBeInTheDocument();
    });

    it('closes menu when clicking outside the menu', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

      // Click outside (on body, which is definitely outside the menu)
      fireEvent.mouseDown(document.body);

      expect(
        screen.queryByRole('listbox', { name: 'Slash commands' }),
      ).not.toBeInTheDocument();
    });

    it('selects /model command and closes the menu', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

      // Click /model button
      fireEvent.click(screen.getByText('/model'));

      // Menu should close after selection
      expect(
        screen.queryByRole('listbox', { name: 'Slash commands' }),
      ).not.toBeInTheDocument();
    });

    it('navigates down with ArrowDown', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

      // Initially /model is selected (index 0)
      expect(screen.getByText('/model').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowDown → /context selected
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(screen.getByText('/context').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowDown → /effort selected
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(screen.getByText('/effort').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowDown → /cancel selected
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(screen.getByText('/cancel').closest('button')).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates up with ArrowUp', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      fireEvent.keyDown(capturedRootElement, { key: '/' });
      act(() => {
        mockLexicalText = '/';
        onChangePluginCallback?.({}, mockEditor, new Set());
      });

      // Navigate forward to /cancel (index 3)
      act(() => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
      act(() => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
      act(() => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
      expect(screen.getByText('/cancel').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowUp → /effort
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowUp' });
      });
      expect(screen.getByText('/effort').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowUp → /context
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowUp' });
      });
      expect(screen.getByText('/context').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowUp → /model
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowUp' });
      });
      expect(screen.getByText('/model').closest('button')).toHaveAttribute('aria-selected', 'true');
    });
  });
});

describe('SlashMenu filter', () => {
  it('shows all commands when filter is empty', () => {
    render(
      <SlashMenu
        commands={TEST_COMMANDS}
        filter=""
        selectedIndex={0}
        onSelect={noop}
        onClose={noop}
        anchorRect={null}
      />,
    );

    expect(screen.getByText('/model')).toBeInTheDocument();
    expect(screen.getByText('/context')).toBeInTheDocument();
    expect(screen.getByText('/effort')).toBeInTheDocument();
    expect(screen.getByText('/cancel')).toBeInTheDocument();
  });

  it('filters commands by label when user types', () => {
    render(
      <SlashMenu
        commands={TEST_COMMANDS}
        filter="ext"
        selectedIndex={0}
        onSelect={noop}
        onClose={noop}
        anchorRect={null}
      />,
    );

    // 'ext' matches /context label only (via '/context' → '/conte**xt**')
    expect(screen.queryByText('/model')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /context/i })).toBeInTheDocument();
    expect(screen.queryByText('/effort')).not.toBeInTheDocument();
    expect(screen.queryByText('/cancel')).not.toBeInTheDocument();
  });

  it('filters commands by description when label does not match', () => {
    render(
      <SlashMenu
        commands={TEST_COMMANDS}
        filter="cancel"
        selectedIndex={0}
        onSelect={noop}
        onClose={noop}
        anchorRect={null}
      />,
    );

    // 'cancel' matches /cancel label and 'Cancel the current operation' description
    expect(screen.getByRole('option', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryByText('/model')).not.toBeInTheDocument();
  });

  it('returns null when no commands match the filter', () => {
    render(
      <SlashMenu
        commands={TEST_COMMANDS}
        filter="zzz"
        selectedIndex={0}
        onSelect={noop}
        onClose={noop}
        anchorRect={null}
      />,
    );

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('is case-insensitive when filtering', () => {
    render(
      <SlashMenu
        commands={TEST_COMMANDS}
        filter="ILE"
        selectedIndex={0}
        onSelect={noop}
        onClose={noop}
        anchorRect={null}
      />,
    );

    // 'ILE' (case-insensitive) matches /context via "fILE"
    expect(screen.getByText('/context')).toBeInTheDocument();
    expect(screen.queryByText('/model')).not.toBeInTheDocument();
  });

  it('highlights label matches', () => {
    render(
      <SlashMenu
        commands={TEST_COMMANDS}
        filter="ext"
        selectedIndex={0}
        onSelect={noop}
        onClose={noop}
        anchorRect={null}
      />,
    );

    const match = document.querySelector('mark');
    expect(match).not.toBeNull();
    expect(match?.textContent).toBe('ext');
    expect(match).toHaveClass('slashMenuMatch');
  });

  it('highlights description matches when label does not match', () => {
    render(
      <SlashMenu
        commands={TEST_COMMANDS}
        filter="file"
        selectedIndex={0}
        onSelect={noop}
        onClose={noop}
        anchorRect={null}
      />,
    );

    const match = document.querySelector('mark');
    expect(match).not.toBeNull();
    expect(match?.textContent?.toLowerCase()).toContain('file');
    expect(match).toHaveClass('slashMenuMatch');
  });
});
