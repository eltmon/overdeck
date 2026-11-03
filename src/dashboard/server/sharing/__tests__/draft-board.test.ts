import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_PROMPT_MAX_CHARS, type DraftPayload, type ShareIdentity } from '@overdeck/contracts';

import { DRAFT_RELAY_MS, DraftBoard } from '../draft-board.js';

const alice: ShareIdentity = { githubId: 7, login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/7' };
const bob: ShareIdentity = { githubId: 8, login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/u/8' };

function setup() {
  const relays: DraftPayload[] = [];
  const board = new DraftBoard({ now: () => Date.now(), onRelay: (payload) => relays.push(payload) });
  return { board, relays };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DraftBoard', () => {
  it('relays the first update at once with the host clock', () => {
    const { board, relays } = setup();
    board.update(alice, 'hi');
    expect(relays).toEqual([{ authorGithubId: 7, authorLogin: 'alice', text: 'hi', updatedAt: 1_700_000_000_000 }]);
  });

  it('relays the first of three quick updates at once and the last at 200 ms', async () => {
    const { board, relays } = setup();
    board.update(alice, 'a');
    await vi.advanceTimersByTimeAsync(50);
    board.update(alice, 'ab');
    await vi.advanceTimersByTimeAsync(50);
    board.update(alice, 'abc');
    expect(relays.map((relay) => relay.text)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(DRAFT_RELAY_MS - 101);
    expect(relays).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relays.map((relay) => relay.text)).toEqual(['a', 'abc']);
    await vi.advanceTimersByTimeAsync(DRAFT_RELAY_MS * 3);
    expect(relays).toHaveLength(2);
  });

  it('throttles each author separately', () => {
    const { board, relays } = setup();
    board.update(alice, 'a');
    board.update(bob, 'b');
    expect(relays.map((relay) => relay.authorGithubId)).toEqual([7, 8]);
  });

  it('deletes a draft on an empty text and relays text ""', async () => {
    const { board, relays } = setup();
    board.update(alice, 'hi');
    await vi.advanceTimersByTimeAsync(DRAFT_RELAY_MS);
    board.update(alice, '');
    expect(relays.at(-1)).toMatchObject({ authorGithubId: 7, authorLogin: 'alice', text: '' });
    expect(board.list()).toEqual([]);
  });

  it('ignores a text longer than the cap', () => {
    const { board, relays } = setup();
    board.update(alice, 'hi');
    board.update(alice, 'a'.repeat(SHARED_PROMPT_MAX_CHARS + 1));
    expect(relays).toHaveLength(1);
    expect(board.list().map((draft) => draft.text)).toEqual(['hi']);
  });

  it('keeps startedAt while updatedAt moves', async () => {
    const { board } = setup();
    board.update(alice, 'a');
    await vi.advanceTimersByTimeAsync(1_000);
    board.update(alice, 'ab');
    const [draft] = board.list();
    expect(draft?.startedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(draft?.updatedAt).toBe(new Date(1_700_000_001_000).toISOString());
  });

  it('lists drafts oldest started first', async () => {
    const { board } = setup();
    board.update(bob, 'b');
    await vi.advanceTimersByTimeAsync(10);
    board.update(alice, 'a');
    await vi.advanceTimersByTimeAsync(500);
    board.update(bob, 'bb');
    expect(board.list().map((draft) => draft.login)).toEqual(['bob', 'alice']);
    expect(board.payloads().map((payload) => payload.authorLogin)).toEqual(['bob', 'alice']);
  });

  it('remove and take relay "" at once with no throttle', () => {
    const { board, relays } = setup();
    board.update(alice, 'a');
    board.update(bob, 'b');
    board.remove(7);
    expect(relays.at(-1)).toMatchObject({ authorGithubId: 7, text: '' });
    const taken = board.take(8);
    expect(taken).toMatchObject({ githubId: 8, login: 'bob', text: 'b' });
    expect(relays.at(-1)).toMatchObject({ authorGithubId: 8, text: '' });
    expect(relays).toHaveLength(4);
    expect(board.take(8)).toBeNull();
    expect(relays).toHaveLength(4);
  });

  it('relays nothing for an empty update from an author with no draft', () => {
    const { board, relays } = setup();
    board.update(alice, '');
    expect(relays).toEqual([]);
  });

  it('close() cancels a pending trailing relay', async () => {
    const { board, relays } = setup();
    board.update(alice, 'a');
    board.update(alice, 'ab');
    board.close();
    await vi.advanceTimersByTimeAsync(DRAFT_RELAY_MS * 2);
    expect(relays).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
