import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkLogEntry } from '../../chat-types';
import { clearToolBodyCacheForTests, ToolBodyLoaderContext, toolBodyLoaderFor } from '../toolBodyLoader';
import { WorkLogGroup } from '../workLogRows';

// PAN-5295: a test can render the real ChatMarkdown to reach the path chips.
const chatMarkdownMode = vi.hoisted(() => ({ real: false }));
vi.mock('../../ChatMarkdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ChatMarkdown')>();
  return {
    ChatMarkdown: (props: { text: string; cwd?: string; issueId?: string | null }) =>
      chatMarkdownMode.real ? <actual.ChatMarkdown {...props} /> : <div data-testid="chat-markdown">{props.text}</div>,
  };
});
// The real ChatMarkdown asks the server whether a path exists before it renders a chip.
vi.mock('../../../../hooks/useFilePathExists', () => ({ useFilePathExists: () => ({ state: 'exists' }) }));
const changesCtxMock = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../conversationChanges/ConversationChangesScope', () => ({
  useConversationChangesContext: () => changesCtxMock.value,
}));

const omitted: WorkLogEntry = {
  id: 'toolu_big',
  createdAt: '2026-10-19T00:00:00.000Z',
  label: 'Read',
  tone: 'tool',
  toolTitle: 'Read',
  resultBytes: 20_480,
  bodyOmitted: true,
};

function renderWithLoader(children: ReactNode) {
  const loader = toolBodyLoaderFor('/api/conversations/conv-1/tool-body');
  return render(<ToolBodyLoaderContext.Provider value={loader}>{children}</ToolBodyLoaderContext.Provider>);
}

afterEach(() => {
  clearToolBodyCacheForTests();
  vi.unstubAllGlobals();
});

describe('tool rows with an omitted body (PAN-4558)', () => {
  it('shows the size hint and counts the row as having a result', () => {
    renderWithLoader(<WorkLogGroup entries={[omitted]} />);
    expect(screen.getByText('20 KB')).toBeInTheDocument();
  });

  it('fetches the full entry once on expand and renders its result', async () => {
    const fetchMock = vi.fn(async () => Response.json({ entry: { ...omitted, bodyOmitted: undefined, resultBytes: undefined, result: 'FULL RESULT TEXT' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLoader(<WorkLogGroup entries={[omitted]} />);

    fireEvent.click(screen.getByText('Read'));
    expect(screen.getByText('Loading full output…')).toBeInTheDocument();
    expect(await screen.findByText('FULL RESULT TEXT')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/conversations/conv-1/tool-body/toolu_big');

    // Collapse and expand again: served from the cache.
    fireEvent.click(screen.getByText('Read'));
    fireEvent.click(screen.getByText('Read'));
    expect(await screen.findByText('FULL RESULT TEXT')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says so when the full output cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Tool entry not found' }, { status: 404 })));
    renderWithLoader(<WorkLogGroup entries={[omitted]} />);
    fireEvent.click(screen.getByText('Read'));
    await waitFor(() => expect(screen.getByText('Could not load the full output.')).toBeInTheDocument());
  });

  it('does not fetch for a row that carries its result inline', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithLoader(<WorkLogGroup entries={[{ ...omitted, bodyOmitted: undefined, resultBytes: undefined, result: 'inline' }]} />);
    fireEvent.click(screen.getByText('Read'));
    expect(screen.getByText('inline')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('tool row path chips inside a Stage (PAN-5295)', () => {
  afterEach(() => {
    chatMarkdownMode.real = false;
    changesCtxMock.value = null;
  });

  it('opens the dock diff from an Edit row\'s path chip', async () => {
    chatMarkdownMode.real = true;
    const openDiff = vi.fn();
    changesCtxMock.value = {
      conversation: { name: 'c1' },
      changes: {
        conversation: 'c1', repoRoot: '/home/op/repo', rootId: null, branch: 'main', scope: 'conversation',
        uncommitted: [{ path: 'src/a.ts', status: 'M', additions: 1, deletions: 0, attribution: 'lines', turnIds: [] }],
        commits: [],
        totals: { files: 1, additions: 1, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 1 },
      },
      rootId: 'project:p',
      stage: {
        rootId: 'project:p',
        rootPathOf: (p: string) => p,
        repoPathOfAbs: (abs: string) => (abs.startsWith('/home/op/repo/') ? abs.slice('/home/op/repo/'.length) : null),
        openDiff, openBeside: vi.fn(), reveal: vi.fn(), showInFiles: vi.fn(),
      },
      openDiffWindow: vi.fn(),
    };
    const edit: WorkLogEntry = {
      id: 'toolu_edit', createdAt: '2026-10-19T00:00:00.000Z', label: 'Edit', tone: 'tool', toolTitle: 'Edit',
      toolInput: { file_path: '/home/op/repo/src/a.ts', old_string: 'a', new_string: 'b' }, result: 'The file /home/op/repo/src/a.ts has been updated.',
    };
    renderWithLoader(<WorkLogGroup entries={[edit]} cwd="/home/op/repo" />);

    fireEvent.click(screen.getByText('Edit'));
    // The path in the tool's output text is the chip; the input line stays plain code.
    fireEvent.click(await screen.findByTestId('markdown-file-link-label'));

    const target = { path: 'src/a.ts', repoPath: 'src/a.ts', repoRoot: '/home/op/repo' };
    expect(openDiff).toHaveBeenCalledWith(target, [target]);
  });
});
