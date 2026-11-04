/**
 * PAN-4927 W-INJ4 (PAN-4935): getAcpLauncherFields writes an acpContextFile
 * ending in the tools block the overdeck MCP gate picks.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpAgents = vi.hoisted(() => ({ value: true }));
const configRejects = vi.hoisted(() => ({ value: false }));

vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return {
    ...actual,
    loadConfigNoMigration: vi.fn(async () => {
      if (configRejects.value) throw new Error('simulated config read failure');
      return { config: { mcp: { agents: mcpAgents.value, public: { enabled: false } } } };
    }),
  };
});

vi.mock('../../projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects.js')>();
  return { ...actual, findProjectByPath: () => null };
});

import { getAcpLauncherFields } from '../runtime-command.js';

describe('getAcpLauncherFields tools block (PAN-4935 W-4)', () => {
  let overdeckHome: string;
  let prevOverdeckHome: string | undefined;

  beforeEach(() => {
    mcpAgents.value = true;
    configRejects.value = false;
    overdeckHome = mkdtempSync(join(tmpdir(), 'pan-acp-launcher-tools-block-'));
    prevOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = overdeckHome;
    mkdirSync(join(overdeckHome, 'context'), { recursive: true });
  });

  afterEach(() => {
    if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevOverdeckHome;
    vi.unstubAllEnvs();
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('gives an opencode model the MCP block', async () => {
    const fields = await getAcpLauncherFields('agent-pan-1', 'opencode/some-model', join(overdeckHome, 'workspace'), '/bin/x');
    expect(readFileSync(fields.acpContextFile, 'utf8')).toContain('## Overdeck tools');
  });

  it('gives the CLI block under PAN_DOCKER=1', async () => {
    vi.stubEnv('PAN_DOCKER', '1');
    const fields = await getAcpLauncherFields('agent-pan-2', 'opencode/some-model', join(overdeckHome, 'workspace'), '/bin/x');
    expect(readFileSync(fields.acpContextFile, 'utf8')).toContain('## Overdeck commands');
  });

  it('gives the CLI block when mcp.agents is false', async () => {
    mcpAgents.value = false;
    const fields = await getAcpLauncherFields('agent-pan-3', 'opencode/some-model', join(overdeckHome, 'workspace'), '/bin/x');
    expect(readFileSync(fields.acpContextFile, 'utf8')).toContain('## Overdeck commands');
  });

  it('gives the CLI block, never rejecting, when the config read fails (NFR-5)', async () => {
    configRejects.value = true;
    const fields = await getAcpLauncherFields('agent-pan-4', 'opencode/some-model', join(overdeckHome, 'workspace'), '/bin/x');
    expect(readFileSync(fields.acpContextFile, 'utf8')).toContain('## Overdeck commands');
  });
});
