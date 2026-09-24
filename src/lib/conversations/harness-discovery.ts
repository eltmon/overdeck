/**
 * Per-harness session discovery sources (PAN-2224).
 *
 * Enumerates JSONL session files without parsing metadata. Missing roots are
 * skipped silently; permission failures are reported through warnings.
 */

import { listMuseSessionPaths } from '../runtimes/storage/muse.js';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import { claudeProjectsRoot } from '../runtimes/storage/claude-code.js';
import { codexAgentSessionsDir, codexDefaultHome, codexSessionsRoot } from '../runtimes/storage/codex.js';
import { piSessionsRoot, piUserAgentDir } from '../runtimes/storage/pi.js';
import { ACP_TRANSCRIPT_FILE } from '../runtimes/storage/acp.js';

export type DiscoveredHarness = 'claude-code' | 'pi' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse';

export interface DiscoveredFile {
  jsonlPath: string;
  projectDir: string;
  harness: DiscoveredHarness;
}

export interface DiscoverySource {
  harness: DiscoveredHarness | 'agent-dirs';
  roots: () => string[];
  collect: (root: string, warnings?: string[], targetEncodings?: string[]) => Promise<DiscoveredFile[]>;
}

type AgentStateHarness = DiscoveredHarness | string;

const discoverySources: DiscoverySource[] = [
  {
    harness: 'claude-code',
    roots: () => [claudeProjectsRoot()],
    collect: collectClaudeProjectFiles,
  },
  {
    harness: 'pi',
    roots: () => [piSessionsRoot(piUserAgentDir())],
    collect: (root, warnings) => collectPiFamilyRoot(root, 'pi', warnings),
  },
  {
    harness: 'ohmypi',
    roots: () => [join(homedir(), '.omp', 'agent', 'sessions')],
    collect: (root, warnings) => collectPiFamilyRoot(root, 'ohmypi', warnings),
  },
  {
    harness: 'codex',
    roots: () => [codexSessionsRoot(codexDefaultHome())],
    collect: (root, warnings) => collectJsonlFiles(root, root, 'codex', warnings ?? []),
  },
  {
    harness: 'agent-dirs',
    roots: () => [join(homedir(), '.overdeck', 'agents')],
    collect: collectAgentDirFiles,
  },
];

export async function discoverJsonlFiles(
  warnings: string[] = [],
  targetEncodings?: string[],
): Promise<DiscoveredFile[]> {
  const result: DiscoveredFile[] = [];
  for (const source of discoverySources) {
    for (const root of source.roots()) {
      result.push(...await source.collect(root, warnings, targetEncodings));
    }
  }
  return result;
}

async function collectClaudeProjectFiles(
  claudeProjectsDir: string,
  warnings: string[] = [],
  targetEncodings?: string[],
): Promise<DiscoveredFile[]> {
  const result: DiscoveredFile[] = [];

  let projectDirs: string[];
  try {
    const entries = await fs.readdir(claudeProjectsDir, { withFileTypes: true });
    projectDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(claudeProjectsDir, e.name));
  } catch (err) {
    if (isMissingRoot(err)) return result;
    if (isPermissionError(err)) {
      warnings.push(`Permission denied while scanning ${claudeProjectsDir}`);
    }
    return result;
  }

  for (const projectDir of projectDirs) {
    if (targetEncodings && !projectDirMatchesAnyTarget(projectDir, targetEncodings)) continue;
    await collectJsonlFiles(projectDir, projectDir, 'claude-code', warnings, result);
  }

  return result;
}

async function collectPiFamilyRoot(
  root: string,
  harness: 'pi' | 'ohmypi',
  warnings: string[] = [],
): Promise<DiscoveredFile[]> {
  const result: DiscoveredFile[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isMissingRoot(err)) return result;
    if (isPermissionError(err)) {
      warnings.push(`Permission denied while scanning ${root}`);
    }
    return result;
  }

  for (const entry of entries) {
    const name = String(entry.name);
    const fullPath = join(root, name);
    if (entry.isFile() && name.endsWith('.jsonl')) {
      result.push({ projectDir: root, jsonlPath: fullPath, harness });
    } else if (entry.isDirectory()) {
      await collectJsonlFiles(fullPath, fullPath, harness, warnings, result);
    }
  }

  return result;
}

async function collectAgentDirFiles(root: string, warnings: string[] = []): Promise<DiscoveredFile[]> {
  const result: DiscoveredFile[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isMissingRoot(err)) return result;
    if (isPermissionError(err)) {
      warnings.push(`Permission denied while scanning ${root}`);
    }
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentDir = join(root, entry.name);
    let agentHarness = await readAgentHarness(agentDir);
    if (!agentHarness && (entry.name.startsWith('conv-') || entry.name.startsWith('conversation-'))) {
      const { getConversationByTmuxSession } = await import('../overdeck/conversations.js');
      agentHarness = getConversationByTmuxSession(entry.name)?.harness ?? null;
    }
    const piHarness = agentHarness === 'pi' || agentHarness === 'ohmypi' ? agentHarness : 'ohmypi';

    result.push(...await collectPiFamilyRoot(piSessionsRoot(agentDir), piHarness, warnings));
    await collectAgentRootFiles(agentDir, piHarness, warnings, result, agentHarness === 'opencode' ? 'opencode' : 'acp');
    await collectJsonlFiles(codexAgentSessionsDir(agentDir), codexAgentSessionsDir(agentDir), 'codex', warnings, result);
    for (const jsonlPath of await listMuseSessionPaths(entry.name, root)) {
      result.push({ projectDir: agentDir, jsonlPath, harness: 'muse' });
    }
  }

  return result;
}

async function collectAgentRootFiles(
  agentDir: string,
  piHarness: 'pi' | 'ohmypi',
  warnings: string[],
  result: DiscoveredFile[],
  acpHarness: 'acp' | 'opencode',
): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(agentDir, { withFileTypes: true });
  } catch (err) {
    if (isPermissionError(err)) {
      warnings.push(`Permission denied while scanning ${agentDir}`);
    }
    return;
  }

  for (const entry of entries) {
    const name = String(entry.name);
    if (!entry.isFile()) continue;
    if (name === ACP_TRANSCRIPT_FILE) {
      result.push({ projectDir: agentDir, jsonlPath: join(agentDir, name), harness: acpHarness });
    } else if (isPiWorkAgentJsonl(name)) {
      result.push({ projectDir: agentDir, jsonlPath: join(agentDir, name), harness: piHarness });
    }
  }
}

async function collectJsonlFiles(
  projectDir: string,
  dir: string,
  harness: DiscoveredHarness,
  warnings: string[] = [],
  result: DiscoveredFile[] = [],
): Promise<DiscoveredFile[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissingRoot(err)) return result;
    if (isPermissionError(err)) {
      warnings.push(`Permission denied while scanning ${dir}`);
    }
    return result;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const fullPath = join(dir, name);
    if (entry.isFile() && name.endsWith('.jsonl')) {
      result.push({ projectDir, jsonlPath: fullPath, harness });
    } else if (entry.isDirectory()) {
      await collectJsonlFiles(projectDir, fullPath, harness, warnings, result);
    }
  }
  return result;
}

async function readAgentHarness(agentDir: string): Promise<AgentStateHarness | null> {
  try {
    const raw = await fs.readFile(join(agentDir, 'state.json'), 'utf8');
    const parsed = JSON.parse(raw) as { harness?: unknown };
    return typeof parsed.harness === 'string' ? parsed.harness : null;
  } catch {
    return null;
  }
}

function isPiWorkAgentJsonl(name: string): boolean {
  return /^[^/]+_[^/]+\.jsonl$/.test(name);
}

function projectDirMatchesAnyTarget(projectDir: string, targetEncodings: string[]): boolean {
  const hash = basename(projectDir);
  return targetEncodings.some((enc) => hash === enc || hash.startsWith(enc + '-'));
}

function isMissingRoot(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EPERM';
}
