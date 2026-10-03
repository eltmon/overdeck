/** PAN-4486: POST /api/conversations request-body parsing. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '', project: '' }));

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => state.home,
}));

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/projects.js')>()),
  listProjectsAsync: async () => [{ key: 'myapp', config: { name: 'MyApp', path: state.project } }],
}));

import {
  ConversationCreateInputError,
  parseConversationLaunchContext,
  resolveConversationCreateTarget,
} from '../../../../src/lib/overdeck/conversation-create-input.js';

beforeAll(() => {
  state.home = realpathSync(mkdtempSync(join(tmpdir(), 'create-input-home-')));
  state.project = join(state.home, 'Projects', 'myapp');
  mkdirSync(join(state.project, 'packages', 'web'), { recursive: true });
  mkdirSync(`${state.project}-evil`, { recursive: true });
  symlinkSync(join(state.project, 'packages'), join(state.home, 'link-to-packages'));
});

afterAll(() => {
  rmSync(state.home, { recursive: true, force: true });
});

describe('parseConversationLaunchContext skillOverrides (PAN-4486)', () => {
  it('returns a valid map, including pack skill ids', () => {
    expect(parseConversationLaunchContext({ skillOverrides: { grilling: false, 'mattpocock/tdd': true } })).toEqual({
      bareContext: false,
      skipClaudeMd: false,
      skillOverrides: { grilling: false, 'mattpocock/tdd': true },
    });
  });

  it('omits the field when absent, null or empty', () => {
    expect(parseConversationLaunchContext({})).not.toHaveProperty('skillOverrides');
    expect(parseConversationLaunchContext({ skillOverrides: null })).not.toHaveProperty('skillOverrides');
    expect(parseConversationLaunchContext({ skillOverrides: {} })).not.toHaveProperty('skillOverrides');
  });

  it.each([
    ['a non-boolean value', { grilling: 'no' }],
    ['an array', [true]],
    ['a string', 'grilling'],
    ['a traversal key', { '../x': false }],
    ['too many entries', Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`skill-${i}`, false]))],
  ])('rejects %s', (_label, skillOverrides) => {
    expect(() => parseConversationLaunchContext({ skillOverrides })).toThrow(ConversationCreateInputError);
    expect(() => parseConversationLaunchContext({ skillOverrides })).toThrow('Invalid skillOverrides');
  });

  it('rejects a core skill', () => {
    expect(() => parseConversationLaunchContext({ skillOverrides: { 'pan-done': false } }))
      .toThrow('Core skill cannot be overridden: pan-done');
  });
});

describe('resolveConversationCreateTarget (PAN-4486)', () => {
  it('accepts a cwd inside the project and returns its realpath', async () => {
    await expect(resolveConversationCreateTarget({ projectKey: 'myapp', cwd: join(state.project, 'packages', 'web') }, '/default'))
      .resolves.toEqual({ cwd: join(state.project, 'packages', 'web'), projectKey: 'myapp' });
    await expect(resolveConversationCreateTarget({ projectKey: 'myapp', cwd: join(state.home, 'link-to-packages') }, '/default'))
      .resolves.toEqual({ cwd: join(state.project, 'packages'), projectKey: 'myapp' });
  });

  it('accepts the project root itself', async () => {
    await expect(resolveConversationCreateTarget({ projectKey: 'MyApp', cwd: state.project }, '/default'))
      .resolves.toEqual({ cwd: state.project, projectKey: 'myapp' });
  });

  it('defaults to the project path, or the default cwd with no project', async () => {
    await expect(resolveConversationCreateTarget({ projectKey: 'myapp' }, '/default'))
      .resolves.toEqual({ cwd: state.project, projectKey: 'myapp' });
    await expect(resolveConversationCreateTarget({}, '/default')).resolves.toEqual({ cwd: '/default' });
  });

  it.each([
    ['a directory outside home', () => tmpdir()],
    ['a sibling with the project path as prefix', () => `${state.project}-evil`],
    ['a missing directory', () => join(state.project, 'missing')],
    ['a relative path', () => 'packages/web'],
  ])('rejects %s', async (_label, cwd) => {
    await expect(resolveConversationCreateTarget({ projectKey: 'myapp', cwd: cwd() }, '/default'))
      .rejects.toThrow('Invalid cwd: must be inside project myapp');
  });

  it('rejects a cwd without a project', async () => {
    await expect(resolveConversationCreateTarget({ cwd: state.project }, '/default')).rejects.toThrow('cwd requires projectKey');
  });

  it('rejects an unknown project', async () => {
    await expect(resolveConversationCreateTarget({ projectKey: 'nope' }, '/default'))
      .rejects.toBeInstanceOf(ConversationCreateInputError);
  });
});
