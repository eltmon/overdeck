/**
 * Remote Provider Interface
 *
 * Defines the contract for remote workspace providers (e.g., Fly.io)
 * Remote providers manage VM lifecycle and enable offloading workloads from local machine.
 */

export type VmStatus = 'running' | 'stopped' | 'creating' | 'deleting' | 'unknown';

export interface VmInfo {
  name: string;
  status: VmStatus;
  created?: Date;
  ipAddress?: string;
  machineId?: string;
  // Memory usage in MB
  memoryUsed?: number;
  memoryTotal?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RemoteProviderConfig {
  name: string;
  defaultLocation?: 'local' | 'remote';
  autoHibernateMinutes?: number;
}

/**
 * Remote Provider Interface
 *
 * All remote providers must implement this interface to provide:
 * - VM lifecycle management (create, delete, start, stop)
 * - SSH command execution
 * - Status monitoring
 */
export interface RemoteProvider {
  /** Provider name (e.g., 'exe', 'aws') */
  readonly name: string;

  /** Check if the provider is authenticated */
  isAuthenticated(): Promise<boolean>;

  /** Create a new VM */
  createVm(name: string): Promise<VmInfo>;

  /** Delete a VM */
  deleteVm(name: string): Promise<void>;

  /** List all VMs */
  listVms(): Promise<VmInfo[]>;

  /** Get VM status */
  getStatus(name: string): Promise<VmStatus>;

  /** Get detailed VM info */
  getVmInfo(name: string): Promise<VmInfo | null>;

  /** Start a stopped VM */
  startVm(name: string): Promise<void>;

  /** Stop a running VM (hibernate) */
  stopVm(name: string): Promise<void>;

  /** Execute a command on a VM via SSH */
  ssh(vm: string, command: string): Promise<ExecResult>;

  /** Execute a command and stream output */
  sshStream(vm: string, command: string): AsyncIterable<string>;

  /** Copy file to VM */
  copyToVm(vm: string, localPath: string, remotePath: string): Promise<void>;

  /** Copy file from VM */
  copyFromVm(vm: string, remotePath: string, localPath: string): Promise<void>;

  /** Expose a port on VM (returns public URL) */
  exposePort(vm: string, port: number): Promise<string>;

  /** Create SSH tunnel to VM */
  tunnel(vm: string, remotePort: number, localPort: number): Promise<{ close: () => void }>;
}

/**
 * Remote workspace metadata
 * Stored in ~/.panopticon/workspaces/{issueId}.yaml
 */
export interface RemoteWorkspaceMetadata {
  id: string;
  issue: string;
  provider: string;
  vmName: string;
  machineId?: string;
  appName?: string;
  urls: {
    frontend?: string;
    api?: string;
  };
  created: Date;
  location: 'local' | 'remote';
}
