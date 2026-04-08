/**
 * ComposerPromptEditor slash menu tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComposerPromptEditor } from '../ComposerPromptEditor';

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

// Capture the root element so we can fire keydown events on it
let capturedRootElement: HTMLDivElement;

const mockEditor = {
  registerCommand: vi.fn(() => () => {}),
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
  getBoundingClientRect: vi.fn(() => ({ bottom: 100, left: 50 })),
};
const mockSelection = {
  rangeCount: 1,
  getRangeAt: vi.fn(() => mockRange),
};
vi.stubGlobal('getSelection', vi.fn(() => mockSelection));

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
  OnChangePlugin: () => null,
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

describe('ComposerPromptEditor', () => {
  const mockOnCommandKeyDown = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    capturedRootElement = undefined as unknown as HTMLDivElement;
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
      fireEvent.keyDown(capturedRootElement, { key: '/' });

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

      fireEvent.keyDown(capturedRootElement, { key: '/' });
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
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

      // Click outside (on body, which is definitely outside the menu)
      fireEvent.mouseDown(document.body);

      expect(
        screen.queryByRole('listbox', { name: 'Slash commands' }),
      ).not.toBeInTheDocument();
    });
  });
});
