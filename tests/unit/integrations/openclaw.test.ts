import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import plugin from '../../../integrations/openclaw/src/index';
import type { PluginTool } from '../../../integrations/openclaw/src/openclaw-api';
import {
  CONNECTOR_LOCAL_URL,
  openclawConfig,
  TAILSCALE_PLACEHOLDER_ORIGIN,
} from '../../../src/dashboard/frontend/src/components/Settings/anywhere/botSnippets';

// PAN-4954 (PAN-4927 W-INT2) WI-10, AC-10: the OpenClaw plugin's manifest, package.json, entry,
// README snippets, LICENSE and a package-wide secret scan, in the root suite that CI runs.
const manifestPath = new URL('../../../integrations/openclaw/openclaw.plugin.json', import.meta.url);
const packageJsonPath = new URL('../../../integrations/openclaw/package.json', import.meta.url);
const readmePath = new URL('../../../integrations/openclaw/README.md', import.meta.url);
const licensePath = new URL('../../../integrations/openclaw/LICENSE', import.meta.url);
const rootLicensePath = new URL('../../../integrations/LICENSE', import.meta.url);
const skillPath = new URL('../../../integrations/openclaw/skills/overdeck/SKILL.md', import.meta.url);
const packageDir = fileURLToPath(new URL('../../../integrations/openclaw/', import.meta.url));

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

describe('integrations/openclaw manifest', () => {
  it('carries the documented keys', () => {
    expect(manifest.id).toBe('overdeck');
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.contracts.tools).toEqual(['overdeck_pending', 'overdeck_answer']);
    expect(manifest.skills).toEqual(['skills/overdeck']);
    expect(manifest.activation.onStartup).toBe(true);
    expect(manifest.uiHints.localToken.sensitive).toBe(true);
  });

  it('has no undocumented or required keys', () => {
    for (const key of ['entry', 'license', 'author', 'required']) {
      expect(manifest).not.toHaveProperty(key);
      expect(manifest.configSchema).not.toHaveProperty(key);
    }
  });
});

describe('integrations/openclaw package.json', () => {
  it('declares the OpenClaw entry and compatibility contract with no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    expect(pkg.name).toBe('@overdeck/openclaw');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.license).toBe('MIT');
    expect(pkg.type).toBe('module');
    expect(pkg.openclaw.extensions).toEqual(['./dist/index.js']);
    expect(pkg.openclaw.compat.pluginApi).toBe('>=2026.5.6');
    expect(pkg).not.toHaveProperty('dependencies');
  });
});

describe('integrations/openclaw entry', () => {
  it('registers exactly the manifest contracts.tools', () => {
    const tools: PluginTool[] = [];
    plugin.register({
      pluginConfig: { localToken: 'test-token' },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool: (tool) => { tools.push(tool); },
      on: vi.fn(),
    });
    expect(tools.map((tool) => tool.name)).toEqual(manifest.contracts.tools);
  });
});

describe('integrations/openclaw README', () => {
  it('contains both Connect a bot config blocks verbatim', () => {
    const readme = readFileSync(readmePath, 'utf-8');
    expect(readme).toContain(openclawConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL }));
    expect(readme).toContain(openclawConfig({ reach: 'tailscale', url: `${TAILSCALE_PLACEHOLDER_ORIGIN}/mcp` }));
  });
});

describe('integrations/openclaw files', () => {
  it('LICENSE is a byte copy of integrations/LICENSE and the skill copy exists', () => {
    expect(readFileSync(licensePath)).toEqual(readFileSync(rootLicensePath));
    expect(existsSync(skillPath)).toBe(true);
  });

  it('no file contains a token-shaped string', () => {
    const TOKEN_PATTERN = /od[klr]_[0-9a-f]{8}/;
    let visited = 0;

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'package-lock.json') continue;
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }
        visited += 1;
        expect(readFileSync(entryPath, 'utf-8')).not.toMatch(TOKEN_PATTERN);
      }
    }

    walk(packageDir);
    expect(visited).toBeGreaterThan(10);
  });
});
