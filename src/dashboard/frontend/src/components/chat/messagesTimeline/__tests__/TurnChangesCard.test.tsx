import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChangeCommit, ConversationChanges, UncommittedFile } from '@overdeck/contracts';

import type { ConversationChangesContextValue, StageChangeActions } from '../../conversationChanges/ConversationChangesScope';
import { TurnChangesCard } from '../TurnChangesCard';
import type { TurnChanges } from '../turnChanges';

// PAN-5295 WI-11: the turn card's counts, tags, rows and actions.

const ctxMock = vi.hoisted(() => ({ value: null as ConversationChangesContextValue | null }));
vi.mock('../../conversationChanges/ConversationChangesScope', () => ({
  useConversationChangesContext: () => ctxMock.value,
}));

const file = (path: string, additions: number, deletions = 0) => ({ path, status: 'M' as const, additions, deletions });
const uncommitted = (path: string, additions: number): UncommittedFile => ({ ...file(path, additions), attribution: 'lines', turnIds: ['a1'] });
const commit = (sha: string, files: ReturnType<typeof file>[]): ChangeCommit => ({
  sha, shortSha: sha, subject: sha, authoredAt: '2026-11-15T10:00:00Z', pushed: true, attribution: 'trailer', files, turnId: 'a1',
});

const CHANGES: ConversationChanges = {
  conversation: 'c1', repoRoot: '/repo', rootId: null, branch: 'main', scope: 'conversation',
  uncommitted: [], commits: [],
  totals: { files: 0, additions: 0, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 0 },
};

function turnOf(rows: TurnChanges['rows'], counts: Partial<TurnChanges> = {}): TurnChanges {
  return {
    anchorId: 'a1', assistantIds: ['a1'], rows,
    files: rows.length,
    additions: rows.reduce((n, r) => n + r.file.additions, 0),
    deletions: rows.reduce((n, r) => n + r.file.deletions, 0),
    commitsPushed: 0, commitsLocal: 0, uncommittedFiles: rows.filter((r) => r.uncommitted).length,
    ...counts,
  };
}

function stageActions(): StageChangeActions {
  return {
    rootId: 'project:p',
    rootPathOf: (p) => p,
    repoPathOfAbs: () => null,
    openDiff: vi.fn(),
    openBeside: vi.fn(),
    reveal: vi.fn(),
    showInFiles: vi.fn(),
  };
}

function setContext(stage: StageChangeActions | null) {
  const value = {
    conversation: { name: 'c1' },
    changes: CHANGES,
    rootId: stage ? stage.rootId : null,
    stage,
    openDiffWindow: vi.fn(),
  } as unknown as ConversationChangesContextValue;
  ctxMock.value = value;
  return value;
}

afterEach(() => {
  cleanup();
  ctxMock.value = null;
});

describe('TurnChangesCard', () => {
  const work = uncommitted('docs/notes.md', 6);
  const c1 = commit('c1', [file('src/app.ts', 80, 1)]);
  const turn = turnOf([{ file: work, uncommitted: work }, { file: c1.files[0]!, commit: c1 }], { additions: 86, deletions: 1, commitsPushed: 2 });

  it('shows the counts and tags, with amber only on not committed', () => {
    setContext(stageActions());
    render(<TurnChangesCard turn={turn} />);
    const card = screen.getByTestId('turn-changes-card');
    expect(card).toHaveTextContent('2 files changed');
    expect(card).toHaveTextContent('+86');
    expect(card).toHaveTextContent('−1');
    expect(within(card).getByText('2 commits pushed')).not.toHaveClass('badge-bg-state-needs-you');
    expect(within(card).getByText('1 not committed')).toHaveClass('badge-bg-state-needs-you');
    expect(card.querySelectorAll('.badge-bg-state-needs-you')).toHaveLength(1);
  });

  it('shows 8 of 10 rows and a Show all button that reveals the rest', () => {
    setContext(stageActions());
    const many = turnOf(Array.from({ length: 10 }, (_, i) => {
      const f = uncommitted(`f${i}.ts`, 1);
      return { file: f, uncommitted: f };
    }));
    render(<TurnChangesCard turn={many} />);
    expect(document.querySelectorAll('[data-change-path]')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10 files' }));
    expect(document.querySelectorAll('[data-change-path]')).toHaveLength(10);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('inside a Stage, Review opens the dock on the first file with the turn list, and Show in files filters', () => {
    const stage = stageActions();
    setContext(stage);
    render(<TurnChangesCard turn={turn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const first = { path: 'docs/notes.md', repoPath: 'docs/notes.md', repoRoot: '/repo' };
    const second = { path: 'src/app.ts', repoPath: 'src/app.ts', repoRoot: '/repo', sha: 'c1', pushed: true };
    expect(stage.openDiff).toHaveBeenLastCalledWith(first, [first, second]);
    fireEvent.click(screen.getByRole('button', { name: 'Show in files' }));
    expect(stage.showInFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('src/app.ts'));
    expect(stage.openDiff).toHaveBeenLastCalledWith(second, [first, second]);
    fireEvent.click(within(document.querySelector('[data-change-path="src/app.ts"]') as HTMLElement).getByRole('button', { name: 'Open the file beside the chat' }));
    expect(stage.openBeside).toHaveBeenLastCalledWith('src/app.ts');
    fireEvent.click(within(document.querySelector('[data-change-path="src/app.ts"]') as HTMLElement).getByRole('button', { name: 'Reveal in files' }));
    expect(stage.reveal).toHaveBeenLastCalledWith('src/app.ts');
  });

  it('outside a Stage, Review and rows open the diff window and Show in files is absent', () => {
    const ctx = setContext(null);
    render(<TurnChangesCard turn={turn} />);
    expect(screen.queryByRole('button', { name: 'Show in files' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(ctx.openDiffWindow).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByTitle('src/app.ts'));
    expect(ctx.openDiffWindow).toHaveBeenLastCalledWith('src/app.ts');
    expect(within(document.querySelector('[data-change-path="src/app.ts"]') as HTMLElement).getByRole('button', { name: 'Reveal in files' })).toBeDisabled();
  });

  it('renders nothing without a changes context', () => {
    render(<TurnChangesCard turn={turn} />);
    expect(screen.queryByTestId('turn-changes-card')).toBeNull();
  });
});
