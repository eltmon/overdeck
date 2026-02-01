/**
 * pan remote setup
 *
 * Interactive setup for exe.dev integration:
 * 1. Check if exe CLI is installed
 * 2. Help with SSH key setup
 * 3. Authenticate with exe.dev
 * 4. Configure Panopticon remote settings
 */

import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, saveConfig } from '../../../lib/config.js';
import { createExeProvider } from '../../../lib/remote/index.js';

const execAsync = promisify(exec);

export async function setupCommand(): Promise<void> {
  console.log('');
  console.log(chalk.bold('🚀 Remote Workspace Setup'));
  console.log(chalk.dim('   Configure exe.dev for remote workspaces'));
  console.log('');

  // Step 1: Check if exe CLI is installed
  const spinner = ora('Checking exe.dev CLI...').start();

  // exe.dev uses SSH-based access, no separate CLI to install
  spinner.succeed('exe.dev uses SSH-based access (no CLI installation needed)');

  // Step 2: Check SSH key setup
  console.log('');
  console.log(chalk.bold('  Step 2: SSH Key Configuration'));
  console.log('');

  const sshDir = join(homedir(), '.ssh');
  const defaultKeyPath = join(sshDir, 'id_ed25519');
  const rsaKeyPath = join(sshDir, 'id_rsa');

  let sshKeyExists = false;
  let keyPath = '';

  if (existsSync(defaultKeyPath)) {
    sshKeyExists = true;
    keyPath = defaultKeyPath;
    console.log(`  ${chalk.green('✓')} SSH key found: ${chalk.dim(defaultKeyPath)}`);
  } else if (existsSync(rsaKeyPath)) {
    sshKeyExists = true;
    keyPath = rsaKeyPath;
    console.log(`  ${chalk.green('✓')} SSH key found: ${chalk.dim(rsaKeyPath)}`);
  } else {
    console.log(`  ${chalk.yellow('!')} No SSH key found`);
    console.log('');
    console.log('  Generate an SSH key:');
    console.log('');
    console.log(chalk.cyan('    ssh-keygen -t ed25519 -C "your-email@example.com"'));
    console.log('');
  }

  // Show public key if exists
  if (sshKeyExists) {
    const pubKeyPath = `${keyPath}.pub`;
    if (existsSync(pubKeyPath)) {
      const pubKey = readFileSync(pubKeyPath, 'utf8').trim();
      console.log('');
      console.log('  Your public key (add this to exe.dev if not already):');
      console.log('');
      console.log(chalk.dim(`    ${pubKey.substring(0, 60)}...`));
      console.log('');
    }
  }

  // Step 3: Check exe.dev authentication
  console.log('');
  console.log(chalk.bold('  Step 3: exe.dev Authentication'));
  console.log('');

  const exe = createExeProvider();
  const isAuth = await exe.isAuthenticated();

  if (isAuth) {
    console.log(`  ${chalk.green('✓')} Authenticated with exe.dev (SSH connection works)`);
  } else {
    console.log(`  ${chalk.yellow('!')} Cannot connect to exe.dev via SSH`);
    console.log('');
    console.log('  To set up exe.dev access:');
    console.log('');
    console.log('  1. Create an account at https://exe.dev');
    console.log('  2. Add your SSH public key to your exe.dev account');
    console.log('  3. Test with: ' + chalk.cyan('ssh exe.dev'));
    console.log('');
    console.log('  Your public key to add:');
    if (sshKeyExists) {
      const pubKeyPath = `${keyPath}.pub`;
      if (existsSync(pubKeyPath)) {
        const pubKey = readFileSync(pubKeyPath, 'utf8').trim();
        console.log(chalk.dim(`    ${pubKey}`));
      }
    } else {
      console.log(chalk.dim('    (generate one first with ssh-keygen)'));
    }
    console.log('');
    return;
  }

  // Step 4: Configure Panopticon
  console.log('');
  console.log(chalk.bold('  Step 4: Configure Panopticon'));
  console.log('');

  const config = loadConfig();

  // Enable remote if not already
  if (!config.remote?.enabled) {
    config.remote = {
      enabled: true,
      provider: 'exe',
      default_location: 'remote',
      auto_hibernate_minutes: 240, // 4 hours
      exe: {
        infra_vm: 'pan-infra',
        postgres_host: 'pan-infra',
        postgres_port: 5432,
        postgres_user: 'postgres',
        postgres_password_env: 'PAN_POSTGRES_PASSWORD',
        redis_host: 'pan-infra',
        redis_port: 6379,
      },
    };

    saveConfig(config);
    console.log(`  ${chalk.green('✓')} Remote configuration added to config.toml`);
  } else {
    console.log(`  ${chalk.green('✓')} Remote already configured`);
  }

  // Step 5: Check for infra VM
  console.log('');
  console.log(chalk.bold('  Step 5: Infrastructure VM'));
  console.log('');

  try {
    const vms = await exe.listVms();
    const infraVm = config.remote?.exe?.infra_vm || 'pan-infra';
    const hasInfra = vms.some(vm => vm.name === infraVm);

    if (hasInfra) {
      const infra = vms.find(vm => vm.name === infraVm)!;
      const statusIcon = infra.status === 'running' ? chalk.green('●') : chalk.yellow('○');
      console.log(`  ${statusIcon} Infrastructure VM '${infraVm}' exists (${infra.status})`);
    } else {
      console.log(`  ${chalk.yellow('!')} Infrastructure VM '${infraVm}' not found`);
      console.log('');
      console.log('  Initialize shared infrastructure:');
      console.log('');
      console.log(chalk.cyan('    pan remote init'));
      console.log('');
      console.log('  This creates a VM with postgres, redis, and traefik.');
    }
  } catch (error: any) {
    console.log(`  ${chalk.red('✗')} Could not check VMs: ${error.message}`);
  }

  // Summary
  console.log('');
  console.log(chalk.bold('Setup Complete!'));
  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log(`  ${chalk.cyan('pan remote init')}       Initialize shared infrastructure`);
  console.log(`  ${chalk.cyan('pan remote status')}     Check connection and VMs`);
  console.log(`  ${chalk.cyan('pan workspace create --remote <issue>')}   Create remote workspace`);
  console.log('');
}
