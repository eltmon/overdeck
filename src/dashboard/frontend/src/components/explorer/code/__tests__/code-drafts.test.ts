import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftKey, selectIsDirty, useCodeDrafts } from '../code-drafts';

const key = draftKey('issue:PAN-1', 'src/a.ts');
const store = () => useCodeDrafts.getState();
const draft = () => store().drafts[key];

beforeEach(() => {
  useCodeDrafts.setState({ drafts: {} });
});

describe('draftKey', () => {
  it('separates root and path so no two pairs collide', () => {
    expect(draftKey('a', 'b/c')).not.toBe(draftKey('a/b', 'c'));
  });
});

describe('loaded', () => {
  it('creates a clean draft for a new key', () => {
    expect(store().loaded(key, 'one', 's1')).toBe(true);
    expect(draft()).toEqual({ text: 'one', baseText: 'one', baseSignature: 's1' });
  });

  it('replaces a clean draft', () => {
    store().loaded(key, 'one', 's1');
    expect(store().loaded(key, 'two', 's2')).toBe(true);
    expect(draft()).toEqual({ text: 'two', baseText: 'two', baseSignature: 's2' });
  });

  it('keeps a dirty draft untouched when disk holds other content', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'mine');
    expect(store().loaded(key, 'theirs', 's2')).toBe(false);
    expect(draft()).toEqual({ text: 'mine', baseText: 'one', baseSignature: 's1' });
  });

  it('keeps a dirty draft and its base when disk content is unchanged', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'mine');
    expect(store().loaded(key, 'one', 's1')).toBe(true);
    expect(draft()).toEqual({ text: 'mine', baseText: 'one', baseSignature: 's1' });
  });

  it('makes a dirty draft clean when disk now holds the draft text', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'mine');
    expect(store().loaded(key, 'mine', 's-mine')).toBe(true);
    expect(draft()).toEqual({ text: 'mine', baseText: 'mine', baseSignature: 's-mine' });
  });
});

describe('edits and saves', () => {
  it('edited changes the text and makes the draft dirty', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'one!');
    expect(draft()?.text).toBe('one!');
    expect(selectIsDirty('issue:PAN-1', 'src/a.ts')(store())).toBe(true);
  });

  it('edited on an unknown key does nothing', () => {
    store().edited(key, 'x');
    expect(draft()).toBeUndefined();
  });

  it('saved moves the base and leaves the draft clean when nothing changed since', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'two');
    store().saved(key, 'two', 's2');
    expect(draft()).toEqual({ text: 'two', baseText: 'two', baseSignature: 's2' });
    expect(selectIsDirty('issue:PAN-1', 'src/a.ts')(store())).toBe(false);
  });

  it('saved keeps the draft dirty when the text changed during the save', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'two');
    store().edited(key, 'three');
    store().saved(key, 'two', 's2');
    expect(draft()).toEqual({ text: 'three', baseText: 'two', baseSignature: 's2' });
    expect(selectIsDirty('issue:PAN-1', 'src/a.ts')(store())).toBe(true);
  });

  it('reset discards edits', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'mine');
    store().reset(key, 'theirs', 's2');
    expect(draft()).toEqual({ text: 'theirs', baseText: 'theirs', baseSignature: 's2' });
  });

  it('keepMine takes the disk content as base and keeps the text', () => {
    store().loaded(key, 'one', 's1');
    store().edited(key, 'mine');
    store().keepMine(key, 'theirs', 's2');
    expect(draft()).toEqual({ text: 'mine', baseText: 'theirs', baseSignature: 's2' });
    expect(selectIsDirty('issue:PAN-1', 'src/a.ts')(store())).toBe(true);
  });
});

describe('rekey and drop', () => {
  it('rekey moves a draft to the new key', () => {
    const to = draftKey('issue:PAN-1', 'src/b.ts');
    store().loaded(key, 'one', 's1');
    store().edited(key, 'mine');
    store().rekey(key, to);
    expect(draft()).toBeUndefined();
    expect(store().drafts[to]).toEqual({ text: 'mine', baseText: 'one', baseSignature: 's1' });
  });

  it('drop removes a draft', () => {
    store().loaded(key, 'one', 's1');
    store().drop(key);
    expect(draft()).toBeUndefined();
  });
});

describe('selectIsDirty', () => {
  it('is false without a root or path, or without a draft', () => {
    expect(selectIsDirty()(store())).toBe(false);
    expect(selectIsDirty('issue:PAN-1')(store())).toBe(false);
    expect(selectIsDirty('issue:PAN-1', 'src/a.ts')(store())).toBe(false);
  });

  it('a dirty draft survives an unmount of the component that edited it', () => {
    const { result, unmount } = renderHook(() => useCodeDrafts(selectIsDirty('issue:PAN-1', 'src/a.ts')));
    expect(result.current).toBe(false);
    store().loaded(key, 'one', 's1');
    store().edited(key, 'unsaved');
    unmount();
    const remounted = renderHook(() => useCodeDrafts(selectIsDirty('issue:PAN-1', 'src/a.ts')));
    expect(remounted.result.current).toBe(true);
    expect(draft()?.text).toBe('unsaved');
  });
});
