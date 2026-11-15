/**
 * PAN-5347 WI-2: listConversationSkillStates resolves a conversation's launch
 * scope (cwd, issue) and per-conversation overrides, falling back to the
 * query's cwd/issue when the conversation is unknown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConversationByName: vi.fn(),
  resolveLaunchScope: vi.fn(),
  listSkillStates: vi.fn(),
}));

vi.mock('../../overdeck/conversations.js', () => ({
  getConversationByName: mocks.getConversationByName,
}));
vi.mock('../launch.js', () => ({
  resolveLaunchScope: mocks.resolveLaunchScope,
}));
vi.mock('../store.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../store.js')>()),
  listSkillStates: mocks.listSkillStates,
}));

import { SkillOverrideError } from '../store.js';
import { listConversationSkillStates } from '../conversation-scope.js';

const emptyList = { project: null, issue: null, skills: [], packs: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveLaunchScope.mockResolvedValue({ projectKey: 'tst', issueId: 'TST-1' });
  mocks.listSkillStates.mockResolvedValue(emptyList);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listConversationSkillStates (PAN-5347)', () => {
  it('throws unknown-conversation when the name is unknown and no cwd is given', async () => {
    mocks.getConversationByName.mockReturnValue(null);

    await expect(listConversationSkillStates({ conversationName: 'c1' })).rejects.toMatchObject({
      code: 'unknown-conversation',
    });
    expect(mocks.resolveLaunchScope).not.toHaveBeenCalled();
    expect(mocks.listSkillStates).not.toHaveBeenCalled();
  });

  it('uses the row cwd and issue over the query, and passes its skillOverrides', async () => {
    mocks.getConversationByName.mockReturnValue({
      cwd: '/row-cwd', issueId: 'ROW-1', skillOverrides: { grilling: false },
    });

    await listConversationSkillStates({ conversationName: 'c1', cwd: '/query-cwd', issueId: 'QUERY-1' });

    expect(mocks.resolveLaunchScope).toHaveBeenCalledWith({ cwd: '/row-cwd', issueId: 'ROW-1' });
    expect(mocks.listSkillStates).toHaveBeenCalledWith({
      projectKey: 'tst', issueId: 'TST-1', conversationOverrides: { grilling: false },
    });
  });

  it('falls back to the query cwd/issue with no conversationOverrides when the name is unknown but cwd is given', async () => {
    mocks.getConversationByName.mockReturnValue(null);

    await listConversationSkillStates({ conversationName: 'c1', cwd: '/w', issueId: 'TST-1' });

    expect(mocks.resolveLaunchScope).toHaveBeenCalledWith({ cwd: '/w', issueId: 'TST-1' });
    expect(mocks.listSkillStates).toHaveBeenCalledWith({
      projectKey: 'tst', issueId: 'TST-1', conversationOverrides: undefined,
    });
  });

  it('retries once at projectKey-only scope when listSkillStates rejects with unknown-issue', async () => {
    mocks.getConversationByName.mockReturnValue(null);
    mocks.resolveLaunchScope.mockResolvedValue({ projectKey: undefined, issueId: 'TST-1' });
    mocks.listSkillStates
      .mockRejectedValueOnce(new SkillOverrideError('unknown-issue', 'no registered project owns issue TST-1'))
      .mockResolvedValueOnce(emptyList);

    const result = await listConversationSkillStates({ cwd: '/w', issueId: 'TST-1' });

    expect(result).toBe(emptyList);
    expect(mocks.listSkillStates).toHaveBeenNthCalledWith(1, {
      projectKey: undefined, issueId: 'TST-1', conversationOverrides: undefined,
    });
    expect(mocks.listSkillStates).toHaveBeenNthCalledWith(2, {
      projectKey: undefined, conversationOverrides: undefined,
    });
  });

  it('propagates an error that is not unknown-issue', async () => {
    mocks.getConversationByName.mockReturnValue(null);
    mocks.listSkillStates.mockRejectedValue(new SkillOverrideError('unknown-project', 'unknown project: nope'));

    await expect(listConversationSkillStates({ cwd: '/w' })).rejects.toMatchObject({ code: 'unknown-project' });
    expect(mocks.listSkillStates).toHaveBeenCalledTimes(1);
  });

  it('throws unknown-conversation when neither conversation nor cwd is given, even with an issue', async () => {
    await expect(listConversationSkillStates({ issueId: 'TST-1' })).rejects.toMatchObject({ code: 'unknown-conversation' });
    expect(mocks.resolveLaunchScope).not.toHaveBeenCalled();
    expect(mocks.listSkillStates).not.toHaveBeenCalled();
  });
});
