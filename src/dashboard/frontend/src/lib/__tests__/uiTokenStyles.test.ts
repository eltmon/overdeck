import { describe, expect, it } from 'vitest';
import type { ColorTheme } from '@overdeck/contracts';
import { uiTokenStyles } from '../uiTokenStyles';

function theme(overrides: Partial<ColorTheme> & { type: 'light' | 'dark' }): ColorTheme {
  return { id: 'theme', builtin: false, name: 'Theme', ...overrides };
}

describe('uiTokenStyles', () => {
  it('returns {} for a theme with no ui group', () => {
    expect(uiTokenStyles(theme({ type: 'dark' }))).toEqual({});
  });

  it('sets --primary, --ring, --primary-ink, and --primary-foreground from ui.accent', () => {
    const styles = uiTokenStyles(theme({ type: 'dark', ui: { accent: '#ffcc00' } }));
    expect(styles['--primary']).toBe('#ffcc00');
    expect(styles['--ring']).toBe('#ffcc00');
    expect(styles['--primary-ink']).toBe('#ffcc00');
    expect(styles['--primary-foreground']).toBe('#000000');
  });

  it('derives --surface-overlay and --surface-overlay-field from ui.background on a dark theme', () => {
    const styles = uiTokenStyles(theme({ type: 'dark', ui: { background: '#10141c' } }));
    expect(styles['--surface-overlay']).toBe('color-mix(in srgb, var(--background), var(--foreground) 6%)');
    expect(styles['--surface-overlay-field']).toBe('var(--background)');
  });

  it('never returns a signal/state token', () => {
    const styles = uiTokenStyles(theme({
      type: 'dark',
      ui: { background: '#10141c', surface: '#1a1a2e', overlay: '#222', border: '#333', foreground: '#eee', muted: '#999', accent: '#ffcc00' },
    }));
    const forbidden = ['--state-', '--signal-', '--success', '--warning', '--destructive', '--info'];
    for (const key of Object.keys(styles)) {
      for (const prefix of forbidden) {
        expect(key.startsWith(prefix)).toBe(false);
      }
    }
  });
});
