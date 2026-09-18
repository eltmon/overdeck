import { afterEach, describe, expect, it, vi } from 'vitest';

import { mergeConfigs } from '../config-yaml/merge.js';
import type { YamlConfig } from '../config-yaml/schema.js';

/**
 * `claude.permissionMode` decides the `--permission-mode` flag every spawned
 * Claude Code process gets, so a value the merger does not recognize must not be
 * dropped in silence: the operator ends up with whatever the default is while
 * believing their config took effect. Config load still must never throw (see the
 * tiered_execution degradation note in merge.ts), so the merger degrades and warns.
 */
describe('claude.permissionMode merge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries an explicit bypass through to the resolved config', () => {
    expect(mergeConfigs({ claude: { permissionMode: 'bypass' } }).config.claude.permissionMode)
      .toBe('bypass');
  });

  it('carries an explicit auto through to the resolved config', () => {
    expect(mergeConfigs({ claude: { permissionMode: 'auto' } }).config.claude.permissionMode)
      .toBe('auto');
  });

  it('warns and keeps the default when the value is not a recognized mode', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A Claude Code flag value rather than an Overdeck mode name — the shape of
    // typo an operator reaching for bypass permissions actually makes.
    const { config } = mergeConfigs(
      { claude: { permissionMode: 'bypassPermissions' } } as unknown as YamlConfig,
    );

    expect(config.claude.permissionMode).toBe('bypass');
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]?.[0]).toContain('claude.permissionMode "bypassPermissions"');
    expect(errors.mock.calls[0]?.[0]).toContain("'auto'");
    expect(errors.mock.calls[0]?.[0]).toContain("'bypass'");
  });

  it('warns once per distinct bad value, not once per config load', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = { claude: { permissionMode: 'yolo' } } as unknown as YamlConfig;

    mergeConfigs(bad);
    mergeConfigs(bad);

    expect(errors).toHaveBeenCalledTimes(1);
  });
});
