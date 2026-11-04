import { spawn as spawnChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

import { exitCli } from '../exit.js';
import { ensureInternalToken } from '../../lib/internal-token.js';
import { packageRoot } from '../../lib/paths.js';

// Resolved by lib/paths, not from import.meta.url: the CLI loads this module
// lazily as a dist/ chunk (PAN-4195), so a relative walk is location-dependent.
const distDir = join(packageRoot, 'dist');

async function openServeUrlInBrowser(url: string): Promise<void> {
  const [{ Effect }, { openBrowser }, { layer: nodeServicesLayer }] = await Promise.all([
    import('effect'),
    import('../../lib/browser.js'),
    import('@effect/platform-node/NodeServices'),
  ]);
  await Effect.runPromise(openBrowser(url).pipe(Effect.provide(nodeServicesLayer)));
}

export interface ServeDeps {
  readonly spawn?: typeof spawnChildProcess;
  readonly openBrowser?: (url: string) => Promise<void>;
  readonly openDelayMs?: number;
}

/**
 * `pan serve` — the npx launcher command. Starts the bundled dashboard
 * server and opens the browser to it. `--no-open` (`options.open === false`)
 * skips the browser and only prints the URL: a headless host such as a Fly
 * machine has no browser to open (PAN-4652).
 *
 * Resolves the internal token with `ensureInternalToken()` rather than
 * minting one and passing it through the child's env: the file it writes
 * (or reads) is what every CLI sender and hook reads, so a long-lived
 * terminal-backend server spawned from this dashboard never captures a
 * throwaway env token that would go stale on the next launch (PAN-4628).
 */
export async function serveCommand(options: { port: string; open?: boolean }, deps: ServeDeps = {}): Promise<void> {
  const spawn = deps.spawn ?? spawnChildProcess;
  const openBrowser = deps.openBrowser ?? openServeUrlInBrowser;
  const openDelayMs = deps.openDelayMs ?? 1_500;

  // Node 22+ is guaranteed here: ensureCompatibleNode() at CLI startup
  // relaunches under a compatible Node (or exits) before any command runs.
  const nodeVersion = process.versions.node;

  const bundledServer = join(distDir, 'dashboard', 'server.js');
  const bundledFrontendIndex = join(distDir, 'dashboard', 'public', 'index.html');
  const port = parseInt(options.port, 10) || 3011;
  const url = `http://localhost:${port}`;

  if (!existsSync(bundledServer) || !existsSync(bundledFrontendIndex)) {
    console.error(chalk.red('Error: Dashboard bundle not found.'));
    console.error(chalk.dim('This package may not be fully built. Try: npm run build'));
    return exitCli(1);
  }

  const internalToken = ensureInternalToken();
  const browserUrl = `${url}#overdeck_token=${encodeURIComponent(internalToken)}`;

  console.log(chalk.bold('Overdeck Dashboard'));
  console.log(chalk.dim(`Starting server on port ${port} (Node ${nodeVersion})...`));

  const server = spawn(process.execPath, [bundledServer], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });

  server.on('error', async (err) => {
    console.error(chalk.red('Failed to start dashboard:'), err.message);
    return exitCli(1);
  });

  if (options.open === false) {
    console.log(`  ${chalk.cyan(url)}`);
    return;
  }

  // Open browser after server has had a moment to start
  setTimeout(async () => {
    console.log(`  ${chalk.cyan(url)}`);
    await openBrowser(browserUrl).catch(() => {
      // If openBrowser fails, show URL for manual opening
      console.log(chalk.dim(`  Open your browser to: ${browserUrl}`));
    });
  }, openDelayMs);
}
