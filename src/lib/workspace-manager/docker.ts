import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { DockerCleanupResult, WorkspaceDockerTeardownResult } from './types.js';
import { DEVCONTAINER_DIRNAME } from '../workspace/devcontainer-renderer.js';

const execAsync = promisify(exec);

export async function getContainersReferencingWorkspacePathPromise(
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
}

export async function stopWorkspaceDockerPromise(
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
    const orphanedContainers = await getContainersReferencingWorkspacePathPromise(workspacePath);
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
}

/**
 * Tear down a workspace Docker stack by project/network name, independent of
 * whether the workspace directory still exists. This is the durable close-out
 * primitive: it removes containers AND the `_devnet` network and verifies the
 * network is gone.
 */
export async function teardownWorkspaceDockerByNamePromise(
  issueIdLower: string,
): Promise<WorkspaceDockerTeardownResult> {
  const featureFolder = `feature-${issueIdLower}`;
  const composeProjectName = `overdeck-${featureFolder}`;
  const networkName = `${composeProjectName}_devnet`;
  const result: WorkspaceDockerTeardownResult = {
    networkRemoved: false,
    steps: [],
  };

  // 1. Stop and remove containers/volumes for the named compose project.
  try {
    await execAsync(
      `docker compose -p "${composeProjectName}" down -v --remove-orphans`,
      { timeout: 60000 },
    );
    result.steps.push(`Stopped Docker stack for project ${composeProjectName}`);
  } catch (error: any) {
    result.steps.push(
      `Docker stack down attempted (${error.message?.split('\n')[0] || 'stack may not exist'})`,
    );
  }

  // 2. If containers are still attached to the network (compose files missing,
  //    project label mismatch, etc.), remove them by force so the network can
  //    be freed. This is the durable close-out fallback.
  try {
    const { stdout: containerStdout } = await execAsync(
      `docker ps -a --filter network="${networkName}" --format '{{.ID}}'`,
      { encoding: 'utf-8', timeout: 30000 },
    );
    const containerIds = containerStdout.trim().split('\n').filter(Boolean);
    if (containerIds.length > 0) {
      try {
        await execAsync(`docker rm -f ${containerIds.map((id) => `"${id}"`).join(' ')}`, {
          timeout: 30000,
        });
        result.steps.push(
          `Removed ${containerIds.length} container(s) attached to ${networkName}`,
        );
      } catch (rmError: any) {
        result.steps.push(
          `Container removal attempted (${rmError.message?.split('\n')[0] || 'containers may be in use'})`,
        );
      }
    }
  } catch (error: any) {
    result.steps.push(
      `Container discovery attempted (${error.message?.split('\n')[0] || 'could not list containers'})`,
    );
  }

  // 3. Remove the bridge network; treat already-absent as success.
  try {
    await execAsync(`docker network rm "${networkName}"`, { timeout: 30000 });
    result.steps.push(`Removed Docker network ${networkName}`);
  } catch (error: any) {
    const message = (error.message || '').toLowerCase();
    if (message.includes('not found') || message.includes('no such network')) {
      result.steps.push(`Docker network ${networkName} already absent`);
    } else {
      result.steps.push(
        `Docker network rm attempted (${error.message?.split('\n')[0] || 'network may be in use'})`,
      );
    }
  }

  // 3. Verify the network is actually gone.
  try {
    const { stdout } = await execAsync(
      `docker network ls --format '{{.Name}}'`,
      { encoding: 'utf-8', timeout: 30000 },
    );
    const networks = stdout.trim().split('\n').filter(Boolean);
    result.networkRemoved = !networks.includes(networkName);
    result.steps.push(
      result.networkRemoved
        ? `Verified network ${networkName} is absent`
        : `Network ${networkName} still present after teardown`,
    );
  } catch (error: any) {
    result.steps.push(
      `Network verification attempted (${error.message?.split('\n')[0] || 'could not list networks'})`,
    );
  }

  return result;
}
