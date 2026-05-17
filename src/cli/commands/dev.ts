import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '@iarna/toml';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ensureDashboardBundle(): boolean {
  const bundledServer = join(__dirname, '..', 'dashboard', 'server.js');
  const srcDashboard = join(__dirname, '..', '..', 'src', 'dashboard');

  if (existsSync(bundledServer)) {
    return true;
  }

  if (!existsSync(srcDashboard)) {
    return false;
  }

  console.log(chalk.yellow('⚠ Dashboard server bundle missing; rebuilding...'));
  try {
    execSync('npm run build:dashboard:server', {
      cwd: join(__dirname, '..', '..'),
      stdio: ['pipe', 'inherit', 'pipe'],
    });
  } catch {
    return false;
  }

  return existsSync(bundledServer);
}

function resolveNode22(): string {
  const nvmNode = '/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node';
  if (existsSync(nvmNode)) return nvmNode;
  return 'node';
}

function readConfig() {
  const configFile = join(process.env.HOME || '', '.panopticon', 'config.toml');
  const defaults = {
    traefikEnabled: false,
    traefikDomain: 'pan.localhost',
    dashboardPort: 3010,
    dashboardApiPort: 3011,
  };

  if (!existsSync(configFile)) return defaults;

  try {
    const config = parse(readFileSync(configFile, 'utf-8')) as any;
    return {
      traefikEnabled: config.traefik?.enabled === true,
      traefikDomain: config.traefik?.domain || defaults.traefikDomain,
      dashboardPort: config.dashboard?.port || defaults.dashboardPort,
      dashboardApiPort: config.dashboard?.api_port || defaults.dashboardApiPort,
    };
  } catch {
    return defaults;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(port: number, path: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}${path}`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error(`Health check at ${url} did not pass within ${timeoutMs}ms`);
}

async function waitForHttp200(port: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return;
    } catch {
      // ignore
    }
    await sleep(500);
  }
  throw new Error(`Frontend at ${url} did not return 200 within ${timeoutMs}ms`);
}

function killPort(port: number): void {
  try {
    execSync(`fuser -k -TERM ${port}/tcp 2>/dev/null || true`, { stdio: 'pipe' });
  } catch {
    // ignore
  }
}

function waitForPortFree(port: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      try {
        execSync(`bash -c 'echo >/dev/tcp/127.0.0.1/${port}'`, { stdio: 'pipe', timeout: 500 });
      } catch {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Port ${port} did not free within ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function startSidecars(): Promise<void> {
  // CLIProxy
  try {
    const { startCliproxy, CLIPROXY_PORT } = await import('../../lib/cliproxy.js');
    console.log(chalk.dim('Starting CLIProxyAPI sidecar (GPT subscription router)...'));
    startCliproxy();
    console.log(chalk.green(`✓ CLIProxyAPI listening on http://127.0.0.1:${CLIPROXY_PORT}`));
  } catch (error: any) {
    console.log(chalk.yellow('⚠ Failed to start CLIProxyAPI sidecar:'), error?.message || String(error));
  }

  // smee
  try {
    const { startSmeeProcess } = await import('../../lib/smee.js');
    console.log(chalk.dim('\nStarting smee-client webhook relay...'));
    startSmeeProcess();
  } catch (error: any) {
    console.log(chalk.yellow('⚠ Failed to start smee-client:'), error?.message || String(error));
  }

  // TLDR
  try {
    const { getTldrDaemonService } = await import('../../lib/tldr-daemon.js');
    const projectRoot = process.cwd();
    const venvPath = join(projectRoot, '.venv');
    if (existsSync(venvPath)) {
      console.log(chalk.dim('\nStarting TLDR daemon for project root...'));
      const tldrService = getTldrDaemonService(projectRoot, venvPath);
      await tldrService.start(true);
      console.log(chalk.green('✓ TLDR daemon started'));
    } else {
      console.log(chalk.dim('\nSkipping TLDR daemon (no .venv found)'));
    }
  } catch (error: any) {
    console.log(chalk.yellow('⚠ Failed to start TLDR daemon:'), error?.message || String(error));
  }

  // Supervisor
  try {
    const { startSupervisorProcess, getSupervisorPort } = await import('../../lib/supervisor.js');
    startSupervisorProcess();
    console.log(chalk.green(`✓ Supervisor listening on http://127.0.0.1:${getSupervisorPort()}`));
  } catch (error: any) {
    console.log(chalk.yellow('⚠ Failed to start supervisor:'), error?.message || String(error));
  }
}

export async function devCommand(options: { skipTraefik?: boolean; deacon?: boolean; noResume?: boolean }) {
  // Force dev mode for Traefik config generation and all downstream code
  process.env['PANOPTICON_DEV'] = '1';

  const config = readConfig();
  const node22 = resolveNode22();
  const bundledServer = join(__dirname, '..', 'dashboard', 'server.js');
  const frontendDir = join(__dirname, '..', '..', 'src', 'dashboard', 'frontend');

  console.log(chalk.bold('Starting Panopticon in development mode...\n'));
  if (options.noResume) {
    console.log(chalk.yellow('  [no-resume mode active] Agent auto-resume is disabled for this dashboard boot'));
  }

  // ── Auto-sync ──────────────────────────────────────────────────────────────
  {
    const origWrite = process.stdout.write;
    const origErrWrite = process.stderr.write;
    try {
      const { syncCommand } = await import('./sync.js');
      process.stdout.write = () => true;
      process.stderr.write = () => true;
      await syncCommand({});
      process.stdout.write = origWrite;
      process.stderr.write = origErrWrite;
      console.log(chalk.dim('  Auto-synced skills, hooks, and MCP config'));
    } catch {
      process.stdout.write = origWrite;
      process.stderr.write = origErrWrite;
      console.log(chalk.yellow('⚠ Auto-sync failed (non-fatal, continuing startup)'));
    }
  }

  // ── Traefik ────────────────────────────────────────────────────────────────
  if (config.traefikEnabled && !options.skipTraefik) {
    try {
      const { generatePanopticonTraefikConfig, ensureProjectCerts, generateTlsConfig, cleanupStaleTlsSections } =
        await import('../../lib/traefik.js');

      cleanupStaleTlsSections();
      if (generatePanopticonTraefikConfig('dev')) {
        console.log(chalk.dim('  Regenerated Traefik config for dev mode'));
      }
      const generatedDomains = ensureProjectCerts();
      for (const domain of generatedDomains) {
        console.log(chalk.dim(`  Generated wildcard cert for *.${domain}`));
      }
      if (generateTlsConfig()) {
        console.log(chalk.dim('  Generated TLS config (tls.yml)'));
      }
    } catch {
      console.log(chalk.yellow('Warning: Could not regenerate Traefik config'));
    }

    try {
      const { ensureBaseDomain, detectDnsSyncMethod, syncDnsToWindows } = await import('../../lib/dns.js');
      const configFile = join(process.env.HOME || '', '.panopticon', 'config.toml');
      const dnsMethod =
        (existsSync(configFile) ? (parse(readFileSync(configFile, 'utf-8')) as any).traefik?.dns_sync_method : null) ||
        detectDnsSyncMethod();
      ensureBaseDomain(dnsMethod, config.traefikDomain);
      if (dnsMethod === 'wsl2hosts') {
        syncDnsToWindows().catch(() => {});
      }
    } catch {
      console.log(chalk.yellow(`Warning: Could not ensure DNS for ${config.traefikDomain}`));
    }

    const traefikDir = join(process.env.HOME || '', '.panopticon', 'traefik');
    if (existsSync(traefikDir)) {
      try {
        console.log(chalk.dim('Starting Traefik...'));
        execSync('docker compose up -d', { cwd: traefikDir, stdio: 'pipe' });
        console.log(chalk.green('✓ Traefik started'));
      } catch {
        console.log(chalk.yellow('⚠ Failed to start Traefik (continuing anyway)'));
      }
    }
  }

  // ── Ensure bundle ──────────────────────────────────────────────────────────
  if (!ensureDashboardBundle()) {
    console.error(chalk.red('Error: Could not build dashboard server bundle'));
    process.exit(1);
  }

  // ── Kill existing processes ────────────────────────────────────────────────
  console.log(chalk.dim('Cleaning up existing dashboard processes...'));
  killPort(config.dashboardPort);
  killPort(config.dashboardApiPort);
  try {
    await Promise.all([
      waitForPortFree(config.dashboardPort, 5000),
      waitForPortFree(config.dashboardApiPort, 5000),
    ]);
  } catch {
    // proceed anyway
  }

  // Tracked here (not in shutdown()) so child-close handlers can see it.
  let shuttingDown = false;

  // ── Start API server ───────────────────────────────────────────────────────
  console.log(chalk.dim('Starting API server (Node 22)...'));
  const apiChild = spawn(node22, [bundledServer], {
    detached: false,
    stdio: 'pipe',
    env: {
      ...process.env,
      API_PORT: String(config.dashboardApiPort),
      PANOPTICON_MODE: 'development',
      ...(options.deacon === false ? { PANOPTICON_DISABLE_DEACON: '1' } : {}),
      ...(options.noResume ? { PANOPTICON_NO_RESUME: '1' } : {}),
    },
  });

  apiChild.stdout?.on('data', (data) => {
    process.stdout.write(chalk.dim(`[server] ${data}`));
  });
  apiChild.stderr?.on('data', (data) => {
    process.stderr.write(chalk.dim(`[server] ${data}`));
  });

  apiChild.on('error', (err) => {
    console.error(chalk.red('Failed to start API server:'), err.message);
    process.exit(1);
  });

  apiChild.on('close', (code, signal) => {
    console.error(chalk.yellow(`[pan dev] API child closed: pid=${apiChild.pid} code=${code} signal=${signal ?? 'none'} shuttingDown=${shuttingDown}`));
    if (code !== 0 && code !== null) {
      console.error(chalk.red(`API server exited with code ${code}`));
      process.exit(1);
    }
  });

  try {
    await waitForHealth(config.dashboardApiPort, '/api/health', 15000);
    console.log(chalk.green('✓ API server ready'));
  } catch (err: any) {
    console.error(chalk.red('API server health check failed:'), err.message);
    apiChild.kill('SIGTERM');
    process.exit(1);
  }

  // ── Start Vite frontend ────────────────────────────────────────────────────
  console.log(chalk.dim('Starting Vite dev server...'));
  const viteChild = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', String(config.dashboardPort)], {
    cwd: frontendDir,
    detached: false,
    stdio: 'pipe',
    env: {
      ...process.env,
      TRAEFIK_ENABLED: config.traefikEnabled ? 'true' : 'false',
    },
  });

  viteChild.stdout?.on('data', (data) => {
    process.stdout.write(chalk.dim(`[vite] ${data}`));
  });
  viteChild.stderr?.on('data', (data) => {
    process.stderr.write(chalk.dim(`[vite] ${data}`));
  });

  viteChild.on('error', (err) => {
    console.error(chalk.red('Failed to start Vite:'), err.message);
    apiChild.kill('SIGTERM');
    process.exit(1);
  });

  viteChild.on('close', (code, signal) => {
    console.error(chalk.yellow(`[pan dev] Vite child closed: pid=${viteChild.pid} code=${code} signal=${signal ?? 'none'} shuttingDown=${shuttingDown}`));
  });

  try {
    await waitForHttp200(config.dashboardPort, 10000);
    console.log(chalk.green('✓ Vite dev server ready'));
  } catch (err: any) {
    console.error(chalk.red('Vite frontend did not start:'), err.message);
    apiChild.kill('SIGTERM');
    viteChild.kill('SIGTERM');
    process.exit(1);
  }

  // ── Sidecars ───────────────────────────────────────────────────────────────
  await startSidecars();

  // ── URLs ───────────────────────────────────────────────────────────────────
  console.log('');
  if (config.traefikEnabled) {
    console.log(`  Frontend: ${chalk.cyan(`https://${config.traefikDomain}`)}`);
    console.log(`  API:      ${chalk.cyan(`https://${config.traefikDomain}/api`)}`);
  } else {
    console.log(`  Frontend: ${chalk.cyan(`http://localhost:${config.dashboardPort}`)}`);
    console.log(`  API:      ${chalk.cyan(`http://localhost:${config.dashboardApiPort}`)}`);
  }
  console.log(chalk.dim('\nPress Ctrl+C to stop\n'));

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(chalk.dim(`\n${signal} received by pan dev (pid=${process.pid} ppid=${process.ppid}), shutting down...`));

    viteChild.kill('SIGTERM');
    apiChild.kill('SIGTERM');

    // Give them a moment to exit gracefully
    await sleep(2000);

    if (!apiChild.killed) apiChild.kill('SIGKILL');
    if (!viteChild.killed) viteChild.kill('SIGKILL');

    // Stop sidecars
    try {
      const { stopSmeeProcess } = await import('../../lib/smee.js');
      stopSmeeProcess();
    } catch {
      // ignore
    }
    try {
      const { stopSupervisorProcess } = await import('../../lib/supervisor.js');
      stopSupervisorProcess();
    } catch {
      // ignore
    }
    try {
      const { stopCliproxy } = await import('../../lib/cliproxy.js');
      stopCliproxy();
    } catch {
      // ignore
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Keep the process alive
  await new Promise(() => {});
}
