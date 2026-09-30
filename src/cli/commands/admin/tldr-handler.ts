import { exitCli } from '../../exit.js';
import chalk from 'chalk';
import { getTldrDaemonService, listTldrDaemonServices } from '../../../lib/tldr-daemon.js';
import { PYTHON_PROJECT_MARKERS, installTldrVenv } from '../../../lib/workspace-manager/tldr-venv.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, basename, dirname, isAbsolute, resolve } from 'path';

const execFileAsync = promisify(execFile);

interface TldrOptions {
  json?: boolean;
}

/**
 * Pan TLDR commands for managing TLDR daemons
 */
export async function tldrCommand(action: string, workspace?: string, options: TldrOptions = {}): Promise<void> {
  switch (action) {
    case 'status':
      await statusCommand(options);
      break;
    case 'start':
      await startCommand(workspace, options);
      break;
    case 'stop':
      await stopCommand(workspace, options);
      break;
    case 'warm':
      await warmCommand(workspace, options);
      break;
    case 'install':
      await installCommand(options);
      break;
    case 'help':
    default:
      showHelp();
      break;
  }
}

async function statusCommand(options: TldrOptions): Promise<void> {
  const projectRoot = process.cwd();
  const venvPath = join(projectRoot, '.venv');

  const results: Array<{
    workspace: string;
    running: boolean;
    pid?: number;
    healthy: boolean;
    indexAge?: string;
    fileCount?: string;
  }> = [];

  // Check main daemon
  if (existsSync(venvPath)) {
    const service = getTldrDaemonService(projectRoot, venvPath);
    const status = await service.getStatus();
    const tldrPath = join(projectRoot, '.tldr');

    let indexAge = 'N/A';
    let fileCount = 'N/A';

    if (existsSync(tldrPath)) {
      try {
        // Index age from languages.json timestamp (set during warm)
        const langPath = join(tldrPath, 'languages.json');
        if (existsSync(langPath)) {
          const langData = JSON.parse(readFileSync(langPath, 'utf-8'));
          if (langData.timestamp) {
            const ageMs = Date.now() - (langData.timestamp * 1000);
            const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
            indexAge = ageDays === 0 ? 'today' : `${ageDays}d ago`;
          }
        }
        // Fall back to directory mtime
        if (indexAge === 'N/A') {
          const stats = statSync(tldrPath);
          const ageMs = Date.now() - stats.mtimeMs;
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          indexAge = ageDays === 0 ? 'today' : `${ageDays}d ago`;
        }

        // File count from call_graph.json
        const cgPath = join(tldrPath, 'cache', 'call_graph.json');
        if (existsSync(cgPath)) {
          const cg = JSON.parse(readFileSync(cgPath, 'utf-8'));
          if (Array.isArray(cg.edges)) {
            const files = new Set<string>();
            for (const e of cg.edges) {
              if (e.from_file) files.add(e.from_file);
              if (e.to_file) files.add(e.to_file);
            }
            fileCount = String(files.size);
          }
        }
      } catch {
        // Ignore stat errors
      }
    }

    results.push({
      workspace: 'main',
      running: status.running,
      pid: status.pid,
      healthy: status.healthy,
      indexAge,
      fileCount,
    });
  }

  // Check workspace daemons
  const workspacesDir = join(projectRoot, 'workspaces');
  if (existsSync(workspacesDir)) {
    const workspaces = readdirSync(workspacesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('feature-'));

    for (const ws of workspaces) {
      const wsPath = join(workspacesDir, ws.name);
      const wsVenvPath = join(wsPath, '.venv');

      if (existsSync(wsVenvPath)) {
        const service = getTldrDaemonService(wsPath, wsVenvPath);
        const status = await service.getStatus();
        const tldrPath = join(wsPath, '.tldr');

        let indexAge = 'N/A';
        let fileCount = 'N/A';

        if (existsSync(tldrPath)) {
          try {
            // Index age from languages.json timestamp
            const langPath = join(tldrPath, 'languages.json');
            if (existsSync(langPath)) {
              const langData = JSON.parse(readFileSync(langPath, 'utf-8'));
              if (langData.timestamp) {
                const ageMs = Date.now() - (langData.timestamp * 1000);
                const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
                indexAge = ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
              }
            }
            // Fall back to directory mtime
            if (indexAge === 'N/A') {
              const stats = statSync(tldrPath);
              const ageMs = Date.now() - stats.mtimeMs;
              const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
              indexAge = ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
            }

            // File count from call_graph.json
            const cgPath = join(tldrPath, 'cache', 'call_graph.json');
            if (existsSync(cgPath)) {
              const cg = JSON.parse(readFileSync(cgPath, 'utf-8'));
              if (Array.isArray(cg.edges)) {
                const files = new Set<string>();
                for (const e of cg.edges) {
                  if (e.from_file) files.add(e.from_file);
                  if (e.to_file) files.add(e.to_file);
                }
                fileCount = String(files.size);
              }
            }
          } catch {
            // Ignore stat errors
          }
        }

        results.push({
          workspace: ws.name,
          running: status.running,
          pid: status.pid,
          healthy: status.healthy,
          indexAge,
          fileCount,
        });
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Pretty print
  console.log(chalk.bold('TLDR Daemon Status\n'));

  if (results.length === 0) {
    console.log(chalk.dim('No TLDR daemons found (no .venv directories)'));
    console.log(chalk.dim('Create a project .venv, then run `pan admin tldr start`\n'));
    return;
  }

  for (const result of results) {
    const statusIcon = result.running ? chalk.green('●') : chalk.dim('○');
    const healthIcon = result.healthy ? chalk.green('✓') : chalk.yellow('⚠');

    console.log(`${statusIcon} ${chalk.bold(result.workspace)}`);
    console.log(`  Status: ${result.running ? chalk.green('running') : chalk.dim('stopped')}`);

    if (result.running) {
      console.log(`  PID: ${result.pid || 'unknown'}`);
      console.log(`  Health: ${healthIcon} ${result.healthy ? 'healthy' : 'unhealthy'}`);
    }

    console.log(`  Index: ${result.fileCount} files (${result.indexAge})`);
    console.log('');
  }
}

async function startCommand(workspace: string | undefined, options: TldrOptions): Promise<void> {
  const projectRoot = process.cwd();

  if (workspace) {
    // Start workspace daemon
    const wsPath = join(projectRoot, 'workspaces', workspace);
    const venvPath = join(wsPath, '.venv');

    if (!existsSync(wsPath)) {
      console.error(chalk.red(`Error: Workspace not found: ${workspace}`));
      return exitCli(1);
    }

    if (!existsSync(venvPath)) {
      console.error(chalk.red(`Error: No .venv found in workspace: ${workspace}`));
      console.error(chalk.dim('Workspace needs to be recreated with TLDR support'));
      return exitCli(1);
    }

    const service = getTldrDaemonService(wsPath, venvPath);
    await service.start();

    if (!options.json) {
      console.log(chalk.green(`✓ Started TLDR daemon for ${workspace}`));
    }
  } else {
    // Start main daemon
    const venvPath = join(projectRoot, '.venv');

    if (!existsSync(venvPath)) {
      console.error(chalk.red('Error: No .venv found in project root'));
      console.error(chalk.dim('Create a project .venv, then run `pan admin tldr start`'));
      return exitCli(1);
    }

    const service = getTldrDaemonService(projectRoot, venvPath);
    await service.start();

    if (!options.json) {
      console.log(chalk.green('✓ Started TLDR daemon for main'));
    }
  }
}

async function stopCommand(workspace: string | undefined, options: TldrOptions): Promise<void> {
  const projectRoot = process.cwd();

  if (workspace) {
    // Stop workspace daemon
    const wsPath = join(projectRoot, 'workspaces', workspace);
    const venvPath = join(wsPath, '.venv');

    if (!existsSync(wsPath)) {
      console.error(chalk.red(`Error: Workspace not found: ${workspace}`));
      return exitCli(1);
    }

    if (!existsSync(venvPath)) {
      console.error(chalk.red(`Error: No .venv found in workspace: ${workspace}`));
      return exitCli(1);
    }

    const service = getTldrDaemonService(wsPath, venvPath);
    await service.stop();

    if (!options.json) {
      console.log(chalk.green(`✓ Stopped TLDR daemon for ${workspace}`));
    }
  } else {
    // Stop main daemon
    const venvPath = join(projectRoot, '.venv');

    if (!existsSync(venvPath)) {
      console.error(chalk.red('Error: No .venv found in project root'));
      return exitCli(1);
    }

    const service = getTldrDaemonService(projectRoot, venvPath);
    await service.stop();

    if (!options.json) {
      console.log(chalk.green('✓ Stopped TLDR daemon for main'));
    }
  }
}

async function warmCommand(workspace: string | undefined, options: TldrOptions): Promise<void> {
  const projectRoot = process.cwd();

  if (workspace) {
    // Warm workspace index
    const wsPath = join(projectRoot, 'workspaces', workspace);
    const venvPath = join(wsPath, '.venv');

    if (!existsSync(wsPath)) {
      console.error(chalk.red(`Error: Workspace not found: ${workspace}`));
      return exitCli(1);
    }

    if (!existsSync(venvPath)) {
      console.error(chalk.red(`Error: No .venv found in workspace: ${workspace}`));
      return exitCli(1);
    }

    const service = getTldrDaemonService(wsPath, venvPath);

    if (!options.json) {
      console.log(chalk.dim(`Warming TLDR index for ${workspace}...`));
      console.log(chalk.dim('This may take a few minutes for large codebases'));
    }

    await service.warm(false);  // foreground mode for warming

    if (!options.json) {
      console.log(chalk.green(`✓ Index warming complete for ${workspace}`));
    }
  } else {
    // Warm main index
    const venvPath = join(projectRoot, '.venv');

    if (!existsSync(venvPath)) {
      console.error(chalk.red('Error: No .venv found in project root'));
      console.error(chalk.dim('Create a project .venv, then run `pan admin tldr start`'));
      return exitCli(1);
    }

    const service = getTldrDaemonService(projectRoot, venvPath);

    if (!options.json) {
      console.log(chalk.dim('Warming TLDR index for main...'));
      console.log(chalk.dim('This may take a few minutes for large codebases'));
    }

    await service.warm(false);  // foreground mode for warming

    if (!options.json) {
      console.log(chalk.green('✓ Index warming complete for main'));
    }
  }
}

/**
 * Build the one project-root TLDR venv, once. Workspaces link to it instead
 * of copying or building their own (PAN-1674). Refuses to run from a linked
 * worktree (a workspace) because two workspaces created at the same time
 * would otherwise race to build it.
 */
async function installCommand(options: TldrOptions): Promise<void> {
  const projectRoot = process.cwd();
  const gitPath = join(projectRoot, '.git');

  if (existsSync(gitPath) && statSync(gitPath).isFile()) {
    let primaryCheckoutHint = '';
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd: projectRoot });
      const commonDir = stdout.trim();
      const absCommonDir = isAbsolute(commonDir) ? commonDir : resolve(projectRoot, commonDir);
      primaryCheckoutHint = ` Run it in ${dirname(absCommonDir)} instead.`;
    } catch {
      // Best-effort hint only — the refusal below stands regardless.
    }
    console.error(
      chalk.red(`Error: \`pan admin tldr install\` must run in the primary checkout, not a linked worktree.${primaryCheckoutHint}`)
    );
    return exitCli(1);
  }

  const venvPath = join(projectRoot, '.venv');
  const tldrBin = join(venvPath, 'bin', 'tldr');

  if (existsSync(tldrBin)) {
    if (!options.json) {
      console.log(chalk.green(`TLDR venv already installed at ${venvPath}`));
    }
    return;
  }

  const hasPythonProjectMarker = PYTHON_PROJECT_MARKERS.some((marker) => existsSync(join(projectRoot, marker)));
  if (hasPythonProjectMarker) {
    console.error(chalk.red(`Error: ${projectRoot} is a Python project and owns .venv; refusing to overwrite it.`));
    return exitCli(1);
  }

  if (existsSync(venvPath)) {
    console.error(chalk.red(`Error: ${venvPath} already exists without a tldr binary; refusing to overwrite it.`));
    return exitCli(1);
  }

  const steps = await installTldrVenv(venvPath);
  if (!options.json) {
    for (const step of steps) {
      console.log(chalk.dim(step));
    }
    console.log(chalk.green(`✓ TLDR venv installed at ${venvPath}`));
    console.log('New workspaces will link to this venv. Run `pan admin tldr dedupe` to convert existing workspace copies.');
  }
}

function showHelp(): void {
  console.log(chalk.bold('pan admin tldr - TLDR daemon management\n'));
  console.log('Commands:');
  console.log('  ' + chalk.cyan('status') + '              Show status of all TLDR daemons');
  console.log('  ' + chalk.cyan('start [workspace]') + '   Start TLDR daemon (main or workspace)');
  console.log('  ' + chalk.cyan('stop [workspace]') + '    Stop TLDR daemon (main or workspace)');
  console.log('  ' + chalk.cyan('warm [workspace]') + '    Manually trigger index warm (all layers + embeddings)');
  console.log('  ' + chalk.cyan('install') + '             Build the project-root TLDR venv once');
  console.log('  ' + chalk.cyan('help') + '                Show this help\n');
  console.log('Options:');
  console.log('  ' + chalk.cyan('--json') + '              Output as JSON\n');
  console.log('Examples:');
  console.log('  pan admin tldr status');
  console.log('  pan admin tldr start');
  console.log('  pan admin tldr start feature-pan-123');
  console.log('  pan admin tldr warm feature-pan-123');
  console.log('  pan admin tldr install');
  console.log('  pan admin tldr stop\n');
}
