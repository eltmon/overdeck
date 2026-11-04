/**
 * PAN-4947 WI-1: the public MCP switch — global-only cached read that fails closed,
 * the comment-preserving write door, the exact raw-path surface match, and the
 * D-10 Funnel commands.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  invalidatePublicMcpConfig,
  isPublicMcpEnabled,
  publicMcpFunnelCommands,
  publicMcpFunnelOffCommands,
  publicMcpSurface,
} from '../../../../src/lib/mcp/public-mcp.js';
import { savePublicMcpEnabled } from '../../../../src/lib/mcp/public-mcp-write.js';

let home: string;
const originalHome = process.env.OVERDECK_HOME;
const configPath = () => join(home, 'config.yaml');

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4947-public-mcp-'));
  process.env.OVERDECK_HOME = home;
  invalidatePublicMcpConfig();
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  invalidatePublicMcpConfig();
  await rm(home, { recursive: true, force: true });
});

describe('isPublicMcpEnabled', () => {
  it('is false with no config.yaml', () => {
    expect(isPublicMcpEnabled()).toBe(false);
  });

  it('is true when mcp.public.enabled is true', async () => {
    await writeFile(configPath(), 'mcp:\n  public:\n    enabled: true\n');
    expect(isPublicMcpEnabled()).toBe(true);
  });

  it('is false for unparsable YAML', async () => {
    await writeFile(configPath(), 'mcp: [unclosed\n  public: {\n');
    expect(isPublicMcpEnabled()).toBe(false);
  });

  it('is false for a non-boolean value', async () => {
    await writeFile(configPath(), 'mcp:\n  public:\n    enabled: "yes"\n');
    expect(isPublicMcpEnabled()).toBe(false);
  });

  it('keeps the cached value until invalidatePublicMcpConfig()', async () => {
    await writeFile(configPath(), 'mcp:\n  public:\n    enabled: true\n');
    expect(isPublicMcpEnabled()).toBe(true);
    await writeFile(configPath(), 'mcp:\n  public:\n    enabled: false\n');
    expect(isPublicMcpEnabled()).toBe(true);
    invalidatePublicMcpConfig();
    expect(isPublicMcpEnabled()).toBe(false);
  });
});

describe('savePublicMcpEnabled', () => {
  it('keeps other keys and comments, writes 0600, and needs no manual invalidate', async () => {
    const original = '# operator notes\nui:\n  theme: dark # keep me\n';
    await writeFile(configPath(), original, { mode: 0o600 });
    expect(isPublicMcpEnabled()).toBe(false);

    await savePublicMcpEnabled(true);

    const text = await readFile(configPath(), 'utf8');
    expect(text.startsWith(original)).toBe(true);
    expect(text.slice(original.length)).toBe('mcp:\n  public:\n    enabled: true\n');
    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
    expect(isPublicMcpEnabled()).toBe(true);
  });

  it('creates a missing config.yaml with mode 0600', async () => {
    await savePublicMcpEnabled(true);
    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
    expect(await readFile(configPath(), 'utf8')).toBe('mcp:\n  public:\n    enabled: true\n');
  });

  it('turns the switch back off', async () => {
    await savePublicMcpEnabled(true);
    expect(isPublicMcpEnabled()).toBe(true);
    await savePublicMcpEnabled(false);
    expect(isPublicMcpEnabled()).toBe(false);
  });

  it.each(['mcp: null\n', 'mcp: "x"\n', 'mcp:\n  public: "x"\n'])('does not throw on a non-map node (%j)', async (text) => {
    await writeFile(configPath(), text);
    await expect(savePublicMcpEnabled(true)).resolves.toBeUndefined();
    expect(isPublicMcpEnabled()).toBe(true);
  });
});

describe('publicMcpSurface', () => {
  it('matches the raw path before the query', () => {
    expect(publicMcpSurface('POST', '/mcp?x=1')).toBe('POST /mcp');
    expect(publicMcpSurface('GET', '/oauth/mcp/authorize/status#frag')).toBe('GET /oauth/mcp/authorize/status');
  });

  it.each([
    ['POST', '/mcp/'],
    ['POST', '//mcp'],
    ['POST', '/api/../mcp'],
    ['POST', '/%6Dcp'],
    ['GET', '/mcp'],
    ['POST', 'http://h/mcp'],
  ])('returns null for %s %s', (method, url) => {
    expect(publicMcpSurface(method, url)).toBeNull();
  });
});

describe('Funnel commands', () => {
  it('publishes the three mounts on port 8443', () => {
    expect(publicMcpFunnelCommands(4000)).toEqual([
      'tailscale funnel --bg --https=8443 --set-path=/mcp http://127.0.0.1:4000/mcp',
      'tailscale funnel --bg --https=8443 --set-path=/.well-known http://127.0.0.1:4000/.well-known',
      'tailscale funnel --bg --https=8443 --set-path=/oauth http://127.0.0.1:4000/oauth',
    ]);
  });

  it('turns the three mounts off', () => {
    expect(publicMcpFunnelOffCommands()).toEqual([
      'tailscale funnel --https=8443 --set-path=/mcp off',
      'tailscale funnel --https=8443 --set-path=/.well-known off',
      'tailscale funnel --https=8443 --set-path=/oauth off',
    ]);
  });
});
