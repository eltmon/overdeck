import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pinClaudePermissionModeOnce } from '../claude-permission-mode-pin.js';

describe('pinClaudePermissionModeOnce', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-5151-pin-home-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function markerPath(): string {
    return join(home, '.claude-permission-mode-pin.json');
  }

  function yamlPath(): string {
    return join(home, 'config.yaml');
  }

  it('empty home returns new-install, writes the marker, and creates no config.yaml', async () => {
    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('new-install');
    expect(existsSync(markerPath())).toBe(true);
    expect(existsSync(yamlPath())).toBe(false);
  });

  it('a home directory that does not exist yet still returns new-install (fresh CLI install, PAN-5151)', async () => {
    const freshHome = join(home, 'not-created-yet');
    expect(existsSync(freshHome)).toBe(false);

    const result = await pinClaudePermissionModeOnce({ overdeckHome: freshHome });

    expect(result.outcome).toBe('new-install');
    expect(existsSync(join(freshHome, '.claude-permission-mode-pin.json'))).toBe(true);
    expect(existsSync(join(freshHome, 'config.yaml'))).toBe(false);
  });

  it('a config.yaml with other keys and a comment but no claude.permissionMode gets pinned to bypass, preserving content', async () => {
    writeFileSync(yamlPath(), 'ui:\n  theme: broadsheet\n# keep me\n', { mode: 0o600 });

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('pinned-bypass');
    const text = readFileSync(yamlPath(), 'utf8');
    expect(text).toContain('theme: broadsheet');
    expect(text).toContain('# keep me');
    const { parseDocument } = await import('yaml');
    expect(parseDocument(text).getIn(['claude', 'permissionMode'])).toBe('bypass');
    expect(statSync(yamlPath()).mode & 0o777).toBe(0o600);
  });

  it('a home with only config.toml gets a new config.yaml pinned to bypass', async () => {
    writeFileSync(join(home, 'config.toml'), '', 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('pinned-bypass');
    const text = readFileSync(yamlPath(), 'utf8');
    expect(text).toContain('permissionMode: bypass');
  });

  it('a home with only overdeck.db gets pinned to bypass', async () => {
    writeFileSync(join(home, 'overdeck.db'), '', 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('pinned-bypass');
  });

  it('a valid claude.permissionMode: auto is left unchanged', async () => {
    const text = 'claude:\n  permissionMode: auto\n';
    writeFileSync(yamlPath(), text, 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('already-set');
    expect(readFileSync(yamlPath(), 'utf8')).toBe(text);
  });

  it('a valid claude.permissionMode: bypass is left unchanged', async () => {
    const text = 'claude:\n  permissionMode: bypass\n';
    writeFileSync(yamlPath(), text, 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('already-set');
    expect(readFileSync(yamlPath(), 'utf8')).toBe(text);
  });

  it('an invalid claude.permissionMode value is replaced with bypass and reported', async () => {
    writeFileSync(yamlPath(), 'claude:\n  permissionMode: bypassPermissions\n', 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('pinned-bypass');
    expect(result.replacedValue).toBe('bypassPermissions');
    expect(result.notice).toContain('bypassPermissions');
    const { parseDocument } = await import('yaml');
    expect(parseDocument(readFileSync(yamlPath(), 'utf8')).getIn(['claude', 'permissionMode'])).toBe('bypass');
  });

  it('a null claude: key is replaced with a map holding permissionMode: bypass', async () => {
    writeFileSync(yamlPath(), 'claude:\n', 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('pinned-bypass');
    const { parseDocument } = await import('yaml');
    expect(parseDocument(readFileSync(yamlPath(), 'utf8')).getIn(['claude', 'permissionMode'])).toBe('bypass');
  });

  it('a scalar claude: value names that scalar as the replaced value', async () => {
    writeFileSync(yamlPath(), 'claude: bypassPermissions\n', 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('pinned-bypass');
    expect(result.replacedValue).toBe('bypassPermissions');
    expect(result.notice).toContain('bypassPermissions');
    const { parseDocument } = await import('yaml');
    expect(parseDocument(readFileSync(yamlPath(), 'utf8')).getIn(['claude', 'permissionMode'])).toBe('bypass');
  });

  it('the notice names the actual config.yaml path, not a hardcoded one', async () => {
    writeFileSync(yamlPath(), 'ui:\n  theme: broadsheet\n', 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.notice).toContain(yamlPath());
  });

  it('an unparseable config.yaml is skipped, left unchanged, with no marker written', async () => {
    const text = 'claude: [unclosed';
    writeFileSync(yamlPath(), text, 'utf8');

    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('skipped-unparseable');
    expect(readFileSync(yamlPath(), 'utf8')).toBe(text);
    expect(existsSync(markerPath())).toBe(false);
  });

  it('a second call after any decided outcome returns already-decided and writes nothing', async () => {
    const first = await pinClaudePermissionModeOnce({ overdeckHome: home });
    expect(first.outcome).toBe('new-install');

    const before = existsSync(yamlPath()) ? readFileSync(yamlPath(), 'utf8') : undefined;
    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('already-decided');
    expect(existsSync(yamlPath()) ? readFileSync(yamlPath(), 'utf8') : undefined).toBe(before);
  });

  it('a new-install home where a writer later creates config.yaml without the key stays already-decided', async () => {
    const first = await pinClaudePermissionModeOnce({ overdeckHome: home });
    expect(first.outcome).toBe('new-install');

    writeFileSync(yamlPath(), 'ui:\n  theme: broadsheet\n', 'utf8');
    const result = await pinClaudePermissionModeOnce({ overdeckHome: home });

    expect(result.outcome).toBe('already-decided');
    expect(readFileSync(yamlPath(), 'utf8')).toBe('ui:\n  theme: broadsheet\n');
  });

  it('with no overdeckHome under the test runner, returns skipped-test-runner', async () => {
    const result = await pinClaudePermissionModeOnce();

    expect(result.outcome).toBe('skipped-test-runner');
  });

  it('serializes two concurrent first decisions on the same new home (PAN-5151)', async () => {
    const [a, b] = await Promise.all([
      pinClaudePermissionModeOnce({ overdeckHome: home }),
      pinClaudePermissionModeOnce({ overdeckHome: home }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['already-decided', 'new-install']);
    expect(existsSync(join(home, '.claude-permission-mode-pin.lock'))).toBe(false);
  });

  it('serializes two concurrent first decisions on an existing home without a valid key', async () => {
    writeFileSync(yamlPath(), 'ui:\n  theme: broadsheet\n', 'utf8');

    const [a, b] = await Promise.all([
      pinClaudePermissionModeOnce({ overdeckHome: home }),
      pinClaudePermissionModeOnce({ overdeckHome: home }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['already-decided', 'pinned-bypass']);
    expect(await parseYamlPermissionMode()).toBe('bypass');
    expect(existsSync(join(home, '.claude-permission-mode-pin.lock'))).toBe(false);
  });

  async function parseYamlPermissionMode(): Promise<unknown> {
    const { parseDocument } = await import('yaml');
    return parseDocument(readFileSync(yamlPath(), 'utf8')).getIn(['claude', 'permissionMode']);
  }
});
