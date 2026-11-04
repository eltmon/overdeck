import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXPANDED_PROJECTS_STORAGE_KEY,
  groupMobileConversations,
  readExpandedProjects,
  writeExpandedProjects,
  type GroupableConversation,
} from '../conversationGroups';
import { NO_PROJECT_KEY, NO_PROJECT_LABEL, type RegisteredProjectLite } from '../../CommandDeck/projectsData';

function row(overrides: Partial<GroupableConversation> = {}): GroupableConversation {
  return { createdAt: '2026-01-01T00:00:00Z', ...overrides };
}

beforeEach(() => {
  localStorage.clear();
});

describe('groupMobileConversations', () => {
  it('groups by explicit projectKey and by cwd inside a project path', () => {
    const projects: RegisteredProjectLite[] = [
      { key: 'alpha', name: 'Alpha', path: '/p/alpha' },
      { key: 'beta', name: 'Beta', path: '/p/beta' },
    ];
    const byCwd = row({ cwd: '/p/alpha/sub' });
    const byKey = row({ projectKey: 'beta' });
    const groups = groupMobileConversations([byCwd, byKey], projects);
    expect(groups.find((g) => g.key === 'alpha')?.rows).toEqual([byCwd]);
    expect(groups.find((g) => g.key === 'beta')?.rows).toEqual([byKey]);
  });

  it('puts unregistered and null keys in No project, sorted last', () => {
    const projects: RegisteredProjectLite[] = [{ key: 'alpha', name: 'Alpha', path: '/p/alpha' }];
    const unregistered = row({ cwd: '/elsewhere' });
    const ghost = row({ projectKey: 'ghost' });
    const groups = groupMobileConversations([unregistered, ghost], projects);
    const last = groups[groups.length - 1];
    expect(last.key).toBe(NO_PROJECT_KEY);
    expect(last.label).toBe(NO_PROJECT_LABEL);
    expect(last.canCreate).toBe(false);
    expect(last.rows).toEqual(expect.arrayContaining([unregistered, ghost]));
  });

  it('returns an empty registered project as a group with no rows', () => {
    const projects: RegisteredProjectLite[] = [
      { key: 'alpha', name: 'Alpha', path: '/p/alpha' },
      { key: 'beta', name: 'Beta', path: '/p/beta' },
    ];
    const onlyAlpha = row({ cwd: '/p/alpha/sub' });
    const groups = groupMobileConversations([onlyAlpha], projects);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.key === 'beta')).toMatchObject({ rows: [], canCreate: true });
    expect(groups.some((g) => g.key === NO_PROJECT_KEY)).toBe(false);
  });

  it('sorts groups by label and rows newest first, hiding archived rows', () => {
    const projects: RegisteredProjectLite[] = [
      { key: 'beta', name: 'Beta', path: '/p/beta' },
      { key: 'alpha', name: 'Alpha', path: '/p/alpha' },
    ];
    const older = row({ cwd: '/p/alpha/sub', createdAt: '2026-01-01T00:00:00Z' });
    const newer = row({ cwd: '/p/alpha/sub', createdAt: '2026-01-02T00:00:00Z' });
    const archived = row({ cwd: '/p/alpha/sub', createdAt: '2026-01-03T00:00:00Z', archivedAt: '2026-01-04T00:00:00Z' });
    const groups = groupMobileConversations([older, newer, archived], projects);
    expect(groups.map((g) => g.key)).toEqual(['alpha', 'beta']);
    expect(groups[0]?.rows).toEqual([newer, older]);
  });

  it('falls back to raw projectKey groups with canCreate false when the project list is null', () => {
    const withKey = row({ projectKey: 'alpha' });
    const noKey = row({ cwd: '/elsewhere' });
    const groups = groupMobileConversations([withKey, noKey], null);
    expect(groups.find((g) => g.key === 'alpha')).toMatchObject({ label: 'alpha', canCreate: false, rows: [withKey] });
    const last = groups[groups.length - 1];
    expect(last.key).toBe(NO_PROJECT_KEY);
    expect(last.rows).toEqual([noKey]);
  });
});

describe('readExpandedProjects / writeExpandedProjects', () => {
  it('reads an empty set from missing, invalid or throwing storage', () => {
    expect(readExpandedProjects()).toEqual(new Set());

    localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, 'not json');
    expect(readExpandedProjects()).toEqual(new Set());

    localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(readExpandedProjects()).toEqual(new Set());

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readExpandedProjects()).toEqual(new Set());
    spy.mockRestore();
  });

  it('round-trips the expanded set through localStorage', () => {
    writeExpandedProjects(new Set(['alpha', 'beta']));
    expect(readExpandedProjects()).toEqual(new Set(['alpha', 'beta']));
  });
});
