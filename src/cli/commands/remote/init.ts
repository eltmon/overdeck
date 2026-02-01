/**
 * pan remote init
 *
 * Initialize shared infrastructure VM with postgres, redis, traefik.
 */

import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, saveConfig } from '../../../lib/config.js';
import { createExeProvider } from '../../../lib/remote/index.js';

interface InitOptions {
  name?: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const vmName = options.name || 'pan-infra';
  const spinner = ora(`Initializing infrastructure VM '${vmName}'...`).start();

  try {
    const config = loadConfig();

    // Check if remote is enabled
    if (!config.remote?.enabled) {
      spinner.warn('Remote workspaces not enabled');
      console.log('');
      console.log(chalk.dim('Run: pan remote setup'));
      return;
    }

    const exe = createExeProvider({
      infraVm: config.remote.exe?.infra_vm,
    });

    // Check authentication
    const isAuth = await exe.isAuthenticated();
    if (!isAuth) {
      spinner.fail('Not authenticated with exe.dev');
      console.log('');
      console.log(chalk.dim('Run: exe auth login'));
      return;
    }

    // Check if VM already exists
    spinner.text = 'Checking for existing VM...';
    const vms = await exe.listVms();
    const existingVm = vms.find(vm => vm.name === vmName);

    if (existingVm) {
      if (existingVm.status === 'running') {
        spinner.info(`Infrastructure VM '${vmName}' already exists and is running`);
        console.log('');
        console.log('To reinitialize, delete the VM first:');
        console.log(`  exe vm delete ${vmName} --force`);
        return;
      } else if (existingVm.status === 'stopped') {
        spinner.text = 'Starting stopped VM...';
        await exe.startVm(vmName);
      }
    } else {
      // Create new VM
      spinner.text = 'Creating VM (this may take 1-2 minutes)...';
      await exe.createVm(vmName);
    }

    // Install Docker
    spinner.text = 'Checking Docker installation...';
    const dockerCheck = await exe.ssh(vmName, 'which docker');

    if (dockerCheck.exitCode !== 0) {
      spinner.text = 'Installing Docker...';
      const dockerInstall = await exe.ssh(vmName, 'curl -fsSL https://get.docker.com | sh');
      if (dockerInstall.exitCode !== 0) {
        throw new Error('Failed to install Docker: ' + dockerInstall.stderr);
      }

      // Add user to docker group
      await exe.ssh(vmName, 'sudo usermod -aG docker $USER');
    }

    // Create docker-compose.yml
    spinner.text = 'Setting up shared services...';

    const composeContent = `version: '3.8'
services:
  postgres:
    image: postgres:16
    container_name: pan-postgres
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: \${PAN_POSTGRES_PASSWORD:-panopticon}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    networks:
      - panopticon

  redis:
    image: redis:7
    container_name: pan-redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    networks:
      - panopticon

  traefik:
    image: traefik:v3.0
    container_name: pan-traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_certs:/etc/traefik/certs
    command:
      - --api.dashboard=true
      - --api.insecure=true
      - --providers.docker=true
      - --providers.docker.network=panopticon
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
    networks:
      - panopticon
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.traefik.rule=Host(\\\`traefik.pan.exe.dev\\\`)"
      - "traefik.http.routers.traefik.service=api@internal"

volumes:
  postgres_data:
  redis_data:
  traefik_certs:

networks:
  panopticon:
    name: panopticon
`;

    // Write compose file
    const writeResult = await exe.ssh(vmName, `mkdir -p /opt/panopticon && cat > /opt/panopticon/docker-compose.yml << 'COMPOSE_EOF'
${composeContent}
COMPOSE_EOF`);

    if (writeResult.exitCode !== 0) {
      throw new Error('Failed to write docker-compose.yml: ' + writeResult.stderr);
    }

    // Create network first
    await exe.ssh(vmName, 'docker network create panopticon 2>/dev/null || true');

    // Start services
    spinner.text = 'Starting services (postgres, redis, traefik)...';
    const upResult = await exe.ssh(vmName, 'cd /opt/panopticon && docker compose up -d');

    if (upResult.exitCode !== 0) {
      throw new Error('Failed to start services: ' + upResult.stderr);
    }

    // Wait for services to be healthy
    spinner.text = 'Waiting for services to be ready...';
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify services
    const psResult = await exe.ssh(vmName, 'docker ps --format "{{.Names}}: {{.Status}}"');

    // Update config with infra VM name
    if (config.remote && config.remote.exe) {
      config.remote.exe.infra_vm = vmName;
      config.remote.exe.postgres_host = vmName;
      config.remote.exe.redis_host = vmName;
      saveConfig(config);
    }

    spinner.succeed(`Infrastructure VM '${vmName}' initialized!`);

    console.log('');
    console.log(chalk.bold('Services Running:'));
    console.log('');

    const lines = psResult.stdout.trim().split('\n');
    for (const line of lines) {
      if (line.includes('pan-')) {
        console.log(`  ${chalk.green('●')} ${line}`);
      }
    }

    console.log('');
    console.log(chalk.bold('Connection Info:'));
    console.log('');
    console.log(`  PostgreSQL: ${chalk.cyan(`${vmName}:5432`)}`);
    console.log(`  Redis:      ${chalk.cyan(`${vmName}:6379`)}`);
    console.log(`  Traefik:    ${chalk.cyan(`${vmName}:8080`)}`);
    console.log('');
    console.log(chalk.dim('  Workspaces will connect to these shared services.'));
    console.log('');

  } catch (error: any) {
    spinner.fail(`Failed to initialize: ${error.message}`);
    process.exit(1);
  }
}
