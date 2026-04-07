/**
 * copy-live-config — Copy live Panopticon config into a workspace for UAT testing.
 *
 * Copies ~/.panopticon/config.yaml, ~/.panopticon/projects.yaml, and ~/.panopticon.env
 * into the workspace's .panopticon/ directory so a dashboard running inside the
 * workspace (or its Docker container) sees real project config and API keys.
 *
 * The workspace .panopticon/ is added to .git/info/exclude so these files are never
 * accidentally committed.
 *
 * If the workspace has docker-compose files, a volume mount entry is injected so
 * containers can access the config at ~/.panopticon/ inside the container.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CopyLiveConfigResult {
  copied: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Source config files to copy from ~/.panopticon/ and ~/.panopticon.env
 */
const CONFIG_SOURCES: Array<{ src: string; dest: string }> = [
  {
    src: join(homedir(), '.panopticon', 'config.yaml'),
    dest: 'config.yaml',
  },
  {
    src: join(homedir(), '.panopticon', 'projects.yaml'),
    dest: 'projects.yaml',
  },
  {
    src: join(homedir(), '.panopticon.env'),
    dest: '.env',
  },
];

/**
 * Add .panopticon/ to the workspace's .git/info/exclude so config files
 * are never accidentally committed to the feature branch.
 */
function updateGitExclude(workspacePath: string): void {
  const gitInfoDir = join(workspacePath, '.git', 'info');
  const excludeFile = join(gitInfoDir, 'exclude');

  // Worktrees have .git as a *file* (not a directory) pointing to the parent gitdir.
  // Regular repos have .git as a directory. Handle both cases.
  const gitPath = join(workspacePath, '.git');
  if (existsSync(gitPath) && statSync(gitPath).isFile()) {
    const gitContent = readFileSync(gitPath, 'utf-8').trim();
    if (gitContent.startsWith('gitdir:')) {
      const worktreeGitDir = gitContent.replace('gitdir:', '').trim();
      const worktreeExclude = join(worktreeGitDir, 'info', 'exclude');
      const worktreeInfoDir = join(worktreeGitDir, 'info');
      if (!existsSync(worktreeInfoDir)) mkdirSync(worktreeInfoDir, { recursive: true });
      appendExcludeEntry(worktreeExclude, '.panopticon/');
      return;
    }
  }

  if (!existsSync(gitInfoDir)) mkdirSync(gitInfoDir, { recursive: true });
  appendExcludeEntry(excludeFile, '.panopticon/');
}

function appendExcludeEntry(excludeFile: string, pattern: string): void {
  let existing = '';
  if (existsSync(excludeFile)) {
    existing = readFileSync(excludeFile, 'utf-8');
  }
  const lines = existing.split('\n');
  if (!lines.some(l => l.trim() === pattern)) {
    const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(excludeFile, `${existing}${suffix}${pattern}\n`, 'utf-8');
  }
}

/**
 * Inject a volume mount for .panopticon/ into any docker-compose files found
 * in the workspace so containers see the copied config at ~/.panopticon/.
 *
 * Only modifies services that have a `volumes:` key or a service section —
 * uses a simple YAML append approach that works for standard compose files.
 */
export function injectComposeConfigMount(workspacePath: string): string[] {
  const composePaths = [
    join(workspacePath, 'docker-compose.yml'),
    join(workspacePath, 'docker-compose.yaml'),
    join(workspacePath, '.devcontainer', 'docker-compose.yml'),
    join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
  ].filter(p => existsSync(p));

  const modified: string[] = [];
  const mountEntry = '      - ./.panopticon:${HOME}/.panopticon:ro';
  const markerComment = '# panopticon-uat-config-mount';

  for (const composePath of composePaths) {
    let content = readFileSync(composePath, 'utf-8');

    // Skip if already patched
    if (content.includes(markerComment)) continue;

    // Find `volumes:` blocks inside service definitions and append the mount.
    // This regex finds `volumes:` inside a service block (indented under services:)
    // and appends our mount entry after the last volume in the block.
    const volumeBlockRe = /^(\s{4,}volumes:\s*\n)((?:\s{6,}-.+\n)*)/gm;
    let patched = false;
    content = content.replace(volumeBlockRe, (match, header, entries) => {
      patched = true;
      return `${header}${entries}${mountEntry} ${markerComment}\n`;
    });

    if (!patched) {
      // No volumes block found — skip rather than corrupt the compose file
      continue;
    }

    writeFileSync(composePath, content, 'utf-8');
    modified.push(composePath);
  }

  return modified;
}

/**
 * Copy live Panopticon config files into the workspace's .panopticon/ directory.
 *
 * @param workspacePath Absolute path to the workspace directory
 * @param opts.updateCompose  Also inject a volume mount in docker-compose files (default: false)
 */
export async function copyLiveConfigToWorkspace(
  workspacePath: string,
  opts: { updateCompose?: boolean } = {},
): Promise<CopyLiveConfigResult> {
  const result: CopyLiveConfigResult = { copied: [], skipped: [], errors: [] };

  const destDir = join(workspacePath, '.panopticon');
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  for (const { src, dest } of CONFIG_SOURCES) {
    if (!existsSync(src)) {
      result.skipped.push(`${src} (not found)`);
      continue;
    }
    const destPath = join(destDir, dest);
    try {
      await copyFile(src, destPath);
      result.copied.push(dest);
    } catch (err: any) {
      result.errors.push(`Failed to copy ${dest}: ${err.message}`);
    }
  }

  // Always add .panopticon/ to git exclude so the files aren't staged
  try {
    updateGitExclude(workspacePath);
  } catch (err: any) {
    result.errors.push(`Failed to update .git/info/exclude: ${err.message}`);
  }

  if (opts.updateCompose) {
    try {
      const modified = injectComposeConfigMount(workspacePath);
      for (const p of modified) result.copied.push(`compose mount → ${p}`);
    } catch (err: any) {
      result.errors.push(`Failed to update docker-compose: ${err.message}`);
    }
  }

  return result;
}
