import { describe, expect, it } from 'vitest';

import { buildHomeIntents, seedDiscussPrompt } from '../homeComposerIntents';

describe('buildHomeIntents', () => {
  it('advanced order is agent, terminal', () => {
    const intents = buildHomeIntents({ mode: 'advanced', harness: 'claude-code', codexAvailable: false });
    expect(intents.map((i) => i.kind)).toEqual(['agent', 'terminal']);
    expect(intents[0]).toMatchObject({ id: 'claude-code', agentName: 'Claude Code', keys: '↵' });
    expect(intents[1]).toMatchObject({ id: 'terminal', keys: '⌃↵' });
  });

  it('codex row appears only when available and not the default', () => {
    const withCodex = buildHomeIntents({ mode: 'advanced', harness: 'claude-code', codexAvailable: true });
    expect(withCodex.map((i) => i.id)).toEqual(['claude-code', 'terminal', 'codex']);
    expect(withCodex[2]).toMatchObject({ kind: 'agent', agentName: 'Codex', keys: '⌘⇧↵' });

    const unavailable = buildHomeIntents({ mode: 'advanced', harness: 'claude-code', codexAvailable: false });
    expect(unavailable.some((i) => i.id === 'codex')).toBe(false);

    const alreadyCodex = buildHomeIntents({ mode: 'advanced', harness: 'codex', codexAvailable: true });
    expect(alreadyCodex.some((i) => i.id === 'codex' && i !== alreadyCodex[0])).toBe(false);
    expect(alreadyCodex.filter((i) => i.id === 'codex')).toHaveLength(1);
  });

  it('talk row only in simple mode', () => {
    const simple = buildHomeIntents({ mode: 'simple', harness: 'claude-code', codexAvailable: false });
    expect(simple.at(-1)).toMatchObject({ id: 'talk', kind: 'talk' });

    const advanced = buildHomeIntents({ mode: 'advanced', harness: 'claude-code', codexAvailable: false });
    expect(advanced.some((i) => i.kind === 'talk')).toBe(false);
  });

  it('unresolved harness yields an "agent" row with no agentName', () => {
    const intents = buildHomeIntents({ mode: 'advanced', codexAvailable: false });
    expect(intents[0]).toMatchObject({ id: 'agent', kind: 'agent' });
    expect(intents[0]?.agentName).toBeUndefined();
  });
});

describe('seedDiscussPrompt', () => {
  it('keeps the discuss-first wording', () => {
    const prompt = seedDiscussPrompt('  add dark mode  ');
    expect(prompt).toContain('do not file anything yet');
    expect(prompt).toContain('add dark mode');
  });
});
