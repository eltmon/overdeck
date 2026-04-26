import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  resolveClaudeSessionId,
  resolveJsonlPath,
} from '../jsonl-resolver.js';
import { encodeClaudeProjectDir } from '../../../../lib/paths.js';

const AGENT_ID = 'agent-pan-830';
const WORKSPACE_PATH = '/home/testuser/Projects/panopticon-cli/workspaces/feature-pan-830';
const CLAUDE_SESSION_ID = '9d08794c-3973-4f83-92cf-234ae618258a';

let testDir: string;
let agentsDir: string;
let claudeProjectsDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `pan-jsonl-resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentsDir = join(testDir, 'panopticon', 'agents');
  claudeProjectsDir = join(testDir, 'claude', 'projects');
  await mkdir(join(agentsDir, AGENT_ID), { recursive: true });
  await mkdir(claudeProjectsDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('resolveClaudeSessionId (PAN-830)', () => {
  it('reads session.id when present', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), `${CLAUDE_SESSION_ID}\n`);

    const id = await resolveClaudeSessionId(AGENT_ID, { agentsDirOverride: agentsDir });

    expect(id).toBe(CLAUDE_SESSION_ID);
  });

  it('falls back to last entry of sessions.json when session.id missing', async () => {
    const arr = ['oldest-uuid', 'older-uuid', CLAUDE_SESSION_ID];
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), JSON.stringify(arr));

    const id = await resolveClaudeSessionId(AGENT_ID, { agentsDirOverride: agentsDir });

    expect(id).toBe(CLAUDE_SESSION_ID);
  });

  it('falls back to runtime state when session.id and sessions.json missing', async () => {
    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => ({ claudeSessionId: CLAUDE_SESSION_ID }),
    });

    expect(id).toBe(CLAUDE_SESSION_ID);
  });

  it('prefers session.id over sessions.json', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), 'session-id-wins\n');
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), JSON.stringify(['sessions-json-loses']));

    const id = await resolveClaudeSessionId(AGENT_ID, { agentsDirOverride: agentsDir });

    expect(id).toBe('session-id-wins');
  });

  it('prefers sessions.json over runtime state', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), JSON.stringify(['sessions-json-wins']));

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => ({ claudeSessionId: 'runtime-loses' }),
    });

    expect(id).toBe('sessions-json-wins');
  });

  it('returns null when nothing is available', async () => {
    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null on malformed sessions.json (non-array)', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), '{"not":"array"}');

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null on malformed sessions.json (invalid JSON)', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), 'not-json{');

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null on empty sessions.json array', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), '[]');

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null when agent dir does not exist', async () => {
    const id = await resolveClaudeSessionId('nonexistent-agent', {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });
});

describe('resolveJsonlPath (PAN-830)', () => {
  it('returns the JSONL path when claudeSessionId resolves AND file exists', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{"type":"event"}\n');
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`));
  });

  it('returns null when claudeSessionId resolves but file does not exist', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBeNull();
  });

  it('returns null when claudeSessionId cannot be resolved', async () => {
    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(path).toBeNull();
  });

  it('does NOT return an agent-id-named JSONL (the bug PAN-830 fixes)', async () => {
    // Pre-PAN-830 behavior would have built ~/.claude/projects/<encoded>/<agentId>.jsonl
    // and returned it if present. Verify the new resolver does NOT do that.
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${AGENT_ID}.jsonl`), '{"old":"bug"}\n');
    // No session.id, no sessions.json, no runtime state — so claudeSessionId is null
    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(path).toBeNull();
  });

  it('uses the encoded workspace path under claudeProjects root', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    expect(encoded).toBe(
      '-home-testuser-Projects-panopticon-cli-workspaces-feature-pan-830',
    );
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{}');
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toContain(encoded);
    expect(path).toContain(`${CLAUDE_SESSION_ID}.jsonl`);
  });
});
