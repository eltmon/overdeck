import { describe, expect, it } from 'vitest';

import {
  canonicalPullRequestUrl,
  isConfiguredPullRequestRepo,
  parsePullRequestRef,
  repoFromRemoteUrl,
  type PullRequestRepo,
} from '../pull-request-ref';

const GITHUB_REPO: PullRequestRepo = { host: 'github.com', repository: 'eltmon/overdeck', forge: 'github' };
const GITLAB_REPO: PullRequestRepo = { host: 'gitlab.example.com', repository: 'group/sub/app', forge: 'gitlab' };

describe('parsePullRequestRef', () => {
  it('parses a GitHub PR URL with and without a trailing slash, query, fragment, or sub-page', () => {
    for (const input of [
      'https://github.com/eltmon/overdeck/pull/4067',
      'https://github.com/eltmon/overdeck/pull/4067/',
      'https://github.com/eltmon/overdeck/pull/4067?w=1',
      'https://github.com/eltmon/overdeck/pull/4067#discussion_r1',
      'https://github.com/eltmon/overdeck/pull/4067/files',
      'github.com/eltmon/overdeck/pull/4067',
    ]) {
      expect(parsePullRequestRef(input), input).toEqual({
        host: 'github.com',
        repository: 'eltmon/overdeck',
        number: 4067,
        forge: 'github',
        url: 'https://github.com/eltmon/overdeck/pull/4067',
      });
    }
  });

  it('lower-cases the host and repository and rebuilds the URL from the key', () => {
    expect(parsePullRequestRef('HTTPS://GitHub.COM/Eltmon/Overdeck/pull/7')).toMatchObject({
      host: 'github.com',
      repository: 'eltmon/overdeck',
      url: 'https://github.com/eltmon/overdeck/pull/7',
    });
  });

  it('parses GitLab merge request URLs, current and legacy, on a self-hosted host', () => {
    const expected = {
      host: 'gitlab.example.com',
      repository: 'group/sub/app',
      number: 12,
      forge: 'gitlab',
      url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/12',
    };
    expect(parsePullRequestRef('https://gitlab.example.com/group/sub/app/-/merge_requests/12')).toEqual(expected);
    expect(parsePullRequestRef('https://gitlab.example.com/group/sub/app/merge_requests/12/diffs')).toEqual(expected);
  });

  it('resolves #42 and owner/repo#42 against the default repository', () => {
    expect(parsePullRequestRef('#42', GITHUB_REPO)).toMatchObject({
      repository: 'eltmon/overdeck',
      number: 42,
      url: 'https://github.com/eltmon/overdeck/pull/42',
    });
    expect(parsePullRequestRef('Other/Repo#42', GITHUB_REPO)).toMatchObject({
      host: 'github.com',
      repository: 'other/repo',
      number: 42,
    });
    expect(parsePullRequestRef('!9', GITLAB_REPO)?.url).toBe('https://gitlab.example.com/group/sub/app/-/merge_requests/9');
  });

  it('returns null for short refs without a default repository', () => {
    expect(parsePullRequestRef('#42')).toBeNull();
    expect(parsePullRequestRef('eltmon/overdeck#42')).toBeNull();
  });

  it('returns null for garbage, issue URLs, and non-positive numbers', () => {
    expect(parsePullRequestRef('', GITHUB_REPO)).toBeNull();
    expect(parsePullRequestRef('not a pr', GITHUB_REPO)).toBeNull();
    expect(parsePullRequestRef('https://github.com/eltmon/overdeck/issues/42', GITHUB_REPO)).toBeNull();
    expect(parsePullRequestRef('#0', GITHUB_REPO)).toBeNull();
    expect(parsePullRequestRef('https://github.com/eltmon/pull/42')).toBeNull();
  });
});

describe('canonicalPullRequestUrl', () => {
  it('builds GitHub and GitLab URLs', () => {
    expect(canonicalPullRequestUrl({ host: 'github.com', repository: 'a/b', number: 1 }, 'github')).toBe('https://github.com/a/b/pull/1');
    expect(canonicalPullRequestUrl({ host: 'gitlab.com', repository: 'a/b/c', number: 2 }, 'gitlab')).toBe('https://gitlab.com/a/b/c/-/merge_requests/2');
  });
});

describe('repoFromRemoteUrl', () => {
  it('reads https, ssh, and scp-style remotes', () => {
    expect(repoFromRemoteUrl('https://github.com/Eltmon/Overdeck.git')).toEqual({ host: 'github.com', repository: 'eltmon/overdeck', forge: 'github' });
    expect(repoFromRemoteUrl('git@github.com:eltmon/overdeck.git')).toEqual({ host: 'github.com', repository: 'eltmon/overdeck', forge: 'github' });
    expect(repoFromRemoteUrl('ssh://git@gitlab.example.com:2222/group/sub/app.git')).toEqual({ host: 'gitlab.example.com', repository: 'group/sub/app', forge: 'gitlab' });
  });

  it('returns null for hosts that are neither GitHub nor GitLab', () => {
    expect(repoFromRemoteUrl('https://bitbucket.org/a/b.git')).toBeNull();
    expect(repoFromRemoteUrl('')).toBeNull();
  });
});

describe('isConfiguredPullRequestRepo', () => {
  it('matches on host and repository', () => {
    expect(isConfiguredPullRequestRepo({ host: 'github.com', repository: 'eltmon/overdeck', number: 1 }, [GITHUB_REPO])).toBe(true);
    expect(isConfiguredPullRequestRepo({ host: 'github.com', repository: 'someone/else', number: 1 }, [GITHUB_REPO])).toBe(false);
    expect(isConfiguredPullRequestRepo({ host: 'ghe.example.com', repository: 'eltmon/overdeck', number: 1 }, [GITHUB_REPO])).toBe(false);
  });
});
