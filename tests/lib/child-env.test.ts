import { describe, it, expect } from 'vitest';
import { buildChildEnvSync, buildChildEnvWithoutTmuxSync } from '../../src/lib/child-env.js';

describe('buildChildEnv', () => {
  it('strips tmux/screen artifacts and provider keys', () => {
    const base = {
      PATH: '/usr/bin',
      TMUX: '/tmp/tmux-1000/default,123,0',
      TMUX_PANE: '%0',
      STY: '12345.pts-0',
      WINDOW: '0',
      ANTHROPIC_BASE_URL: 'http://proxy',
      ANTHROPIC_AUTH_TOKEN: 'secret',
      OPENAI_API_KEY: 'sk-xxx',
      HOME: '/home/test',
    };
    const result = buildChildEnvSync(base as NodeJS.ProcessEnv, { CUSTOM: 'value' });

    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/home/test');
    expect(result.CUSTOM).toBe('value');

    expect(result.TMUX).toBeUndefined();
    expect(result.TMUX_PANE).toBeUndefined();
    expect(result.STY).toBeUndefined();
    expect(result.WINDOW).toBeUndefined();
    expect(result.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it('overrides strip keys when explicitly provided', () => {
    const base = { PATH: '/usr/bin', TMUX: 'yes' };
    const result = buildChildEnvSync(base as NodeJS.ProcessEnv, { TMUX: 'allowed' });
    expect(result.TMUX).toBe('allowed');
  });

  it('ignores undefined values in baseEnv', () => {
    const base = { PATH: '/usr/bin', FOO: undefined };
    const result = buildChildEnvSync(base as NodeJS.ProcessEnv);
    expect(result).not.toHaveProperty('FOO');
  });
});

describe('buildChildEnvWithoutTmux', () => {
  it('only strips tmux/screen artifacts', () => {
    const base = {
      PATH: '/usr/bin',
      TMUX: 'yes',
      ANTHROPIC_BASE_URL: 'http://proxy',
    };
    const result = buildChildEnvWithoutTmuxSync(base as NodeJS.ProcessEnv);
    expect(result.TMUX).toBeUndefined();
    expect(result.ANTHROPIC_BASE_URL).toBe('http://proxy');
  });
});
