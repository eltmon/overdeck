import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeChannelsBridgeMcpConfig } from '../supervisor-channels.js';
import { packageRoot } from '../../paths.js';

describe('writeChannelsBridgeMcpConfig', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  // The bundler places this code in chunks at different depths under dist/
  // (PAN-4205 moved it to dist/agents-*.js), so the bridge path must come from
  // the package root, never a fixed walk up from the module.
  it('points bun at the bridge source under the package root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-cfg-'));
    dirs.push(dir);
    const configPath = join(dir, '.pan', 'agent-mcp.json');
    await writeChannelsBridgeMcpConfig(configPath, 'agent-pan-1');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const bridgePath = config.mcpServers['overdeck-bridge'].args[1];
    expect(bridgePath).toBe(join(packageRoot, 'src', 'lib', 'channels', 'overdeck-bridge.ts'));
    expect(existsSync(bridgePath)).toBe(true);
  });
});
