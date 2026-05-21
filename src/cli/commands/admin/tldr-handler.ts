import chalk from 'chalk';
import { Effect } from 'effect';
import { getTldrDaemonService, listTldrDaemonServices } from '../../../lib/tldr-daemon.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
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
  const { layer: NodeServicesLayer } = await import('@effect/platform-node/NodeServices');
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
    const status = await Effect.runPromise(service.getStatus().pipe(Effect.provide(NodeServicesLayer)));
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
        const status = await Effect.runPromise(service.getStatus().pipe(Effect.provide(NodeServicesLayer)));
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
  const { layer: NodeServicesLayer } = await import('@effect/platform-node/NodeServices');
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
    await Effect.runPromise(service.start().pipe(Effect.provide(NodeServicesLayer)));

    if (!options.json) {
      console.log(chalk.green(`✓ Started TLDR daemon for ${workspace}`));
    }
  } else {
    // Start main daemon
    const venvPath = join(projectRoot, '.venv');

    if (!existsSync(venvPath)) {
      console.error(chalk.red('Error: No .venv found in project root'));
      console.error(chalk.dim('Create a project .venv, then run `pan admin tldr start`'));
      process.exit(1);
    }

    const service = getTldrDaemonService(projectRoot, venvPath);
    await Effect.runPromise(service.start().pipe(Effect.provide(NodeServicesLayer)));

    if (!options.json) {
      console.log(chalk.green('✓ Started TLDR daemon for main'));
    }
  }
}

async function stopCommand(workspace: string | undefined, options: TldrOptions): Promise<void> {
  const { layer: NodeServicesLayer } = await import('@effect/platform-node/NodeServices');
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
    await Effect.runPromise(service.stop().pipe(Effect.provide(NodeServicesLayer)));

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
    await Effect.runPromise(service.stop().pipe(Effect.provide(NodeServicesLayer)));

    if (!options.json) {
      console.log(chalk.green('✓ Stopped TLDR daemon for main'));
    }
  }
}

async function warmCommand(workspace: string | undefined, options: TldrOptions): Promise<void> {
  const { layer: NodeServicesLayer } = await import('@effect/platform-node/NodeServices');
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

    await Effect.runPromise(service.warm(false).pipe(Effect.provide(NodeServicesLayer)));  // foreground mode for warming

    if (!options.json) {
      console.log(chalk.green(`✓ Index warming complete for ${workspace}`));
    }
  } else {
    // Warm main index
    const venvPath = join(projectRoot, '.venv');

    if (!existsSync(venvPath)) {
      console.error(chalk.red('Error: No .venv found in project root'));
      console.error(chalk.dim('Create a project .venv, then run `pan admin tldr start`'));
      process.exit(1);
    }

    const service = getTldrDaemonService(projectRoot, venvPath);

    if (!options.json) {
      console.log(chalk.dim('Warming TLDR index for main...'));
      console.log(chalk.dim('This may take a few minutes for large codebases'));
    }

    await Effect.runPromise(service.warm(false).pipe(Effect.provide(NodeServicesLayer)));  // foreground mode for warming

    if (!options.json) {
      console.log(chalk.green('✓ Index warming complete for main'));
    }
  }
}

function showHelp(): void {
  console.log(chalk.bold('pan admin tldr - TLDR daemon management\n'));
  console.log('Commands:');
  console.log('  ' + chalk.cyan('status') + '              Show status of all TLDR daemons');
  console.log('  ' + chalk.cyan('start [workspace]') + '   Start TLDR daemon (main or workspace)');
  console.log('  ' + chalk.cyan('stop [workspace]') + '    Stop TLDR daemon (main or workspace)');
  console.log('  ' + chalk.cyan('warm [workspace]') + '    Manually trigger index warm (all layers + embeddings)');
  console.log('  ' + chalk.cyan('help') + '                Show this help\n');
  console.log('Options:');
  console.log('  ' + chalk.cyan('--json') + '              Output as JSON\n');
  console.log('Examples:');
  console.log('  pan admin tldr status');
  console.log('  pan admin tldr start');
  console.log('  pan admin tldr start feature-pan-123');
  console.log('  pan admin tldr warm feature-pan-123');
  console.log('  pan admin tldr stop\n');
}
