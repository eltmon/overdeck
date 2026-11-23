import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { stampCorePins } from '../../../src/cli/commands/release.js';

// PAN-5486 W-4 (FR-3): `pan release stable|canary` stamps the @overdeck/core pins under integrations/.
const SCRIPT = fileURLToPath(new URL('../../../integrations/shared/sync-core-pins.mjs', import.meta.url));
const MCP_JSON = join('integrations', 'grok-bot', 'mcp.json');

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pan-5486-release-'));
  mkdirSync(join(repoRoot, 'integrations', 'shared'), { recursive: true });
  mkdirSync(join(repoRoot, 'integrations', 'grok-bot'), { recursive: true });
  copyFileSync(SCRIPT, join(repoRoot, 'integrations', 'shared', 'sync-core-pins.mjs'));
  writeFileSync(join(repoRoot, MCP_JSON), '{\n  "args": [\n    "@overdeck/core@0.77.0",\n  ]\n}\n');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repoRoot, { recursive: true, force: true });
});

const writeVersion = (version: string) =>
  writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({ version }) + '\n');

describe('stampCorePins', () => {
  it('stampCorePins rewrites the fixture pins to the root version', () => {
    writeVersion('2.0.0');

    stampCorePins(repoRoot);

    expect(readFileSync(join(repoRoot, MCP_JSON), 'utf8')).toContain('"@overdeck/core@2.0.0",');
  });

  it('stampCorePins throws when the root version is not a semver', () => {
    writeVersion('next');

    expect(() => stampCorePins(repoRoot)).toThrow();
    expect(readFileSync(join(repoRoot, MCP_JSON), 'utf8')).toContain('"@overdeck/core@0.77.0",');
  });
});
