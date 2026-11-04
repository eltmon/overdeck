import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  connectorCommands,
  grokBuildMcpJson,
  tokenSetup,
} from '../../../src/dashboard/frontend/src/components/Settings/anywhere/botSnippets';

// PAN-4955 W-INT3 WI-4 (AC-4): README and PUBLISHING for integrations/grok-build.
const readmePath = new URL('../../../integrations/grok-build/README.md', import.meta.url);
const publishingPath = new URL('../../../integrations/grok-build/PUBLISHING.md', import.meta.url);
const scriptPath = new URL('../../../integrations/grok-build/scripts/run-mcp.sh', import.meta.url);
const grokBuildDir = fileURLToPath(new URL('../../../integrations/grok-build/', import.meta.url));

function readPin(): string {
  const text = readFileSync(scriptPath, 'utf-8');
  const match = text.match(/OVERDECK_CORE_VERSION:-(\d+\.\d+\.\d+)\}/);
  if (!match) throw new Error('could not find the OVERDECK_CORE_VERSION pin in scripts/run-mcp.sh');
  return match[1];
}

describe('integrations/grok-build README', () => {
  it('contains the dialog snippets verbatim', () => {
    const readme = readFileSync(readmePath, 'utf-8');

    expect(readme).toContain(grokBuildMcpJson());
    expect(readme).toContain(
      tokenSetup({ platform: 'grok-build', reach: 'this-computer', token: '<token>', origin: '' }),
    );
    expect(readme).toContain(
      connectorCommands({ version: '<version>', pairingString: '<pairing string>', serve: false }),
    );
  });

  it('names the plugin install command, the qualified skill form, and the pinned version', () => {
    const readme = readFileSync(readmePath, 'utf-8');
    const pin = readPin();

    expect(readme).toContain('/overdeck:overdeck pending');
    expect(readme).toContain('grok plugin install eltmon/overdeck#integrations/grok-build --trust');
    expect(readme).toContain(`@overdeck/core@${pin}`);
  });

  it('links the Tailscale follow-up issue', () => {
    const readme = readFileSync(readmePath, 'utf-8');

    expect(readme).toMatch(/https:\/\/github\.com\/eltmon\/overdeck\/issues\//);
  });
});

describe('integrations/grok-build PUBLISHING', () => {
  it('states that publishing is a separate, operator-approved step', () => {
    const publishing = readFileSync(publishingPath, 'utf-8');

    expect(publishing).toContain('Publishing is a separate step the operator approves');
  });
});

describe('integrations/grok-build secrets', () => {
  it('no file contains a token-shaped string', () => {
    const TOKEN_PATTERN = /\bod[klr]_[0-9a-f]{16,}/;
    let visited = 0;

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }
        visited += 1;
        const content = readFileSync(entryPath, 'utf-8');
        expect(content).not.toMatch(TOKEN_PATTERN);
      }
    }

    walk(grokBuildDir);
    expect(visited).toBeGreaterThanOrEqual(10);
  });
});
