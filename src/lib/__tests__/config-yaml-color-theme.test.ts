import { describe, expect, it, vi } from 'vitest';
import { mergeConfigs } from '../config-yaml.js';

describe('ui.color_theme configuration (PAN-4644)', () => {
  it('defaults to null for both modes when unset', () => {
    const { config } = mergeConfigs({});
    expect(config.ui.colorTheme).toEqual({ light: null, dark: null });
  });

  it('loads both mode ids', () => {
    const { config } = mergeConfigs({ ui: { color_theme: { light: 'ayu-light', dark: 'ayu-dark' } } });
    expect(config.ui.colorTheme).toEqual({ light: 'ayu-light', dark: 'ayu-dark' });
  });

  it('does not throw on a non-string value, warns, and yields null for that mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { config } = mergeConfigs({ ui: { color_theme: { dark: 42 as never } } });
    expect(config.ui.colorTheme.dark).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ui.color_theme.dark'));
    warnSpy.mockRestore();
  });

  it('ignores an id that does not match the theme-id shape', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { config } = mergeConfigs({ ui: { color_theme: { light: 'Not Valid!' } } });
    expect(config.ui.colorTheme.light).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ui.color_theme.light'));
    warnSpy.mockRestore();
  });

  it('does not throw on a null color_theme (e.g. "ui:\\n  color_theme:\\n"), warns, and yields null for both modes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { config } = mergeConfigs({ ui: { color_theme: null as never } });
    expect(config.ui.colorTheme).toEqual({ light: null, dark: null });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ui.color_theme'));
    warnSpy.mockRestore();
  });

  it('does not throw on an array color_theme, warns, and yields null for both modes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { config } = mergeConfigs({ ui: { color_theme: ['ayu-dark'] as never } });
    expect(config.ui.colorTheme).toEqual({ light: null, dark: null });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ui.color_theme'));
    warnSpy.mockRestore();
  });
});
