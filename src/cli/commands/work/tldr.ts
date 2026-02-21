import chalk from 'chalk';
import { getTldrDaemonService, listTldrDaemonServices } from '../../../lib/tldr-daemon.js';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

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
        const stats = statSync(tldrPath);
        const ageMs = Date.now() - stats.mtimeMs;
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        indexAge = ageDays === 0 ? 'today' : `${ageDays}d ago`;

        // Count files in ast directory as proxy for indexed files
        const astPath = join(tldrPath, 'ast');
        if (existsSync(astPath)) {
          const files = readdirSync(astPath);
          fileCount = String(files.length);
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
            const stats = statSync(tldrPath);
            const ageMs = Date.now() - stats.mtimeMs;
            const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
            indexAge = ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;

            const astPath = join(tldrPath, 'ast');
            if (existsSync(astPath)) {
              const files = readdirSync(astPath);
              fileCount = String(files.length);
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
    console.log(chalk.dim('Run `pan setup` to configure TLDR\n'));
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
      process.exit(1);
    }

    if (!existsSync(venvPath)) {
      console.error(chalk.red(`Error: No .venv found in workspace: ${workspace}`));
      console.error(chalk.dim('Workspace needs to be recreated with TLDR support'));
      process.exit(1);
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
      console.error(chalk.dim('Run `pan setup` to configure TLDR'));
      process.exit(1);
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
      process.exit(1);
    }

    if (!existsSync(venvPath)) {
      console.error(chalk.red(`Error: No .venv found in workspace: ${workspace}`));
      process.exit(1);
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
      process.exit(1);
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
      process.exit(1);
    }

    if (!existsSync(venvPath)) {
      console.error(chalk.red(`Error: No .venv found in workspace: ${workspace}`));
      process.exit(1);
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
      console.error(chalk.dim('Run `pan setup` to configure TLDR'));
      process.exit(1);
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

function showHelp(): void {
  console.log(chalk.bold('pan tldr - TLDR daemon management\n'));
  console.log('Commands:');
  console.log('  ' + chalk.cyan('status') + '              Show status of all TLDR daemons');
  console.log('  ' + chalk.cyan('start [workspace]') + '   Start TLDR daemon (main or workspace)');
  console.log('  ' + chalk.cyan('stop [workspace]') + '    Stop TLDR daemon (main or workspace)');
  console.log('  ' + chalk.cyan('warm [workspace]') + '    Manually trigger index warm (all layers + embeddings)');
  console.log('  ' + chalk.cyan('help') + '                Show this help\n');
  console.log('Options:');
  console.log('  ' + chalk.cyan('--json') + '              Output as JSON\n');
  console.log('Examples:');
  console.log('  pan tldr status');
  console.log('  pan tldr start');
  console.log('  pan tldr start feature-pan-123');
  console.log('  pan tldr warm feature-pan-123');
  console.log('  pan tldr stop\n');
}
