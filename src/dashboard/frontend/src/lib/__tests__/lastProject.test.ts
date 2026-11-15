import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_PROJECT_KEY } from '../../components/CommandDeck/projectsData';
import {
  LAST_PROJECT_STORAGE_KEY,
  clearLastProjectKey,
  initialProjectKey,
  isKnownProjectKey,
  readLastProjectKey,
  writeLastProjectKey,
} from '../lastProject';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
});

describe('readLastProjectKey / writeLastProjectKey (PAN-5335 WI-5)', () => {
  it('round-trips a written key', () => {
    writeLastProjectKey('krux');
    expect(readLastProjectKey()).toBe('krux');
  });

  it('returns null when nothing is stored', () => {
    expect(readLastProjectKey()).toBeNull();
  });

  it('read returns null when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLastProjectKey()).toBeNull();
  });

  it('write does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => writeLastProjectKey('krux')).not.toThrow();
  });

  it('clearLastProjectKey removes the stored key and does not throw when blocked', () => {
    writeLastProjectKey('krux');
    clearLastProjectKey();
    expect(readLastProjectKey()).toBeNull();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => clearLastProjectKey()).not.toThrow();
  });
});

describe('initialProjectKey (PAN-5335 D-5)', () => {
  it('a route project always wins over storage', () => {
    expect(initialProjectKey({ routeProject: 'krux', pathname: '/command-deck/krux', stored: 'overdeck' }))
      .toEqual({ key: 'krux', fromStorage: false });
  });

  it('bare /command-deck ignores storage', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/command-deck', stored: 'overdeck' }))
      .toEqual({ key: null, fromStorage: false });
  });

  it('/conv/:id ignores storage', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/conv/42', stored: 'overdeck' }))
      .toEqual({ key: null, fromStorage: false });
  });

  it('/command-deck/<project> resolves from the route, not storage', () => {
    expect(initialProjectKey({ routeProject: 'krux', pathname: '/command-deck/krux', stored: null }))
      .toEqual({ key: 'krux', fromStorage: false });
  });

  it('any other path falls back to storage', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/activity', stored: 'overdeck' }))
      .toEqual({ key: 'overdeck', fromStorage: true });
  });

  it('any other path with nothing stored resolves to null', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/activity', stored: null }))
      .toEqual({ key: null, fromStorage: false });
  });
});

describe('isKnownProjectKey (PAN-5335 D-5)', () => {
  const registered = [{ key: 'overdeck', name: 'Overdeck' }, { key: 'krux', name: 'Krux' }];

  it('matches by key', () => {
    expect(isKnownProjectKey('overdeck', registered)).toBe(true);
  });

  it('matches by name', () => {
    expect(isKnownProjectKey('Krux', registered)).toBe(true);
  });

  it('is always true for NO_PROJECT_KEY', () => {
    expect(isKnownProjectKey(NO_PROJECT_KEY, [])).toBe(true);
  });

  it('is false for an unknown key', () => {
    expect(isKnownProjectKey('gone', registered)).toBe(false);
  });
});
