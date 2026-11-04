import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { hermesConfig, CONNECTOR_LOCAL_URL, TAILSCALE_PLACEHOLDER_ORIGIN } from '../../../src/dashboard/frontend/src/components/Settings/anywhere/botSnippets';

// PAN-4953 W-INT1 (AC-25): the Hermes plugin package files.
const pluginYamlPath = new URL('../../../integrations/hermes/plugin.yaml', import.meta.url);
const pyprojectPath = new URL('../../../integrations/hermes/pyproject.toml', import.meta.url);
const licensePath = new URL('../../../integrations/hermes/LICENSE', import.meta.url);
const skillPath = new URL('../../../integrations/hermes/skills/overdeck/SKILL.md', import.meta.url);
const rootLicensePath = new URL('../../../integrations/LICENSE', import.meta.url);
const readmePath = new URL('../../../integrations/hermes/README.md', import.meta.url);
const hermesDir = fileURLToPath(new URL('../../../integrations/hermes/', import.meta.url));

const SKIPPED_DIRS = new Set(['__pycache__', '.venv', 'dist', 'build']);

describe('integrations/hermes manifest', () => {
  it('plugin.yaml carries the plugin id, hook and settings schema', () => {
    const plugin = parse(readFileSync(pluginYamlPath, 'utf-8'));

    expect(plugin.name).toBe('overdeck');
    expect(plugin.version).toBe('0.1.0');
    expect(plugin.kind).toBe('standalone');
    expect(plugin.provides_hooks).toContain('pre_llm_call');
    expect(Object.keys(plugin.config_schema)).toEqual(['server', 'summary', 'allow_answers']);
    expect(plugin.config_schema.server.default).toBe('overdeck');
    expect(plugin.config_schema.summary.default).toBe(true);
    expect(plugin.config_schema.allow_answers.default).toBe(false);
  });

  it('pyproject.toml declares the overdeck entry point and version', () => {
    const text = readFileSync(pyprojectPath, 'utf-8');

    expect(text).toContain('overdeck = "overdeck_hermes"');
    expect(text).toContain('version = "0.1.0"');
  });

  it('the shared skill copy exists', () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it('LICENSE is a byte copy of integrations/LICENSE', () => {
    expect(readFileSync(licensePath)).toEqual(readFileSync(rootLicensePath));
  });
});

describe('integrations/hermes README', () => {
  it('contains both dialog snippets verbatim', () => {
    const readme = readFileSync(readmePath, 'utf-8');

    expect(readme).toContain(hermesConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL }));
    expect(readme).toContain(hermesConfig({ reach: 'tailscale', url: `${TAILSCALE_PLACEHOLDER_ORIGIN}/mcp` }));
  });
});

describe('integrations/hermes secrets', () => {
  it('no file contains a token-shaped string', () => {
    const TOKEN_PATTERN = /\bod[klr]_[0-9a-f]{16,}/;
    let visited = 0;

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name) && !entry.name.endsWith('.egg-info')) walk(entryPath);
          continue;
        }
        visited += 1;
        const content = readFileSync(entryPath, 'utf-8');
        expect(content).not.toMatch(TOKEN_PATTERN);
      }
    }

    walk(hermesDir);
    expect(visited).toBeGreaterThanOrEqual(15);
  });
});
