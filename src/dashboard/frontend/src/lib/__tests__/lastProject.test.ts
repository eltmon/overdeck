import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_PROJECT_KEY } from '../../components/CommandDeck/projectsData';
import {
  ALL_PROJECTS_DECK_STORAGE_KEY,
  LAST_PROJECT_STORAGE_KEY,
  clearLastProjectKey,
  initialProjectKey,
  isKnownProjectKey,
  readAllProjectsDeck,
  readLastProjectKey,
  rememberDeckSelection,
  writeAllProjectsDeck,
  writeLastProjectKey,
} from '../lastProject';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
  window.localStorage.removeItem(ALL_PROJECTS_DECK_STORAGE_KEY);
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
    expect(initialProjectKey({ routeProject: 'krux', pathname: '/command-deck/krux', stored: 'overdeck', allProjectsDeck: false }))
      .toEqual({ key: 'krux', fromStorage: false });
  });

  it('bare /command-deck ignores storage', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/command-deck', stored: 'overdeck', allProjectsDeck: false }))
      .toEqual({ key: null, fromStorage: false });
  });

  it('/conv/:id ignores storage', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/conv/42', stored: 'overdeck', allProjectsDeck: false }))
      .toEqual({ key: null, fromStorage: false });
  });

  it('/command-deck/<project> resolves from the route, not storage', () => {
    expect(initialProjectKey({ routeProject: 'krux', pathname: '/command-deck/krux', stored: null, allProjectsDeck: false }))
      .toEqual({ key: 'krux', fromStorage: false });
  });

  it('any other path falls back to storage', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/activity', stored: 'overdeck', allProjectsDeck: false }))
      .toEqual({ key: 'overdeck', fromStorage: true });
  });

  it('any other path with nothing stored resolves to null', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/activity', stored: null, allProjectsDeck: false }))
      .toEqual({ key: null, fromStorage: false });
  });
});

describe('initialProjectKey with the All projects deck flag (PAN-5343 H-D16)', () => {
  it('a /conv/ path returns the All deck when the flag is set', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/conv/abc', stored: 'overdeck', allProjectsDeck: true }))
      .toEqual({ key: '__all-projects__', fromStorage: false });
  });

  it('a /conv/ path returns no project when the flag is not set', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/conv/abc', stored: 'overdeck', allProjectsDeck: false }))
      .toEqual({ key: null, fromStorage: false });
  });

  it('a route project wins over the flag', () => {
    expect(initialProjectKey({ routeProject: 'overdeck', pathname: '/command-deck/overdeck', stored: null, allProjectsDeck: true }))
      .toEqual({ key: 'overdeck', fromStorage: false });
  });

  it('the storage fallback returns the All deck when the flag is set', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/activity', stored: 'overdeck', allProjectsDeck: true }))
      .toEqual({ key: '__all-projects__', fromStorage: false });
  });

  it('bare /command-deck still returns no project with the flag set', () => {
    expect(initialProjectKey({ routeProject: null, pathname: '/command-deck', stored: 'overdeck', allProjectsDeck: true }))
      .toEqual({ key: null, fromStorage: false });
  });
});

describe('readAllProjectsDeck / writeAllProjectsDeck / rememberDeckSelection (PAN-5343 H-D16)', () => {
  it('round-trips the flag', () => {
    expect(readAllProjectsDeck()).toBe(false);
    writeAllProjectsDeck(true);
    expect(readAllProjectsDeck()).toBe(true);
    writeAllProjectsDeck(false);
    expect(readAllProjectsDeck()).toBe(false);
  });

  it('read returns false and write does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readAllProjectsDeck()).toBe(false);
    expect(() => writeAllProjectsDeck(true)).not.toThrow();
  });

  it('selecting the All deck sets the flag and never writes it as the last project', () => {
    writeLastProjectKey('dfai');
    rememberDeckSelection('__all-projects__');
    expect(readAllProjectsDeck()).toBe(true);
    expect(readLastProjectKey()).toBe('dfai');
    expect(window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY)).not.toBe('__all-projects__');
  });

  it('selecting a project clears the flag and records the project', () => {
    rememberDeckSelection('__all-projects__');
    rememberDeckSelection('overdeck');
    expect(readAllProjectsDeck()).toBe(false);
    expect(readLastProjectKey()).toBe('overdeck');
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

  it('is always true for the All projects deck (PAN-5343)', () => {
    expect(isKnownProjectKey('__all-projects__', [])).toBe(true);
  });

  it('is false for an unknown key', () => {
    expect(isKnownProjectKey('gone', registered)).toBe(false);
  });
});
