/**
 * Workspace Manager
 *
 * Handles workspace creation and removal for both monorepo and polyrepo projects.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, realpathSync, rmSync, unlinkSync, lstatSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import {
  replacePlaceholdersSync,
  getDefaultWorkspaceConfigSync,
} from './workspace-config.js';
import { addDnsEntry, removeDnsEntry, syncDnsToWindows } from './dns.js';
import { addTunnelIngress, removeTunnelIngress } from './tunnel.js';
import { createHumeConfig, deleteHumeConfig } from './hume.js';
import { mergeSkillsIntoWorkspaceSync, mergePanSkillsIntoWorkspaceSync } from './skills-merge.js';
import { loadConfigSync as loadYamlConfig } from './config-yaml.js';
import {
  PAN_CONTEXT_FILENAME,
  PAN_CONTINUE_FILENAME,
  PAN_DIRNAME,
  PAN_FEEDBACK_DIRNAME,
  PAN_SESSIONS_FILENAME,
} from './pan-dir/index.js';
import { FsError, ProcessSpawnError } from './errors.js';
import { copyOverdeckSettingsToWorkspaceSync, ensurePanGitignoreSync, migrateOverdeckToPanSync } from './workspace-manager/migration.js';
import {
  assignPort,
  copyProjectTemplateDirs,
  createWorktree,
  preTrustDirectorySync,
  releasePort,
  relocateVenvScripts,
  removeWorktree,
  restorePreWorktreeMetadataSync,
  stagePreWorktreeMetadataSync,
  validateFeatureName,
} from './workspace-manager/worktree-ops.js';
import type {
  AddReposToWorkspaceOptions,
  AddReposToWorkspaceResult,
  DockerCleanupResult,
  PanMigrationResult,
  WorkspaceCreateOptions,
  WorkspaceCreateResult,
  WorkspaceProgress,
  WorkspaceRemoveOptions,
  WorkspaceRemoveResult,
} from './workspace-manager/types.js';
export type {
  AddReposToWorkspaceOptions,
  AddReposToWorkspaceResult,
  DockerCleanupResult,
  PanMigrationResult,
  WorkspaceCreateOptions,
  WorkspaceCreateResult,
  WorkspaceProgress,
  WorkspaceRemoveOptions,
  WorkspaceRemoveResult,
} from './workspace-manager/types.js';
export { copyOverdeckSettingsToWorkspaceSync, ensurePanGitignoreSync, migrateOverdeckToPanSync } from './workspace-manager/migration.js';
export { preTrustDirectorySync, relocateVenvScripts } from './workspace-manager/worktree-ops.js';

const execAsync = promisify(exec);

// Placeholder construction, compose-file sanitization, and template
// processing live in `./workspace/devcontainer-renderer.ts` so the renderer
// is a single source of truth shared by:
//   - the workspace-creation flow below (`createWorkspace`)
//   - the self-heal entry point (`./workspace/ensure-devcontainer.ts`)
//   - any future caller (e.g. `pan workspace re-render`)
// Re-export under the legacy local name to keep diffs in this file small.
import {
  createWorkspacePlaceholdersSync as createPlaceholders,
  sanitizeComposeFileSync,
  renderDevcontainerSync,
  DEVCONTAINER_DIRNAME,
} from './workspace/devcontainer-renderer.js';
// `processTemplates` is still imported for the agent-template flow further
// below; it lives in the same renderer module.
import { processTemplatesSync } from './workspace/devcontainer-renderer.js';

// DNS functions (addWsl2HostEntry, removeWsl2HostEntry, syncDnsToWindows)
// are now in src/lib/dns.ts and imported above

// `processTemplates` was previously defined inline here; it now lives in
// `./workspace/devcontainer-renderer.ts` and is imported above so the
// devcontainer renderer and the agent-template flow share a single
// implementation.
async function createWorkspacePromise(options: WorkspaceCreateOptions): Promise<WorkspaceCreateResult> {
  const { projectConfig, featureName, startDocker, dryRun, onProgress } = options;
  const progress = (label: string, detail: string, status: 'active' | 'complete' | 'error' = 'active') => {
    onProgress?.({ label, detail, status });
  };
  const result: WorkspaceCreateResult = {
    success: true,
    workspacePath: '',
    errors: [],
    steps: [],
  };

  // Validate feature name
  if (!validateFeatureName(featureName)) {
    result.success = false;
    result.errors.push('Invalid feature name. Use alphanumeric and hyphens only.');
    return result;
  }

  // Reject 'main' as feature name
  if (featureName === 'main') {
    result.success = false;
    result.errors.push('Cannot create workspace for "main". Use base repos directly.');
    return result;
  }

  const workspaceConfig = projectConfig.workspace || getDefaultWorkspaceConfigSync();
  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const featureFolder = `feature-${featureName}`;
  const workspacePath = join(workspacesDir, featureFolder);
  result.workspacePath = workspacePath;

  if (dryRun) {
    result.steps.push('[DRY RUN] Would create workspace at: ' + workspacePath);
    return result;
  }

  // A failed auto-plan/start can leave only orchestration metadata at the
  // future workspace path. Stage it so `git worktree add` sees a clean target,
  // then merge it back into the real worktree after creation.
  let stagedMetadataPath: string | null = null;
  if (existsSync(workspacePath)) {
    stagedMetadataPath = stagePreWorktreeMetadataSync(workspacePath);
    if (stagedMetadataPath) {
      result.steps.push('Staged pre-worktree .pan/.beads metadata');
    } else {
      result.success = false;
      result.errors.push(`Workspace already exists at ${workspacePath}`);
      return result;
    }
  }

  // Create placeholders
  const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);

  progress('Creating git worktree', `feature/${featureName}`);

  // Handle polyrepo vs monorepo
  if (workspaceConfig.type === 'polyrepo' && workspaceConfig.repos) {
    // Polyrepo workspaces need a root container for child repo worktrees and
    // symlinks. Monorepo worktrees must let git create the target directory.
    mkdirSync(workspacePath, { recursive: true });
    result.steps.push('Created workspace directory');

    // Determine which repos to create: in progressive mode, only always_include repos
    const reposToCreate = workspaceConfig.progressive && workspaceConfig.always_include
      ? workspaceConfig.repos.filter(r => workspaceConfig.always_include!.includes(r.name))
      : workspaceConfig.repos;

    // Create worktrees/symlinks for each repo
    for (const repo of reposToCreate) {
      const rawRepoPath = join(projectConfig.path, repo.path);
      const repoPath = existsSync(rawRepoPath) ? realpathSync(rawRepoPath) : rawRepoPath;
      const targetPath = join(workspacePath, repo.name);

      if (repo.link_type === 'symlink') {
        // Symlink for meta/docs repos - no git worktree, no feature branch
        try {
          symlinkSync(repoPath, targetPath);
          result.steps.push(`Created symlink for ${repo.name} (readonly, no feature branch)`);
        } catch (symlinkErr: any) {
          result.errors.push(`${repo.name}: ${symlinkErr.message}`);
          result.success = false;
        }
      } else {
        // Worktree for regular repos
        const branchPrefix = repo.branch_prefix || 'feature/';
        const branchName = `${branchPrefix}${featureName}`;
        // Per-repo default_branch overrides workspace-level, falls back to 'main'
        const defaultBranch = repo.default_branch || workspaceConfig.default_branch || 'main';

        const worktreeResult = await createWorktree(repoPath, targetPath, branchName, defaultBranch);
        if (worktreeResult.success) {
          result.steps.push(`Created worktree for ${repo.name}: ${branchName} (from ${defaultBranch})`);
        } else {
          result.errors.push(`${repo.name}: ${worktreeResult.message}`);
          result.success = false; // Fail the entire workspace creation if any worktree fails
        }
      }
    }
  } else {
    // Monorepo: create single worktree
    const branchName = `feature/${featureName}`;
    const defaultBranch = workspaceConfig.default_branch || 'main';
    const worktreeResult = await createWorktree(projectConfig.path, workspacePath, branchName, defaultBranch);
    if (worktreeResult.success) {
      result.steps.push(`Created worktree: ${branchName} (from ${defaultBranch})`);
    } else {
      result.errors.push(worktreeResult.message);
      result.success = false; // Fail the entire workspace creation if worktree fails
    }
  }

  if (!result.success) {
    restorePreWorktreeMetadataSync(stagedMetadataPath, workspacePath);
    progress('Creating git worktree', 'Worktree creation failed', 'error');
    return result;
  }

  restorePreWorktreeMetadataSync(stagedMetadataPath, workspacePath);

  // For polyrepo workspaces, create a beads redirect at the workspace root
  // pointing to the first repo that has a .beads/ directory. Without this,
  // agents starting at the workspace root can't find beads and try to re-init.
  if (workspaceConfig.type === 'polyrepo' && workspaceConfig.repos) {
    const workspaceBeadsDir = join(workspacePath, '.beads');
    if (!existsSync(workspaceBeadsDir)) {
      for (const repo of workspaceConfig.repos) {
        const sourceRepoPath = join(projectConfig.path, repo.path);
        const repoBeadsDir = existsSync(sourceRepoPath)
          ? join(realpathSync(sourceRepoPath), '.beads')
          : join(sourceRepoPath, '.beads');
        if (existsSync(repoBeadsDir) && !existsSync(join(repoBeadsDir, 'redirect'))) {
          try {
            mkdirSync(workspaceBeadsDir, { recursive: true });
            writeFileSync(join(workspaceBeadsDir, 'redirect'), repoBeadsDir, 'utf-8');
            result.steps.push(`Created beads redirect at workspace root → ${repo.name}/.beads`);
          } catch { /* non-fatal */ }
          break;
        }
      }
    }
  }

  progress('Creating git worktree', 'Worktree ready', 'complete');

  // Clear stale workspace-local runtime state inherited from main.
  // Keep canonical plan state (.pan/spec.vbrief.json); clear only mutable
  // per-workspace artifacts that would belong to a previous issue/session.
  // SAFETY: resolve() to absolute path and verify it's under a known workspace prefix
  // to prevent path traversal from ever reaching rmSync.
  const resolvedWorkspace = resolve(workspacePath);
  const resolvedPanDir = resolve(resolvedWorkspace, PAN_DIRNAME);
  const isUnderWorkspacesDir = resolvedWorkspace.match(/\/workspaces\/feature-[a-z0-9-]+$/);
  if (isUnderWorkspacesDir && existsSync(join(resolvedWorkspace, '.git'))) {
    if (resolvedPanDir === join(resolvedWorkspace, PAN_DIRNAME) && existsSync(resolvedPanDir)) {
      for (const filePath of [
        join(resolvedPanDir, PAN_CONTINUE_FILENAME),
        join(resolvedPanDir, PAN_SESSIONS_FILENAME),
        join(resolvedPanDir, PAN_CONTEXT_FILENAME),
      ]) {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      }

      const feedbackDir = join(resolvedPanDir, PAN_FEEDBACK_DIRNAME);
      if (existsSync(feedbackDir)) {
        rmSync(feedbackDir, { recursive: true, force: true });
      }
    }

    result.steps.push('Cleared stale workspace-local .pan runtime state');
  }

  // Ensure runtime-only Overdeck and Claude Code sync paths are in the project's .gitignore
  try {
    ensurePanGitignoreSync(projectConfig.path);
    result.steps.push('Verified runtime-only Overdeck and Claude Code sync paths are in .gitignore');
  } catch (gitignoreErr: any) {
    // Non-fatal — log but don't block workspace creation
    result.steps.push(`Warning: could not update .gitignore: ${gitignoreErr.message}`);
  }

  // Sanitize any docker-compose files in the workspace to use platform-agnostic paths
  // This handles files inherited from worktrees that may have hardcoded home paths
  const devcontainerDir = join(workspacePath, '.devcontainer');
  if (existsSync(devcontainerDir)) {
    const composeFiles = readdirSync(devcontainerDir)
      .filter(f => f.includes('compose') && (f.endsWith('.yml') || f.endsWith('.yaml')));
    for (const composeFile of composeFiles) {
      sanitizeComposeFileSync(join(devcontainerDir, composeFile));
    }
    if (composeFiles.length > 0) {
      result.steps.push(`Sanitized ${composeFiles.length} compose file(s) for platform compatibility`);
    }
  }

  // Install dependencies using the project's package manager.
  // Stale or partial node_modules from a previous failed install can leave broken symlinks
  // (e.g. packages/contracts/node_modules/tsdown → missing .bun store entry) that make
  // Docker init containers fail with ERR_MODULE_NOT_FOUND. Wipe any existing node_modules
  // before installing so bun always starts from a clean slate.
  progress('Installing dependencies', projectConfig.package_manager || 'detecting...');
  const pkgManager = projectConfig.package_manager || (existsSync(join(workspacePath, 'bun.lock')) ? 'bun' : 'npm');

  // Remove stale node_modules directories (root + nested workspace packages) before install
  const staleModulesDirs = [
    join(workspacePath, 'node_modules'),
    ...(projectConfig.workspace_packages ?? []).map(p => join(workspacePath, p.path, 'node_modules')),
  ];
  for (const dir of staleModulesDirs) {
    if (existsSync(dir)) {
      await execAsync(`rm -rf "${dir}"`);
    }
  }

  const installCmd = pkgManager === 'bun' ? 'bun install' : `${pkgManager} install`;
  try {
    // No timeout — cold installs on fresh machines can take several minutes.
    // A failed install leaves a broken workspace; treat it as fatal.
    await execAsync(installCmd, { cwd: workspacePath, encoding: 'utf-8' });
    result.steps.push(`Installed dependencies (${pkgManager})`);
    progress('Installing dependencies', `${pkgManager} — done`, 'complete');
  } catch (installErr: any) {
    const msg = `Dependency install failed (${pkgManager}): ${installErr.message?.slice(0, 200)}`;
    result.errors.push(msg);
    progress('Installing dependencies', 'Failed — workspace creation aborted', 'complete');
    return result;
  }

  // Build workspace packages (e.g., @overdeck/contracts) so types resolve correctly
  const workspacePackages = projectConfig.workspace_packages;
  if (workspacePackages && workspacePackages.length > 0) {
    progress('Building workspace packages', workspacePackages.map(p => p.path).join(', '));
    for (const pkg of workspacePackages) {
      try {
        // No timeout — tsdown builds can be slow on first run with a cold cache.
        await execAsync(pkg.build_command, { cwd: join(workspacePath, pkg.path), encoding: 'utf-8' });
        result.steps.push(`Built workspace package: ${pkg.path}`);
      } catch (buildErr: any) {
        const msg = `Workspace package build failed (${pkg.path}): ${buildErr.message?.slice(0, 200)}`;
        result.errors.push(msg);
        progress('Building workspace packages', `Failed on ${pkg.path} — workspace creation aborted`, 'complete');
        return result;
      }
    }
    progress('Building workspace packages', 'Packages built', 'complete');
  }

  // Setup TLDR code analysis for workspace (after worktree creation to ensure directory is ready)
  try {
    // Check if python3 is available
    await execAsync('python3 --version');
    const venvPath = join(workspacePath, '.venv');
    const tldrBin = join(venvPath, 'bin', 'tldr');

    // Check if main branch already has a working venv with llm-tldr
    const mainVenvTldr = join(projectConfig.path, '.venv', 'bin', 'tldr');
    const mainVenvExists = existsSync(mainVenvTldr);

    if (mainVenvExists) {
      // Copy the entire venv from main — faster than pip install (seconds vs 30s+)
      const mainVenvPath = join(projectConfig.path, '.venv');
      await execAsync(`cp -a "${mainVenvPath}" "${venvPath}"`);
      // Python venvs are NOT relocatable: `cp -a` preserves the source venv's
      // absolute interpreter path in every bin/* shebang + activate script.
      // Rewrite the copy so each script points at the workspace venv's OWN
      // python — otherwise a repo rename breaks the TLDR MCP server + enforcer
      // (see relocateVenvScripts docstring).
      relocateVenvScripts(mainVenvPath, venvPath);
      result.steps.push('Copied Python venv from main branch (shebangs relocated)');
    } else {
      // Create fresh venv and install llm-tldr
      await execAsync(`python3 -m venv "${venvPath}"`, { cwd: workspacePath });
      const pipPath = join(venvPath, 'bin', 'pip');
      await execAsync(`"${pipPath}" install llm-tldr`, { cwd: workspacePath, timeout: 120000 });
      result.steps.push('Created Python venv and installed llm-tldr');

      // Apply .tsx/.jsx support patch (upstream llm-tldr only checks .ts)
      const patchScript = join(projectConfig.path, 'scripts', 'patches', 'llm-tldr-tsx-support.py');
      if (existsSync(patchScript)) {
        await execAsync(`python3 "${patchScript}" "${venvPath}"`);
        result.steps.push('Applied llm-tldr .tsx/.jsx patch');
      }
    }

    // Verify tldr binary exists after setup
    if (!existsSync(tldrBin)) {
      result.steps.push('TLDR setup incomplete: tldr binary not found after venv creation');
    } else {
      // Copy .tldr index from main branch if it exists
      const mainTldrDir = join(projectConfig.path, '.tldr');
      const workspaceTldrDir = join(workspacePath, '.tldr');

      if (existsSync(mainTldrDir)) {
        await execAsync(`cp -r "${mainTldrDir}" "${workspaceTldrDir}"`);
        result.steps.push('Copied TLDR index from main branch');
      }

      // Start TLDR daemon for this workspace
      const { getTldrDaemonServiceSync } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonServiceSync(workspacePath, venvPath);
      await tldrService.start(true);
      result.steps.push('Started TLDR daemon');

      // Warm the index in the background — ensures workspaces always have a working index
      // even when the main branch cache was empty (nothing to copy)
      try {
        await tldrService.warm(true);  // background=true: non-blocking
        result.steps.push('TLDR index warm initiated (background)');
      } catch {
        // Non-fatal — daemon may not support warm yet
      }
    }
  } catch (error: any) {
    // TLDR setup is optional — don't fail workspace creation, but log clearly
    if (error.message?.includes('python3')) {
      result.steps.push('Skipped TLDR setup (python3 not available)');
    } else {
      console.warn(`⚠ TLDR setup failed: ${error.message}`);
      result.steps.push(`TLDR setup failed: ${error.message}`);
    }
  }

  // Configure DNS
  if (workspaceConfig.dns) {
    const dnsMethod = workspaceConfig.dns.sync_method || 'wsl2hosts';
    for (const entryPattern of workspaceConfig.dns.entries) {
      const hostname = replacePlaceholdersSync(entryPattern, placeholders);

      if (addDnsEntry(dnsMethod, hostname)) {
        result.steps.push(`Added DNS entry: ${hostname} (${dnsMethod})`);
      }
    }

    // Sync to Windows if using wsl2hosts method
    if (dnsMethod === 'wsl2hosts') {
      const synced = await syncDnsToWindows();
      if (synced) {
        result.steps.push('Synced DNS to Windows hosts file');
      }
    }
  }

  // Assign ports
  if (workspaceConfig.ports) {
    for (const [portName, portConfig] of Object.entries(workspaceConfig.ports)) {
      const portFile = join(projectConfig.path, `.${portName}-ports`);
      try {
        const port = assignPort(portFile, featureFolder, portConfig.range);
        result.steps.push(`Assigned ${portName} port: ${port}`);
        // Add to placeholders for use in templates
        (placeholders as any)[`${portName.toUpperCase()}_PORT`] = String(port);
      } catch (error) {
        result.errors.push(`Failed to assign ${portName} port: ${error}`);
      }
    }
  }

  // Install base Overdeck skills/agents/rules from cache
  progress('Installing skills & templates', 'Overdeck skills, agents, rules');
  const mergeResult = mergeSkillsIntoWorkspaceSync(workspacePath);
  const mergeTotal = mergeResult.added.length + mergeResult.updated.length;
  if (mergeTotal > 0) {
    result.steps.push(`Installed ${mergeTotal} Overdeck files (${mergeResult.added.length} new, ${mergeResult.updated.length} updated)`);
  }

  // Overlay project-local skills from .pan/skills/ (higher precedence than global cache)
  const panMergeResult = mergePanSkillsIntoWorkspaceSync(projectConfig.path, workspacePath);
  if (panMergeResult.added.length > 0) {
    result.steps.push(`Installed ${panMergeResult.added.length} project-local skill file(s) from .pan/skills/ (${panMergeResult.overlayed.join(', ')})`);
  }

  // Process agent templates (project template overlay — wins over Overdeck base)
  if (workspaceConfig.agent?.template_dir) {
    const templateDir = join(projectConfig.path, workspaceConfig.agent.template_dir);

    // Process template files
    const templateSteps = processTemplatesSync(
      templateDir,
      workspacePath,
      placeholders,
      workspaceConfig.agent.templates
    );
    result.steps.push(...templateSteps);

    // Copy .claude/ directories from project template (copy_dirs replaces legacy symlinks)
    const dirsToSync = workspaceConfig.agent.copy_dirs || workspaceConfig.agent.symlinks;
    if (dirsToSync) {
      const copySteps = copyProjectTemplateDirs(templateDir, workspacePath, dirsToSync, placeholders);
      result.steps.push(...copySteps);
    }
  }

  // Generate .env file
  if (workspaceConfig.env?.template) {
    const envContent = replacePlaceholdersSync(workspaceConfig.env.template, placeholders);
    writeFileSync(join(workspacePath, '.env'), envContent);
    result.steps.push('Created .env file');
  }

  // Render the workspace's `.devcontainer/` from the project's compose
  // template. All template processing, file copies, $HOME sanitization, and
  // ./dev symlink wiring lives in `renderDevcontainer` so the same code path
  // is used here, by `ensureDevcontainer` (self-heal), and by any future
  // re-render command. See `./workspace/devcontainer-renderer.ts`.
  if (workspaceConfig.docker?.compose_template) {
    try {
      const renderResult = renderDevcontainerSync({
        workspacePath,
        projectConfig,
        featureName,
      });
      result.steps.push(...renderResult.steps);
      for (const warning of renderResult.warnings) {
        result.errors.push(warning);
      }
    } catch (err: any) {
      result.errors.push(`Failed to render .devcontainer/: ${err.message ?? err}`);
    }
  }

  // Note: Beads initialization is handled by the calling command (workspace.ts)
  // With beads v0.47.1+, worktrees use shared database with labels for isolation
  // The workspace.ts command creates a bead with workspace:issue-id label

  // Set up Cloudflare tunnel for external access (before Docker so containers can use tunnel URLs)
  if (workspaceConfig.tunnel) {
    const tunnelResult = await Effect.runPromise(addTunnelIngress(workspaceConfig.tunnel, placeholders));
    result.steps.push(...tunnelResult.steps);
    if (!tunnelResult.success) {
      result.errors.push('Tunnel setup had failures (see steps for details)');
    }
  }

  // Create Hume EVI config and write env file for Docker (before Docker so containers pick up the config ID)
  if (workspaceConfig.hume) {
    const humeResult = await Effect.runPromise(createHumeConfig(workspaceConfig.hume, placeholders));
    result.steps.push(...humeResult.steps);
    if (humeResult.configId) {
      writeFileSync(
        join(workspacePath, '.hume-config'),
        `HUME_CONFIG_ID=${humeResult.configId}\nVITE_HUME_CONFIG_ID=${humeResult.configId}\n`,
      );
      result.steps.push('Wrote .hume-config with Hume EVI config ID');
    }
    if (!humeResult.success) {
      result.errors.push('Hume EVI config setup had failures (see steps for details)');
    }
  }

  progress('Installing skills & templates', 'Skills and templates ready', 'complete');

  // Start Docker containers if requested
  if (startDocker) {
    progress('Starting Docker containers', 'Building and starting services');
    // Check for Traefik
    if (workspaceConfig.docker?.traefik) {
      // Always use the installed Traefik location (~/.overdeck/traefik/), not the
      // template source in projects.yaml. The template is copied to ~/.overdeck/traefik/
      // during `pan install`, and the installed copy has the correct volume mounts
      // (dynamic configs, certs) relative to ~/.overdeck/traefik/.
      const traefikPath = join(homedir(), '.overdeck', 'traefik', 'docker-compose.yml');
      if (existsSync(traefikPath)) {
        try {
          await execAsync(`docker compose -f "${traefikPath}" up -d`, { cwd: join(homedir(), '.overdeck', 'traefik') });
          result.steps.push('Started Traefik');
        } catch (error: any) {
          const msg = error?.message || String(error);
          if (msg.includes('port is already allocated') || msg.includes('address already in use')) {
            // Traefik (or another reverse proxy) is already running — not an error
            result.steps.push('Traefik already running (port in use)');
          } else {
            result.errors.push(`Failed to start Traefik: ${error}`);
          }
        }
      }
    }

    // Start workspace containers
    const composeLocations = [
      join(workspacePath, 'docker-compose.yml'),
      join(workspacePath, 'docker-compose.yaml'),
      join(workspacePath, '.devcontainer', 'docker-compose.yml'),
      join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
    ];

    for (const composePath of composeLocations) {
      if (existsSync(composePath)) {
        try {
          // Don't pass -p: the compose file's `name:` field is the authority.
          // Passing -p with a different value creates a second Docker project
          // on container restart, splitting services onto separate networks.
          await execAsync(`docker compose -f "${composePath}" up -d --build`, { cwd: dirname(composePath), timeout: 300000 });
          result.steps.push(`Started containers from ${basename(composePath)}`);
        } catch (error) {
          result.errors.push(`Failed to start containers: ${error}`);
        }
        break;
      }
    }
  }

  if (startDocker) {
    progress('Starting Docker containers', 'Containers running', 'complete');
  }

  // Pre-trust workspace directory in Claude Code so agents don't get the trust prompt
  try {
    preTrustDirectorySync(workspacePath);
    result.steps.push('Pre-trusted workspace in Claude Code');
  } catch {
    // Non-fatal — agent can still work, user will just see trust prompt
  }

  // Inject caveman hooks into workspace .claude/settings.json (if enabled in config)
  try {
    const { determineCavemanVariant, injectCavemanSettings } = await import('./caveman/workspace.js');
    const yamlConfig = loadYamlConfig();
    const cavemanConfig = yamlConfig.config.caveman;
    const variant = determineCavemanVariant(cavemanConfig);
    await Effect.runPromise(injectCavemanSettings(workspacePath, variant));
    if (variant === 'enabled') {
      result.steps.push('Injected caveman compression hooks into .claude/settings.json');
    } else if (variant === 'disabled') {
      result.steps.push('Caveman A/B test: assigned disabled variant for this workspace');
    }
  } catch (cavemanErr: unknown) {
    // Non-fatal — workspace works without caveman
    result.steps.push(`Caveman setup skipped: ${cavemanErr instanceof Error ? cavemanErr.message : String(cavemanErr)}`);
  }

  // Copy Overdeck global settings into workspace so agents testing Overdeck
  // itself have the same projects, model assignments, and hooks.
  try {
    const settingsResult = copyOverdeckSettingsToWorkspaceSync(workspacePath);
    if (settingsResult.copied.length > 0) {
      result.steps.push(`Copied Overdeck settings into workspace (${settingsResult.copied.length} file(s))`);
    }
  } catch (settingsErr: unknown) {
    result.steps.push(`Overdeck settings copy skipped: ${settingsErr instanceof Error ? settingsErr.message : String(settingsErr)}`);
  }

  try {
    const { injectMemoryHookSettings } = await import('./caveman/workspace.js');
    await injectMemoryHookSettings(workspacePath);
    result.steps.push('Injected memory hooks into .claude/settings.json');
  } catch (memoryHookErr: unknown) {
    result.steps.push(`Memory hook setup skipped: ${memoryHookErr instanceof Error ? memoryHookErr.message : String(memoryHookErr)}`);
  }

  result.success = result.errors.length === 0;
  return result;
}

async function addReposToWorkspacePromise(options: AddReposToWorkspaceOptions): Promise<AddReposToWorkspaceResult> {
  const { projectConfig, featureName, repoNames, dryRun } = options;
  const result: AddReposToWorkspaceResult = {
    success: true,
    errors: [],
    steps: [],
  };

  const workspaceConfig = projectConfig.workspace;
  if (!workspaceConfig || workspaceConfig.type !== 'polyrepo' || !workspaceConfig.repos) {
    result.success = false;
    result.errors.push('Project does not use polyrepo workspace configuration');
    return result;
  }

  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const workspacePath = join(workspacesDir, `feature-${featureName}`);

  if (!existsSync(workspacePath)) {
    result.success = false;
    result.errors.push(`Workspace not found at ${workspacePath}`);
    return result;
  }

  if (dryRun) {
    result.steps.push(`[DRY RUN] Would add repos to workspace at: ${workspacePath}`);
    return result;
  }

  // Find the repos to add
  const reposToAdd = workspaceConfig.repos.filter(r => repoNames.includes(r.name));
  const unknownRepos = repoNames.filter(name => !reposToAdd.some(r => r.name === name));

  if (unknownRepos.length > 0) {
    result.errors.push(`Unknown repos: ${unknownRepos.join(', ')}`);
    result.success = false;
  }

  // Check which repos are already in the workspace
  const existingEntries = readdirSync(workspacePath).filter(f => {
    const fullPath = join(workspacePath, f);
    return f !== '.planning' && f !== '.claude' && f !== '.pan' && f !== '.beads' && existsSync(fullPath);
  });

  for (const repo of reposToAdd) {
    if (existingEntries.includes(repo.name)) {
      result.steps.push(`Skipped ${repo.name}: already exists in workspace`);
      continue;
    }

    const rawRepoPath = join(projectConfig.path, repo.path);
    const repoPath = existsSync(rawRepoPath) ? realpathSync(rawRepoPath) : rawRepoPath;
    const targetPath = join(workspacePath, repo.name);

    if (repo.link_type === 'symlink') {
      try {
        symlinkSync(repoPath, targetPath);
        result.steps.push(`Added symlink for ${repo.name} (readonly)`);
      } catch (symlinkErr: any) {
        result.errors.push(`${repo.name}: ${symlinkErr.message}`);
        result.success = false;
      }
    } else {
      const branchPrefix = repo.branch_prefix || 'feature/';
      const branchName = `${branchPrefix}${featureName}`;
      const defaultBranch = repo.default_branch || workspaceConfig.default_branch || 'main';

      const worktreeResult = await createWorktree(repoPath, targetPath, branchName, defaultBranch);
      if (worktreeResult.success) {
        result.steps.push(`Added worktree for ${repo.name}: ${branchName} (from ${defaultBranch})`);
      } else {
        result.errors.push(`${repo.name}: ${worktreeResult.message}`);
        result.success = false;
      }
    }
  }

  return result;
}

async function getContainersReferencingWorkspacePathPromise(
  workspacePath: string,
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --format '{{.ID}}|{{.Label "com.docker.compose.project.config_files"}}'`,
      { encoding: 'utf-8' },
    );
    const containers: string[] = [];
    const devcontainerPath = join(workspacePath, DEVCONTAINER_DIRNAME);
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const sep = line.indexOf('|');
      if (sep === -1) continue;
      const configFiles = line.slice(sep + 1);
      if (configFiles.includes(devcontainerPath)) {
        containers.push(line.slice(0, sep));
      }
    }
    return containers;
  } catch {
    return [];
  }
}async function stopWorkspaceDockerPromise(
  workspacePath: string,
  featureName: string,
): Promise<DockerCleanupResult> {
  const result: DockerCleanupResult = {
    containersFound: false,
    steps: [],
  };

  // Find all compose files in devcontainer directory (some projects use multiple)
  const devcontainerDir = join(workspacePath, DEVCONTAINER_DIRNAME);
  const composeFiles: string[] = [];

  if (existsSync(devcontainerDir)) {
    const possibleFiles = [
      'docker-compose.devcontainer.yml',
      'docker-compose.yml',
      'compose.yml',
      'compose.infra.yml',
      'compose.override.yml',
    ];
    for (const file of possibleFiles) {
      const fullPath = join(devcontainerDir, file);
      if (existsSync(fullPath)) {
        composeFiles.push(fullPath);
      }
    }
  }

  // Fallback: check for compose file in workspace root
  if (composeFiles.length === 0) {
    const rootCompose = join(workspacePath, 'docker-compose.yml');
    if (existsSync(rootCompose)) {
      composeFiles.push(rootCompose);
    }
  }

  const featureFolder = `feature-${featureName}`;
  const composeProjectName = `overdeck-${featureFolder}`;
  const devScriptPaths = [
    join(workspacePath, DEVCONTAINER_DIRNAME, 'dev'),
    join(workspacePath, 'dev'),
  ];
  for (const devPath of devScriptPaths) {
    try {
      if (!existsSync(devPath)) continue;
      const content = readFileSync(devPath, 'utf-8');
      const templatedMatch = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
      const declared = templatedMatch
        ? `${templatedMatch[1]}${featureFolder}`
        : content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/)?.[1];
      if (declared && declared !== composeProjectName) {
        throw new Error(`${devPath} declares COMPOSE_PROJECT_NAME=${declared}, expected ${composeProjectName}`);
      }
    } catch (error: any) {
      if (error?.message?.includes('declares COMPOSE_PROJECT_NAME=')) throw error;
    }
  }

  if (composeFiles.length > 0) {
    result.containersFound = true;
    try {
      const fileFlags = composeFiles.map(f => `-f "${f}"`).join(' ');
      const cwd = existsSync(devcontainerDir) ? devcontainerDir : workspacePath;

      await execAsync(`docker compose ${fileFlags} -p "${composeProjectName}" down -v --remove-orphans`, {
        cwd,
        timeout: 60000,
      });
      result.steps.push(`Stopped Docker containers (${composeFiles.length} compose files)`);
    } catch (error: any) {
      // Log but don't fail — containers might not be running
      result.steps.push(`Docker cleanup attempted (${error.message?.split('\n')[0] || 'containers may not be running'})`);
    }
  } else {
    // No compose files on disk — check if containers still reference the missing path.
    // This can happen when .devcontainer/ was deleted after containers were created.
    const orphanedContainers = await Effect.runPromise(getContainersReferencingWorkspacePath(workspacePath));
    if (orphanedContainers.length > 0) {
      result.containersFound = true;
      try {
        // Try project-name-based down first (Docker Compose can discover containers by label)
        await execAsync(`docker compose -p "${composeProjectName}" down -v --remove-orphans`, {
          cwd: workspacePath,
          timeout: 60000,
        });
        result.steps.push(`Stopped orphaned Docker containers by project name (${orphanedContainers.length} containers)`);
      } catch {
        // Fall back to raw docker stop / rm for each container
        for (const containerId of orphanedContainers) {
          try {
            await execAsync(`docker stop "${containerId}"`, { timeout: 30000 });
            await execAsync(`docker rm "${containerId}"`, { timeout: 30000 });
          } catch {
            // Best-effort — container may already be gone
          }
        }
        result.steps.push(`Stopped ${orphanedContainers.length} orphaned Docker containers individually`);
      }
    }
  }

  // Clean up Docker-created files (root-owned in containers)
  try {
    await execAsync(
      `docker run --rm -v "${workspacePath}:/workspace" alpine sh -c "find /workspace -user root -delete 2>&1 | tail -100 || true"`,
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    result.steps.push('Cleaned up Docker-created files');
  } catch {
    // Alpine container might not be available
  }

  return result;
}async function removeWorkspacePromise(options: WorkspaceRemoveOptions): Promise<WorkspaceRemoveResult> {
  const { projectConfig, featureName, dryRun } = options;
  const result: WorkspaceRemoveResult = {
    success: true,
    errors: [],
    steps: [],
  };

  const workspaceConfig = projectConfig.workspace || getDefaultWorkspaceConfigSync();
  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const featureFolder = `feature-${featureName}`;
  const workspacePath = join(workspacesDir, featureFolder);

  if (!existsSync(workspacePath)) {
    result.success = false;
    result.errors.push(`Workspace not found at ${workspacePath}`);
    return result;
  }

  if (dryRun) {
    result.steps.push('[DRY RUN] Would remove workspace at: ' + workspacePath);
    return result;
  }

  // Stop TLDR daemon for workspace (if it exists)
  const venvPath = join(workspacePath, '.venv');
  if (existsSync(venvPath)) {
    try {
      const { getTldrDaemonServiceSync } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonServiceSync(workspacePath, venvPath);
      await tldrService.stop();
      result.steps.push('Stopped TLDR daemon');
    } catch (error: any) {
      // Non-fatal - daemon may not be running
      console.warn(`⚠ Failed to stop TLDR daemon: ${error?.message}`);
    }
  }

  // Stop Docker containers and clean up Docker-created files
  const dockerResult = await Effect.runPromise(stopWorkspaceDocker(workspacePath, featureName));
  result.steps.push(...dockerResult.steps);

  // Remove worktrees
  if (workspaceConfig.type === 'polyrepo' && workspaceConfig.repos) {
    for (const repo of workspaceConfig.repos) {
      const targetPath = join(workspacePath, repo.name);

      // Check if this is a symlink (e.g., meta repo symlinked, not a worktree)
      if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
        // Symlink - just unlink it
        try {
          unlinkSync(targetPath);
          result.steps.push(`Removed symlink for ${repo.name}`);
        } catch (unlinkErr: any) {
          result.errors.push(`${repo.name}: ${unlinkErr.message}`);
        }
      } else if (existsSync(targetPath)) {
        // Worktree - remove via git worktree remove
        const repoPath = join(projectConfig.path, repo.path);
        const branchPrefix = repo.branch_prefix || 'feature/';
        const branchName = `${branchPrefix}${featureName}`;

        const worktreeResult = await removeWorktree(repoPath, targetPath, branchName);
        if (worktreeResult.success) {
          result.steps.push(`Removed worktree for ${repo.name}`);
        } else {
          result.errors.push(worktreeResult.message);
        }
      }
    }
  } else {
    // Monorepo: remove single worktree
    const branchName = `feature/${featureName}`;
    const worktreeResult = await removeWorktree(projectConfig.path, workspacePath, branchName);
    if (worktreeResult.success) {
      result.steps.push('Removed worktree');
    } else {
      result.errors.push(worktreeResult.message);
    }
  }

  // Remove DNS entries
  if (workspaceConfig.dns) {
    const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);

    const dnsMethod = workspaceConfig.dns.sync_method || 'wsl2hosts';
    for (const entryPattern of workspaceConfig.dns.entries) {
      const hostname = replacePlaceholdersSync(entryPattern, placeholders);
      if (removeDnsEntry(dnsMethod, hostname)) {
        result.steps.push(`Removed DNS entry: ${hostname}`);
      }
    }
  }

  // Remove Cloudflare tunnel entries
  if (workspaceConfig.tunnel) {
    const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);
    const tunnelResult = await Effect.runPromise(removeTunnelIngress(workspaceConfig.tunnel, placeholders));
    result.steps.push(...tunnelResult.steps);
  }

  // Remove Hume EVI config
  if (workspaceConfig.hume) {
    const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);
    const humeResult = await Effect.runPromise(deleteHumeConfig(workspaceConfig.hume, placeholders));
    result.steps.push(...humeResult.steps);
  }

  // Release ports
  if (workspaceConfig.ports) {
    for (const [portName] of Object.entries(workspaceConfig.ports)) {
      const portFile = join(projectConfig.path, `.${portName}-ports`);
      if (releasePort(portFile, featureFolder)) {
        result.steps.push(`Released ${portName} port`);
      }
    }
  }

  // Guard: never delete workspace while containers still reference its compose path
  const orphanedContainers = await Effect.runPromise(getContainersReferencingWorkspacePath(workspacePath));
  if (orphanedContainers.length > 0) {
    result.errors.push(
      `Cannot remove workspace directory: ${orphanedContainers.length} Docker container(s) still reference compose paths in ${DEVCONTAINER_DIRNAME}/. ` +
        `Run workspace Docker cleanup first or stop the containers manually.`,
    );
  } else {
    // Remove workspace directory
    try {
      await execAsync(`rm -rf "${workspacePath}"`, { maxBuffer: 10 * 1024 * 1024 });
      result.steps.push('Removed workspace directory');
    } catch (error) {
      result.errors.push(`Failed to remove workspace directory: ${error}`);
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// workspace-manager.ts is a multi-thousand-line orchestration surface. Per the
// migration plan we prioritise *additive* Effect wrappers over the
// public-facing entry points; the file's many internal helpers stay as-is
// because they're called from within the wrapped functions.

const toWmFsError = (op: string, path: string, cause: unknown): FsError =>
  new FsError({ path, operation: op, cause });

const toWmProcessError = (op: string, cause: unknown): ProcessSpawnError =>
  new ProcessSpawnError({
    command: 'workspace-manager',
    args: [op],
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Migrate any pre-PAN-967 .overdeck/* subdirs to the .pan/ layout. */
export const migrateOverdeckToPan = (
  projectPath: string,
): Effect.Effect<PanMigrationResult, FsError> =>
  Effect.try({
    try: () => migrateOverdeckToPanSync(projectPath),
    catch: (cause) => toWmFsError('migrateOverdeckToPan', projectPath, cause),
  });

/** Mirror ~/.claude settings/agents into the workspace's .claude/ dir. */
export const copyOverdeckSettingsToWorkspace = (
  workspacePath: string,
): Effect.Effect<{ copied: string[]; errors: string[] }, FsError> =>
  Effect.try({
    try: () => copyOverdeckSettingsToWorkspaceSync(workspacePath),
    catch: (cause) =>
      toWmFsError('copyOverdeckSettingsToWorkspace', workspacePath, cause),
  });

/** Ensure the project gitignore covers `.pan/continue.json` (PAN-1124). */
export const ensurePanGitignore = (
  projectPath: string,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => ensurePanGitignoreSync(projectPath),
    catch: (cause) => toWmFsError('ensurePanGitignore', projectPath, cause),
  });

/** Create a new workspace (git worktree + scaffolding). */
export const createWorkspace = (
  options: WorkspaceCreateOptions,
): Effect.Effect<WorkspaceCreateResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => createWorkspacePromise(options),
    catch: (cause) => toWmProcessError('createWorkspace', cause),
  });

/** Mark a directory as pre-trusted for Claude Code (idempotent). */
export const preTrustDirectory = (
  dirPath: string,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => preTrustDirectorySync(dirPath),
    catch: (cause) => toWmFsError('preTrustDirectory', dirPath, cause),
  });

/** Add additional repos (worktrees / symlinks) to an existing workspace. */
export const addReposToWorkspace = (
  options: AddReposToWorkspaceOptions,
): Effect.Effect<AddReposToWorkspaceResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => addReposToWorkspacePromise(options),
    catch: (cause) => toWmProcessError('addReposToWorkspace', cause),
  });

/** Enumerate Docker containers whose compose files live under a workspace. */
export const getContainersReferencingWorkspacePath = (
  ...args: Parameters<typeof getContainersReferencingWorkspacePathPromise>
): Effect.Effect<Awaited<ReturnType<typeof getContainersReferencingWorkspacePathPromise>>, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => getContainersReferencingWorkspacePathPromise(...args),
    catch: (cause) =>
      toWmProcessError('getContainersReferencingWorkspacePath', cause),
  });

/** Stop every Docker resource associated with the supplied workspace. */
export const stopWorkspaceDocker = (
  ...args: Parameters<typeof stopWorkspaceDockerPromise>
): Effect.Effect<DockerCleanupResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => stopWorkspaceDockerPromise(...args),
    catch: (cause) => toWmProcessError('stopWorkspaceDocker', cause),
  });

/** Remove a workspace (worktrees, branches, Docker, DNS, tunnel ingress). */
export const removeWorkspace = (
  options: WorkspaceRemoveOptions,
): Effect.Effect<WorkspaceRemoveResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => removeWorkspacePromise(options),
    catch: (cause) => toWmProcessError('removeWorkspace', cause),
  });
