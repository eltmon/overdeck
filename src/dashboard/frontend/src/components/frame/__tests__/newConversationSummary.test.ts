import { describe, expect, it } from 'vitest';
import { FALLBACK_GROUPS } from '../../shared/ModelPicker';
import { newConversationSummary, newConversationTitle, shortModelLabel } from '../newConversationSummary';

describe('shortModelLabel (PAN-5335 WI-8)', () => {
  it('strips the Claude prefix and the trailing context note', () => {
    expect(shortModelLabel('Claude Opus 5.5 (1M context)')).toBe('Opus 5.5');
  });

  it('leaves a label with neither unchanged', () => {
    expect(shortModelLabel('GPT-5.5')).toBe('GPT-5.5');
  });
});

describe('newConversationSummary (PAN-5335 WI-8/D-7)', () => {
  it('summarizes a known Anthropic model on Claude Code', () => {
    const summary = newConversationSummary({ model: 'claude-opus-5-5', harness: 'claude-code', effort: 'high', groups: FALLBACK_GROUPS });
    expect(summary).toMatchObject({ provider: 'anthropic', shortName: 'Opus 5.5', harnessLabel: null, effortLabel: 'High' });
  });

  it('names the harness when it is not Claude Code', () => {
    const summary = newConversationSummary({ model: 'claude-opus-5-5', harness: 'codex', effort: 'high', groups: FALLBACK_GROUPS });
    expect(summary.harnessLabel).toBe('Codex');
  });

  it('falls back to the compact model id for an unknown model', () => {
    const summary = newConversationSummary({ model: 'm1', harness: 'claude-code', effort: 'high', groups: FALLBACK_GROUPS });
    expect(summary.provider).toBeUndefined();
    expect(summary.shortName).toBe('m1');
  });

  it('omits the effort word for a model with no adjustable effort', () => {
    const summary = newConversationSummary({ model: 'kimi-code/kimi-for-coding-highspeed', harness: 'kimi-code', effort: 'high', groups: FALLBACK_GROUPS });
    expect(summary.effortLabel).toBeNull();
  });
});

describe('newConversationTitle (PAN-5335 WI-8/D-7)', () => {
  it('names the full model label and effort', () => {
    const summary = newConversationSummary({ model: 'claude-opus-5-5', harness: 'claude-code', effort: 'high', groups: FALLBACK_GROUPS });
    expect(newConversationTitle(summary)).toBe('New conversation with Claude Opus 5.5 (1M context) · High (N)');
  });
});
