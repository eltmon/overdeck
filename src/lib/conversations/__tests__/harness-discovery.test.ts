import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverJsonlFiles } from '../harness-discovery.js';

let tempHome: string | null = null;
let savedHome: string | undefined;

afterEach(() => {
  if (savedHome !== undefined) {
    process.env.HOME = savedHome;
  } else {
    delete process.env.HOME;
  }
  savedHome = undefined;
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

describe('ACP transcript discovery', () => {
  it('discovers the direct agent transcript as the ACP harness', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'overdeck-acp-discovery-'));
    savedHome = process.env.HOME;
    process.env.HOME = tempHome;
    const agentDir = join(tempHome, '.overdeck', 'agents', 'agent-acp');
    const transcriptPath = join(agentDir, 'acp-session.jsonl');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ harness: 'acp' }), 'utf8');
    writeFileSync(transcriptPath, '{}\n', 'utf8');

    const discovered = await discoverJsonlFiles([]);

    expect(discovered).toContainEqual({
      projectDir: agentDir,
      jsonlPath: transcriptPath,
      harness: 'acp',
    });
  });
});
