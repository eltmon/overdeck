/**
 * PAN-4485: chain-ownership module — pure, injected lookup, no database.
 */
import { describe, expect, it } from 'vitest';
import { isSupersededConversation, resolveClearChainHead, sessionOwners } from '../conversation-clear-chain.js';

interface Row {
  id: number;
  tmuxSession: string;
  clearedToConvId: number | null;
  archivedAt: string | null;
}

function row(partial: Partial<Row> & { id: number }): Row {
  return { tmuxSession: 'conv-p', clearedToConvId: null, archivedAt: null, ...partial };
}

function lookupFrom(rows: Row[]): (id: number) => Row | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (id: number) => byId.get(id) ?? null;
}

describe('isSupersededConversation', () => {
  it('is true when clearedToConvId is set, false otherwise', () => {
    expect(isSupersededConversation(row({ id: 1, clearedToConvId: 2 }))).toBe(true);
    expect(isSupersededConversation(row({ id: 1 }))).toBe(false);
  });
});

describe('resolveClearChainHead', () => {
  it('returns the same row when clearedToConvId is null', () => {
    const parent = row({ id: 1 });
    expect(resolveClearChainHead(parent, lookupFrom([parent]))).toBe(parent);
  });

  it('follows parent -> sibling -> sibling-2 on one tmuxSession to the newest row', () => {
    const parent = row({ id: 1, clearedToConvId: 2 });
    const sibling = row({ id: 2, clearedToConvId: 3 });
    const sibling2 = row({ id: 3 });
    const lookup = lookupFrom([parent, sibling, sibling2]);

    expect(resolveClearChainHead(parent, lookup)).toBe(sibling2);
  });

  it('returns null when the link target is missing', () => {
    const parent = row({ id: 1, clearedToConvId: 2 });
    expect(resolveClearChainHead(parent, lookupFrom([parent]))).toBeNull();
  });

  it('returns null when the link target is archived', () => {
    const parent = row({ id: 1, clearedToConvId: 2 });
    const sibling = row({ id: 2, archivedAt: '2026-01-01T00:00:00Z' });
    expect(resolveClearChainHead(parent, lookupFrom([parent, sibling]))).toBeNull();
  });

  it('returns null when the link target is on a different tmuxSession', () => {
    const parent = row({ id: 1, clearedToConvId: 2, tmuxSession: 'conv-a' });
    const sibling = row({ id: 2, tmuxSession: 'conv-b' });
    expect(resolveClearChainHead(parent, lookupFrom([parent, sibling]))).toBeNull();
  });

  it('returns null on a cycle', () => {
    const a = row({ id: 1, clearedToConvId: 2 });
    const b = row({ id: 2, clearedToConvId: 1 });
    expect(resolveClearChainHead(a, lookupFrom([a, b]))).toBeNull();
  });
});

describe('sessionOwners', () => {
  it('drops superseded rows and keeps the first row per tmuxSession', () => {
    const parent = row({ id: 1, clearedToConvId: 2, tmuxSession: 'conv-p' });
    const sibling = row({ id: 2, tmuxSession: 'conv-p' });
    const other = row({ id: 3, tmuxSession: 'conv-q' });

    expect(sessionOwners([parent, sibling, other])).toEqual([sibling, other]);
  });
});
