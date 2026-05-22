import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  message: string;
}

export async function systemHealthCommand(): Promise<void> {
  const checks: HealthCheck[] = [];

  // Dashboard health
  try {
    const { getDashboardApiUrlSync } = await import('../../lib/config.js');
    const dashboardUrl = getDashboardApiUrlSync();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${dashboardUrl}/api/health`, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 200) {
      checks.push({ name: 'Dashboard', status: 'healthy', message: 'Running' });
    } else {
      checks.push({ name: 'Dashboard', status: 'unhealthy', message: `HTTP ${res.status}` });
    }
  } catch {
    checks.push({ name: 'Dashboard', status: 'unhealthy', message: 'Not running' });
  }

  // smee-client webhook relay
  try {
    const { isSmeeProcessRunningSync } = await import('../../lib/smee.js');
    const smeeUrlPath = join(homedir(), '.panopticon', 'github-app', 'smee-url');
    if (!existsSync(smeeUrlPath)) {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'unknown',
        message: 'Not configured',
      });
    } else if (isSmeeProcessRunningSync()) {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'healthy',
        message: 'Running',
      });
    } else {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'degraded',
        message: 'Configured but not running',
      });
    }
  } catch {
    checks.push({
      name: 'smee-client Webhook Relay',
      status: 'unknown',
      message: 'Status check failed',
    });
  }

  // CLIProxy sidecar
  try {
    const { isCliproxyRunningSync } = await import('../../lib/cliproxy.js');
    if (isCliproxyRunningSync()) {
      checks.push({ name: 'CLIProxyAPI', status: 'healthy', message: 'Running' });
    } else {
      checks.push({ name: 'CLIProxyAPI', status: 'degraded', message: 'Not running' });
    }
  } catch {
    checks.push({ name: 'CLIProxyAPI', status: 'unknown', message: 'Status check failed' });
  }

  // Print results
  console.log(chalk.bold('\nPanopticon Health\n'));

  const icons: Record<HealthCheck['status'], string> = {
    healthy: chalk.green('✓'),
    degraded: chalk.yellow('⚠'),
    unhealthy: chalk.red('✗'),
    unknown: chalk.dim('?'),
  };

  for (const check of checks) {
    const icon = icons[check.status];
    const message =
      check.status === 'unhealthy'
        ? chalk.red(check.message)
        : check.status === 'degraded'
          ? chalk.yellow(check.message)
          : check.status === 'healthy'
            ? chalk.dim(check.message)
            : chalk.dim(check.message);
    console.log(`${icon} ${check.name}: ${message}`);
  }

  console.log('');
}
