/**
 * pan remote resources
 *
 * Show RAM/disk usage across Fly.io machines.
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';
import { loadConfig } from '../../../lib/config.js';
import { createFlyProviderFromConfig } from '../../../lib/remote/index.js';

interface ResourcesOptions {
  json?: boolean;
}

interface VmResources {
  name: string;
  status: string;
  memoryMB: number;
  diskMB: number;
  isInfra: boolean;
}

export async function resourcesCommand(options: ResourcesOptions): Promise<void> {
  const spinner = ora('Gathering resource usage...').start();

  try {
    const config = loadConfig();

    if (!config.remote?.enabled) {
      spinner.warn('Remote workspaces not enabled');
      console.log('');
      console.log(chalk.dim('Run: pan remote setup'));
      return;
    }

    const fly = createFlyProviderFromConfig(config.remote);

    // Check authentication
    const isAuth = await Effect.runPromise(fly.isAuthenticated());
    if (!isAuth) {
      spinner.fail('Not authenticated with Fly.io');
      console.log('');
      console.log(chalk.dim('Run: fly auth login  or  export FLY_API_TOKEN=<token>'));
      return;
    }

    // Get VM list
    const vms = await Effect.runPromise(fly.listVms());

    // Collect resource usage for running VMs
    const resources: VmResources[] = [];
    let totalMemory = 0;
    let totalDisk = 0;

    for (const vm of vms) {
      if (vm.status !== 'running') {
        resources.push({
          name: vm.name,
          status: vm.status,
          memoryMB: 0,
          diskMB: 0,
          isInfra: false,
        });
        continue;
      }

      spinner.text = `Checking ${vm.name}...`;

      try {
        // Get memory usage via SSH
        const memResult = await Effect.runPromise(fly.ssh(vm.name, "free -m | awk '/^Mem:/ {print $3}'"));
        const memMB = parseInt(memResult.stdout.trim(), 10) || 0;

        // Get disk usage
        const diskResult = await Effect.runPromise(fly.ssh(vm.name, "df -m / | awk 'NR==2 {print $3}'"));
        const diskMB = parseInt(diskResult.stdout.trim(), 10) || 0;

        resources.push({
          name: vm.name,
          status: vm.status,
          memoryMB: memMB,
          diskMB: diskMB,
          isInfra: false,
        });

        totalMemory += memMB;
        totalDisk += diskMB;
      } catch {
        resources.push({
          name: vm.name,
          status: vm.status,
          memoryMB: 0,
          diskMB: 0,
          isInfra: false,
        });
      }
    }

    spinner.succeed('Resource usage collected');

    if (options.json) {
      console.log(JSON.stringify({
        vms: resources,
        total: {
          memoryMB: totalMemory,
          diskMB: totalDisk,
        },
        plan: {
          memoryGB: 16,
          maxVms: 30,
        },
      }, null, 2));
      return;
    }

    console.log('');
    console.log(chalk.bold('Remote Resource Usage'));
    console.log('');

    // Plan info (hardcoded for now - could be fetched from Fly.io API)
    const planMemoryGB = 16;
    const planMaxVms = 30;
    const usedMemoryGB = totalMemory / 1024;
    const memoryPercent = Math.round((usedMemoryGB / planMemoryGB) * 100);

    console.log(chalk.dim(`  Fly.io: ${planMemoryGB}GB RAM capacity, up to ${planMaxVms} machines`));
    console.log('');

    // Memory bar
    const barWidth = 40;
    const filledBars = Math.round((memoryPercent / 100) * barWidth);
    const emptyBars = barWidth - filledBars;
    const bar = chalk.green('━'.repeat(filledBars)) + chalk.dim('━'.repeat(emptyBars));

    console.log(chalk.bold('  RAM Usage:'));
    console.log(`    ${bar} ${memoryPercent}%`);
    console.log(`    ${chalk.cyan(usedMemoryGB.toFixed(1))}GB / ${planMemoryGB}GB used`);
    console.log('');

    // Per-VM breakdown
    console.log(chalk.bold('  VM Breakdown:'));
    console.log('');

    // Sort: infra first, then by memory usage
    resources.sort((a, b) => {
      if (a.isInfra) return -1;
      if (b.isInfra) return 1;
      return b.memoryMB - a.memoryMB;
    });

    for (const vm of resources) {
      const statusIcon = vm.status === 'running'
        ? chalk.green('●')
        : vm.status === 'stopped'
          ? chalk.yellow('○')
          : chalk.dim('◌');

      const infraLabel = vm.isInfra ? chalk.dim(' (shared services)') : '';

      if (vm.status === 'running') {
        const memGB = (vm.memoryMB / 1024).toFixed(1);
        console.log(`    ${statusIcon} ${vm.name}${infraLabel}`);
        console.log(`      Memory: ${chalk.cyan(memGB)}GB  Disk: ${chalk.cyan((vm.diskMB / 1024).toFixed(1))}GB`);
      } else {
        console.log(`    ${statusIcon} ${vm.name}${infraLabel} - ${vm.status}`);
      }
    }

    console.log('');

    // Estimate available workspaces
    const avgWorkspaceMemoryGB = 1.1;
    const infraMemoryGB = resources.find(r => r.isInfra)?.memoryMB
      ? resources.find(r => r.isInfra)!.memoryMB / 1024
      : 0.5;
    const availableMemoryGB = planMemoryGB - usedMemoryGB;
    const availableWorkspaces = Math.floor(availableMemoryGB / avgWorkspaceMemoryGB);

    console.log(chalk.bold('  Capacity:'));
    console.log(`    Available:  ${chalk.cyan(availableMemoryGB.toFixed(1))}GB`);
    console.log(`    Workspaces: ~${chalk.cyan(availableWorkspaces)} more (at ${avgWorkspaceMemoryGB}GB each)`);
    console.log('');

  } catch (error: any) {
    spinner.fail(`Failed to get resources: ${error.message}`);
    process.exit(1);
  }
}
