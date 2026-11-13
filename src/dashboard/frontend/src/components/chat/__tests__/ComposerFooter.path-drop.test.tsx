import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { resetComposerStore } from '../../../lib/composerStore';
import { insertPathsIntoComposer } from '../composerPathDrop';
import { EXPLORER_MOVE_MIME, EXPLORER_PATHS_MIME } from '../../../lib/explorer-drag-paths';

const { editorState, mockFocus } = vi.hoisted(() => ({
  editorState: { text: '', onCommandKeyDown: null as null | ((key: 'Enter' | 'SteerEnter') => void) },
  mockFocus: vi.fn(),
}));

vi.mock('../composerPathDrop', () => ({ insertPathsIntoComposer: vi.fn() }));

vi.mock('lexical', () => ({
  $getRoot: () => ({
    getTextContent: () => editorState.text,
    clear: () => {
      editorState.text = '';
    },
  }),
}));

vi.mock('../ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: ({ editorRef, onChange, disabled, onCommandKeyDown }: { editorRef: { current: unknown }; onChange: (value: string) => void; disabled: boolean; onCommandKeyDown: (key: 'Enter' | 'SteerEnter') => void }) => {
    editorState.onCommandKeyDown = onCommandKeyDown;
    editorRef.current = {
      read: (callback: () => void) => callback(),
      update: (callback: () => void) => callback(),
      focus: mockFocus,
    };

    return (
      <textarea
        aria-label="Composer editor"
        data-testid="composer-editor"
        disabled={disabled}
        onChange={(event) => {
          editorState.text = event.target.value;
          onChange(event.target.value);
        }}
      />
    );
  },
}));

vi.mock('../ModelPicker', () => ({
  ModelPicker: ({ value }: { value: string }) => <div data-testid="model-picker">{value}</div>,
  MODEL_EFFORT_SUPPORT: { 'claude-sonnet-4-6': ['low', 'medium', 'high'] },
  loadStoredHarness: () => 'claude-code',
  saveStoredHarness: vi.fn(),
  saveStoredModel: vi.fn(),
}));

vi.mock('../defaultConversationModel', () => ({
  getDefaultConversationModel: () => 'claude-sonnet-4-6',
}));

vi.mock('../EffortPicker', () => ({
  EffortPicker: () => <button type="button" data-testid="effort-picker" />,
  loadStoredEffort: () => 'medium',
}));

vi.mock('../VoiceWidget', () => ({
  VoiceWidget: () => <div data-testid="voice-widget" />,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../Settings/modelCatalog', () => ({
  modelSupportsImages: vi.fn(() => true),
  findModelDef: vi.fn(() => ({ name: 'Claude Sonnet 4.6' })),
}));

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

const conversation = {
  id: 1,
  name: 'test-conv',
  tmuxSession: 'conv-test-conv',
  status: 'active' as const,
  cwd: '/tmp/project',
  issueId: null,
  createdAt: '2026-04-18T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Test Conversation',
  model: 'claude-sonnet-4-6',
  effort: 'medium',
};

function pathDrag(paths: string[]) {
  const data: Record<string, string> = {
    [EXPLORER_PATHS_MIME]: paths.join('\n'),
    [EXPLORER_MOVE_MIME]: JSON.stringify({ rootId: 'issue:PAN-1', paths }),
  };
  return {
    types: Object.keys(data),
    items: [],
    files: [],
    dropEffect: 'none',
    getData: (type: string) => data[type] ?? '',
  };
}


function uploadCalls(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>): unknown[] {
  return fetchMock.mock.calls.filter((call) => /upload|attachment/i.test(String(call[0])));
}

describe('ComposerFooter explorer path drop (PAN-5190)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
    localStorage.clear();
    editorState.text = '';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('inserts dropped paths at the caret and enqueues no attachment', () => {
    render(<ComposerFooter conversation={conversation} />);
    const editor = screen.getByTestId('composer-editor');
    fireEvent.drop(editor, { dataTransfer: pathDrag(['src/a.ts', 'lib']) });
    expect(insertPathsIntoComposer).toHaveBeenCalledTimes(1);
    const [editorArg, paths] = vi.mocked(insertPathsIntoComposer).mock.calls[0]!;
    expect(editorArg).toEqual(expect.objectContaining({ focus: mockFocus }));
    expect(paths).toEqual(['src/a.ts', 'lib']);
    expect(uploadCalls(vi.mocked(fetch))).toEqual([]);
  });

  it('ignores a path drop when the session is not alive', () => {
    render(<ComposerFooter conversation={{ ...conversation, sessionAlive: false }} />);
    fireEvent.drop(screen.getByTestId('composer-editor'), { dataTransfer: pathDrag(['src/a.ts']) });
    expect(insertPathsIntoComposer).not.toHaveBeenCalled();
  });

  it('accepts a path drag on dragover', () => {
    render(<ComposerFooter conversation={conversation} />);
    const accepted = !fireEvent.dragOver(screen.getByTestId('composer-editor'), { dataTransfer: pathDrag(['src/a.ts']) });
    expect(accepted).toBe(true);
  });
});
