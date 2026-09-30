import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// PAN-4408: end-to-end convergence of a stale vendored ('okf') skill variant
// through the full refreshCache -> executeSync / executeAgentSkills pipeline.
const dirs = vi.hoisted(() => ({
  base: '',
  claude: '',
  skills: '',
  agents: '',
  agentSkills: '',
  rules: '',
  commands: '',
  bin: '',
  syncSources: '',
  cacheManifest: '',
}));

vi.mock('../../../src/lib/paths.js', () => ({
  OVERDECK_HOME: join(dirs.base, 'overdeck'),
  SKILLS_DIR: dirs.skills,
  COMMANDS_DIR: dirs.commands,
  AGENTS_DIR: dirs.agents,
  AGENT_SKILLS_DIR: dirs.agentSkills,
  BIN_DIR: dirs.bin,
  CLAUDE_DIR: dirs.claude,
  SYNC_SOURCES: {
    skills: join(dirs.syncSources, 'skills'),
    devSkills: join(dirs.syncSources, 'dev-skills'),
    agents: join(dirs.syncSources, 'agents'),
    rules: join(dirs.syncSources, 'rules'),
  },
  CACHE_AGENTS_DIR: dirs.agents,
  CACHE_RULES_DIR: dirs.rules,
  CACHE_MANIFEST: dirs.cacheManifest,
  SYNC_TARGET: {
    skills: join(dirs.claude, 'skills'),
    commands: join(dirs.claude, 'commands'),
    agents: join(dirs.claude, 'agents'),
  },
  isDevMode: () => false,
}));

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function compareDirs(expectedDir: string, actualDir: string, rel = ''): string[] {
  const mismatches: string[] = [];
  const entries = readdirSync(expectedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__pycache__') continue;
    const expectedPath = join(expectedDir, entry.name);
    const actualPath = join(actualDir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      try {
        statSync(actualPath);
      } catch {
        mismatches.push(`missing dir: ${relPath}`);
        continue;
      }
      mismatches.push(...compareDirs(expectedPath, actualPath, relPath));
    } else {
      let actualContent: string;
      try {
        actualContent = readFileSync(actualPath, 'utf-8');
      } catch {
        mismatches.push(`missing file: ${relPath}`);
        continue;
      }
      const expectedContent = readFileSync(expectedPath, 'utf-8');
      if (actualContent !== expectedContent) mismatches.push(`content differs: ${relPath}`);
    }
  }
  return mismatches;
}

describe('end-to-end convergence of a stale vendored okf variant', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'pan-sync-okf-convergence-'));
    dirs.claude = join(dirs.base, 'home', '.claude');
    dirs.skills = join(dirs.base, 'overdeck', 'skills');
    dirs.agents = join(dirs.base, 'overdeck', 'agent-definitions');
    dirs.agentSkills = join(dirs.base, 'home', '.agents', 'skills');
    dirs.rules = join(dirs.base, 'overdeck', 'rules');
    dirs.commands = join(dirs.base, 'overdeck', 'commands');
    dirs.bin = join(dirs.base, 'overdeck', 'bin');
    dirs.syncSources = join(dirs.base, 'sync-sources');
    dirs.cacheManifest = join(dirs.base, 'overdeck', '.manifest.json');
  });

  beforeEach(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  it('converges both Claude Code and Agent Skills installs to the vendored sync-source tree', async () => {
    const sourceOkf = join(dirs.syncSources, 'skills', 'okf');
    write(join(sourceOkf, 'SKILL.md'), '# OKF Skill\nnew content\n');
    write(join(sourceOkf, 'LICENSE'), 'MIT License\nnew\n');
    write(join(sourceOkf, '.okf-skill-version'), 'v0.1.0\n');
    write(join(sourceOkf, 'templates', 'repo', '.github', 'workflows', 'conformance.yml'), 'name: conformance\n');

    const claudeOkf = join(dirs.claude, 'skills', 'okf');
    write(join(claudeOkf, 'SKILL.md'), '# OKF Skill\nold-variant\n');
    write(join(claudeOkf, 'LICENSE'), 'MIT License\nold-variant\n');
    write(join(claudeOkf, 'scripts', '__pycache__', 'x.pyc'), 'stale bytecode\n');

    const agentOkf = join(dirs.agentSkills, 'okf');
    write(join(agentOkf, 'SKILL.md'), '# OKF Skill\nold-variant\n');
    write(join(agentOkf, 'LICENSE'), 'MIT License\nold-variant\n');
    write(join(agentOkf, 'scripts', '__pycache__', 'x.pyc'), 'stale bytecode\n');

    const { hashFile, readManifest, setManifestEntry, writeManifest } = await import('../../../src/lib/manifest.js');
    const thirdContentPath = join(dirs.base, 'scratch-third-content');
    write(thirdContentPath, 'third content, matches neither variant\n');
    const thirdHash = hashFile(thirdContentPath);

    const claudeManifestPath = join(dirs.claude, '.overdeck-manifest.json');
    const claudeManifest = readManifest(claudeManifestPath);
    setManifestEntry(claudeManifest, 'skills/okf/SKILL.md', thirdHash, 'overdeck');
    setManifestEntry(claudeManifest, 'skills/okf/LICENSE', thirdHash, 'overdeck');
    writeManifest(claudeManifestPath, claudeManifest);

    const agentManifestPath = join(dirs.base, 'home', '.agents', '.overdeck-manifest.json');
    const agentManifest = readManifest(agentManifestPath);
    setManifestEntry(agentManifest, 'skills/okf/SKILL.md', thirdHash, 'overdeck');
    setManifestEntry(agentManifest, 'skills/okf/LICENSE', thirdHash, 'overdeck');
    writeManifest(agentManifestPath, agentManifest);

    const { refreshCache, executeSync } = await import('../../../src/lib/sync.js');
    const { executeAgentSkills } = await import('../../../src/lib/harness-skill-sync.js');

    refreshCache();
    const syncResult = executeSync();
    const agentResult = executeAgentSkills();

    expect(syncResult.conflicts).toEqual([]);
    expect(agentResult.conflicts).toEqual([]);

    expect(compareDirs(sourceOkf, claudeOkf)).toEqual([]);
    expect(compareDirs(sourceOkf, agentOkf)).toEqual([]);
  });
});
