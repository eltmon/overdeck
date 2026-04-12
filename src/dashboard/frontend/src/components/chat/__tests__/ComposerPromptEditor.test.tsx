/**
 * ComposerPromptEditor slash menu tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ComposerPromptEditor, SlashMenu, type SlashCommand } from '../ComposerPromptEditor';

// Mock the CSS module — must match class names used in ComposerPromptEditor
vi.mock('../MissionControl/styles/mission-control.module.css', () => ({
  composerEditor: 'composerEditor',
  composerEditorDisabled: 'composerEditorDisabled',
  composerEditable: 'composerEditable',
  composerPlaceholder: 'composerPlaceholder',
  slashMenu: 'slashMenu',
  slashMenuItem: 'slashMenuItem',
  slashMenuItemSelected: 'slashMenuItemSelected',
  slashMenuLabel: 'slashMenuLabel',
  slashMenuDescription: 'slashMenuDescription',
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Capture the OnChangePlugin onChange callback so tests can trigger slash menu
let capturedOnChange: (() => void) | null = null;

const mockEditor = {
  registerCommand: vi.fn(() => () => {}),
  read: vi.fn((cb: () => void) => cb()),
};

// Mock window.getSelection / Range
const mockRange = {
  getBoundingClientRect: vi.fn(() => ({ bottom: 100, left: 50 })),
};
const mockSelection = {
  rangeCount: 1,
  getRangeAt: vi.fn(() => mockRange),
};
vi.stubGlobal('getSelection', vi.fn(() => mockSelection));

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

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

vi.mock('@lexical/react/LexicalOnChangePlugin', () => ({
  OnChangePlugin: ({ onChange }: { onChange: () => void }) => {
    capturedOnChange = onChange;
    return null;
  },
}));

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));

vi.mock('lexical', () => ({
  $getRoot: () => ({
    getTextContent: () => '/',
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
    capturedOnChange = null;
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

      // Fire / keydown on the root element (where the listener is registered)
      act(() => { capturedOnChange?.(); });

      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    });

    it('shows all slash commands in the menu', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      act(() => { capturedOnChange?.(); });

      const menu = screen.getByRole('listbox', { name: 'Slash commands' });
      expect(menu).toBeInTheDocument();
      expect(screen.getByText('/model')).toBeInTheDocument();
      expect(screen.getByText('/context')).toBeInTheDocument();
      expect(screen.getByText('/effort')).toBeInTheDocument();
      expect(screen.getByText('/cancel')).toBeInTheDocument();
    });

    it('closes menu on Escape', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      act(() => { capturedOnChange?.(); });
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

      act(() => { capturedOnChange?.(); });
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

      act(() => { capturedOnChange?.(); });
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

      // Click /model button
      fireEvent.click(screen.getByText('/model'));

      // Menu should close after selection
      expect(
        screen.queryByRole('listbox', { name: 'Slash commands' }),
      ).not.toBeInTheDocument();
    });

    it('navigates down with ArrowDown through sequential commands', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      act(() => { capturedOnChange?.(); });
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

      // Initially /model is selected (index 0)
      expect(screen.getByText('/model').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowDown → /context selected (index 1)
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(screen.getByText('/context').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowDown → /effort selected (index 2)
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(screen.getByText('/effort').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowDown → /cancel selected (index 3)
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(screen.getByText('/cancel').closest('button')).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates up with ArrowUp through sequential commands', () => {
      render(
        <ComposerPromptEditor
          conversationName="test-conversation"
          onCommandKeyDown={mockOnCommandKeyDown}
        />,
      );

      act(() => { capturedOnChange?.(); });

      // Initially /model is selected (index 0)
      expect(screen.getByText('/model').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowDown to /context
      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(screen.getByText('/context').closest('button')).toHaveAttribute('aria-selected', 'true');

      // ArrowUp → wraps back to /model
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
    expect(screen.getByText('/context')).toBeInTheDocument();
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
    expect(screen.getByText('/cancel')).toBeInTheDocument();
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
});
