import { describe, expect, it } from 'vitest';
import type { ChangeCommit, ConversationChanges, UncommittedFile } from '@overdeck/contracts';

import { turnChangesByAnchor, userTurns } from '../turnChanges';

// PAN-5295 WI-2: the turn card groups a conversation's changes by user turn.

type Role = 'user' | 'assistant' | 'system';

function msg(id: string, role: Role, minute: number) {
  return { id, role, createdAt: `2026-11-15T10:${String(minute).padStart(2, '0')}:00Z` };
}

const file = (path: string, additions = 1, deletions = 0) => ({ path, status: 'M' as const, additions, deletions });

function uncommitted(path: string, turnIds: string[]): UncommittedFile {
  return { ...file(path), attribution: 'lines', turnIds };
}

function commit(sha: string, turnId: string | undefined, paths: string[], pushed = true): ChangeCommit {
  return {
    sha,
    shortSha: sha,
    subject: sha,
    authoredAt: '2026-11-15T10:00:00Z',
    pushed,
    attribution: 'trailer',
    files: paths.map((p) => file(p)),
    ...(turnId ? { turnId } : {}),
  };
}

function changes(over: Partial<ConversationChanges> = {}): ConversationChanges {
  return {
    conversation: 'c1',
    repoRoot: '/r',
    rootId: null,
    branch: 'main',
    scope: 'conversation',
    uncommitted: [],
    commits: [],
    totals: { files: 0, additions: 0, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 0 },
    ...over,
  };
}

describe('userTurns', () => {
  it('groups assistant messages before any user message into one turn', () => {
    expect(userTurns([msg('a1', 'assistant', 1), msg('a2', 'assistant', 2), msg('u1', 'user', 3), msg('a3', 'assistant', 4)])).toEqual([
      { anchorId: 'a2', assistantIds: ['a1', 'a2'] },
      { anchorId: 'a3', assistantIds: ['a3'] },
    ]);
  });

  it('does not split a turn at a system message and orders by createdAt', () => {
    expect(userTurns([msg('a2', 'assistant', 4), msg('u1', 'user', 1), msg('s1', 'system', 3), msg('a1', 'assistant', 2)])).toEqual([
      { anchorId: 'a2', assistantIds: ['a1', 'a2'] },
    ]);
  });
});

describe('turnChangesByAnchor', () => {
  const messages = [msg('u1', 'user', 1), msg('a1', 'assistant', 2), msg('a2', 'assistant', 3), msg('u2', 'user', 4), msg('a3', 'assistant', 5)];

  it('puts a mid-turn uncommitted edit and an end-of-turn commit in one card under the last assistant id', () => {
    const cards = turnChangesByAnchor(
      messages,
      changes({ uncommitted: [uncommitted('docs/a.md', ['a1'])], commits: [commit('c1', 'a2', ['src/b.ts'])] }),
    );
    expect([...cards.keys()]).toEqual(['a2']);
    const card = cards.get('a2')!;
    expect(card.assistantIds).toEqual(['a1', 'a2']);
    expect(card.rows.map((row) => row.file.path)).toEqual(['docs/a.md', 'src/b.ts']);
    expect(card).toMatchObject({ files: 2, additions: 2, deletions: 0, commitsPushed: 1, commitsLocal: 0, uncommittedFiles: 1 });
  });

  it('does not split a turn at a system message', () => {
    const withSystem = [msg('u1', 'user', 1), msg('a1', 'assistant', 2), msg('s1', 'system', 3), msg('a2', 'assistant', 4)];
    const cards = turnChangesByAnchor(withSystem, changes({ commits: [commit('c1', 'a1', ['x.ts']), commit('c2', 'a2', ['y.ts'], false)] }));
    expect([...cards.keys()]).toEqual(['a2']);
    expect(cards.get('a2')).toMatchObject({ files: 2, commitsPushed: 1, commitsLocal: 1 });
  });

  it('gives two user turns two cards', () => {
    const cards = turnChangesByAnchor(messages, changes({ commits: [commit('c1', 'a1', ['x.ts']), commit('c2', 'a3', ['y.ts'])] }));
    expect([...cards.keys()]).toEqual(['a2', 'a3']);
  });

  it('shows a path both committed and uncommitted once, as the uncommitted row', () => {
    const cards = turnChangesByAnchor(
      messages,
      changes({ uncommitted: [uncommitted('x.ts', ['a2'])], commits: [commit('c1', 'a2', ['x.ts', 'y.ts'])] }),
    );
    const rows = cards.get('a2')!.rows;
    expect(rows.map((row) => [row.file.path, row.uncommitted ? 'work' : row.commit?.sha])).toEqual([
      ['x.ts', 'work'],
      ['y.ts', 'c1'],
    ]);
    expect(cards.get('a2')!.uncommittedFiles).toBe(1);
  });

  it('leaves out a turn with no changes and ignores commits with no turn id', () => {
    const cards = turnChangesByAnchor(messages, changes({ commits: [commit('c1', 'a3', ['x.ts']), commit('c2', undefined, ['y.ts'])] }));
    expect(cards.has('a2')).toBe(false);
    expect(cards.get('a3')!.rows.map((row) => row.file.path)).toEqual(['x.ts']);
  });

  it('returns an empty map for null changes', () => {
    expect(turnChangesByAnchor(messages, null).size).toBe(0);
  });
});
