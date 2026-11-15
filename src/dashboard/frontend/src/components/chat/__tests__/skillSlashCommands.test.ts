/**
 * PAN-5347 WI-3: skillSlashCommands.ts — the pure mapping/query helpers and
 * the useSkillSlashCommands fetch-on-open hook.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SKILL_COMMANDS,
  skillContextForConversation,
  toSkillSlashCommands,
  useSkillSlashCommands,
} from '../skillSlashCommands';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toSkillSlashCommands (PAN-5347)', () => {
  it('keeps enabled entries including core, drops intercepted names, ignores packs', () => {
    const result = toSkillSlashCommands({
      skills: [
        { name: 'pan-flywheel', description: 'Run the flywheel.', enabled: true },
        { name: 'grilling', description: 'Grill.', enabled: false },
        { name: 'pan', description: 'Dispatch.', enabled: true },
        { name: 'pan-handoff', description: 'Hand off.', enabled: true },
      ],
      packs: [{ id: 'mattpocock', skills: [{ name: 'tdd', enabled: true }] }],
    } as never);

    expect(result).toEqual([
      { id: 'skill-pan-flywheel', label: '/pan-flywheel', description: 'Run the flywheel.', insert: '/pan-flywheel ', category: 'Skills' },
    ]);
  });
});

describe('skillContextForConversation (PAN-5347)', () => {
  it('returns undefined for linked and vault rows, the full context for a real conversation, cwd-only for a non-row id, and undefined when both are absent', () => {
    expect(skillContextForConversation({ id: 5, name: 'c', cwd: '/w', issueId: null, origin: 'linked' })).toBeUndefined();
    expect(skillContextForConversation({ id: 5, name: 'c', cwd: '/w', issueId: null, origin: 'vault' })).toBeUndefined();
    expect(skillContextForConversation({ id: 5, name: 'c', cwd: '/w', issueId: 'PAN-1' }))
      .toEqual({ conversationName: 'c', cwd: '/w', issueId: 'PAN-1' });
    expect(skillContextForConversation({ id: -1, name: 'c', cwd: '/w', issueId: null })).toEqual({ cwd: '/w' });
    expect(skillContextForConversation({ id: 0, name: 'c', cwd: '', issueId: null })).toBeUndefined();
  });
});

describe('useSkillSlashCommands (PAN-5347)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fetches only once active turns true, and returns the mapped list', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [{ name: 'grilling', description: 'Grill.', enabled: true }] }),
    });
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useSkillSlashCommands({
        harness: 'claude-code', context: { conversationName: 'conv-a' }, active,
      }),
      { initialProps: { active: false } },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBe(EMPTY_SKILL_COMMANDS);

    rerender({ active: true });

    await waitFor(() => expect(result.current).not.toBe(EMPTY_SKILL_COMMANDS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/skills/overrides?conversation=conv-a');
    expect(result.current).toEqual([
      { id: 'skill-grilling', label: '/grilling', description: 'Grill.', insert: '/grilling ', category: 'Skills' },
    ]);
  });

  it('never fetches and always returns the same EMPTY_SKILL_COMMANDS reference for an incapable harness or an undefined context', async () => {
    const { result: codexResult, rerender: rerenderCodex } = renderHook(
      ({ active }: { active: boolean }) => useSkillSlashCommands({
        harness: 'codex', context: { conversationName: 'conv-a' }, active,
      }),
      { initialProps: { active: false } },
    );
    rerenderCodex({ active: true });

    const { result: noContextResult, rerender: rerenderNoContext } = renderHook(
      ({ active }: { active: boolean }) => useSkillSlashCommands({ harness: 'claude-code', context: undefined, active }),
      { initialProps: { active: false } },
    );
    rerenderNoContext({ active: true });

    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(codexResult.current).toBe(EMPTY_SKILL_COMMANDS);
    expect(noContextResult.current).toBe(EMPTY_SKILL_COMMANDS);
  });

  it('returns EMPTY_SKILL_COMMANDS without throwing when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useSkillSlashCommands({
        harness: 'claude-code', context: { conversationName: 'conv-a' }, active,
      }),
      { initialProps: { active: false } },
    );

    rerender({ active: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(result.current).toBe(EMPTY_SKILL_COMMANDS);
    expect(warn).toHaveBeenCalledTimes(1);

    // A second failed fetch (menu closed and reopened) warns no further.
    rerender({ active: false });
    rerender({ active: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
