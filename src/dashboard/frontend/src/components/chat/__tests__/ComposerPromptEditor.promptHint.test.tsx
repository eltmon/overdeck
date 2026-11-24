/**
 * PAN-5662 WI-8: the composer's default placeholder lists the triggers this
 * composer offers (@ files, $ skills, / commands); an explicit placeholder wins.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerPromptEditor } from '../ComposerPromptEditor';

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: {
    composerEditor: 'composerEditor',
    composerEditorDisabled: 'composerEditorDisabled',
    composerEditable: 'composerEditable',
    composerPlaceholder: 'composerPlaceholder',
  },
}));

vi.mock('../useFileMentionItems', () => ({ useFileMentionItems: () => ({ items: [] }) }));

const mockEditor = {
  registerCommand: vi.fn(() => () => {}),
  read: (fn: () => void) => fn(),
  update: (fn: () => void) => fn(),
  focus: vi.fn(),
  getRootElement: () => null,
};

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
vi.mock('@lexical/react/LexicalOnChangePlugin', () => ({ OnChangePlugin: () => null }));
vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));
vi.mock('lexical', () => ({
  $getRoot: () => ({ getTextContent: () => '', clear: () => {}, append: () => {}, getLastChild: () => null }),
  $createParagraphNode: () => ({ append: () => {} }),
  $createTextNode: (text: string) => ({ text }),
  $getSelection: () => null,
  $isRangeSelection: () => false,
  $isTextNode: () => false,
  KEY_ENTER_COMMAND: 'enter',
  COMMAND_PRIORITY_HIGH: 1,
  LexicalEditor: class {},
}));

const skillContext = { conversationName: 'conv-a' };

function placeholderOf(props: Partial<React.ComponentProps<typeof ComposerPromptEditor>>): string | null {
  render(<ComposerPromptEditor conversationName="test-conversation" onCommandKeyDown={vi.fn()} {...props} />);
  return screen.getByTestId('contenteditable').getAttribute('aria-placeholder');
}

describe('ComposerPromptEditor placeholder (PAN-5662)', () => {
  it('lists all three triggers for claude-code with a skill context and a file root', () => {
    expect(placeholderOf({ harness: 'claude-code', skillContext, fileRootId: 'project:overdeck' }))
      .toBe('Ask anything. @ files, $ skills, / commands');
  });

  it('omits @ files without a file root', () => {
    expect(placeholderOf({ harness: 'claude-code', skillContext })).toBe('Ask anything. $ skills, / commands');
  });

  it('omits $ skills for a harness without a skill mention form', () => {
    expect(placeholderOf({ harness: 'pi', skillContext, fileRootId: 'project:overdeck' }))
      .toBe('Ask anything. @ files, / commands');
  });

  it('keeps an explicit placeholder', () => {
    expect(placeholderOf({ harness: 'claude-code', skillContext, fileRootId: 'project:overdeck', placeholder: 'Message x…' }))
      .toBe('Message x…');
  });
});
