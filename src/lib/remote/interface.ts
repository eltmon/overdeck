/**
 * Remote Provider Interface
 *
 * Defines the contract for remote workspace providers (e.g., Fly.io)
 * Remote providers manage VM lifecycle and enable offloading workloads from local machine.
 */

import { Data, Effect, Stream } from 'effect';

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

/** A remote VM operation (lifecycle, SSH exec, file copy, tunnel) failed. */
export class RemoteError extends Data.TaggedError('RemoteError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

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
  isAuthenticated(): Effect.Effect<boolean, RemoteError>;

  /** Create a new VM */
  createVm(name: string): Effect.Effect<VmInfo, RemoteError>;

  /** Delete a VM */
  deleteVm(name: string): Effect.Effect<void, RemoteError>;

  /** List all VMs */
  listVms(): Effect.Effect<VmInfo[], RemoteError>;

  /** Get VM status */
  getStatus(name: string): Effect.Effect<VmStatus, RemoteError>;

  /** Get detailed VM info */
  getVmInfo(name: string): Effect.Effect<VmInfo | null, RemoteError>;

  /** Start a stopped VM */
  startVm(name: string): Effect.Effect<void, RemoteError>;

  /** Stop a running VM (hibernate) */
  stopVm(name: string): Effect.Effect<void, RemoteError>;

  /** Execute a command on a VM via SSH */
  ssh(vm: string, command: string): Effect.Effect<ExecResult, RemoteError>;

  /** Execute a command and stream output */
  sshStream(vm: string, command: string): Stream.Stream<string, RemoteError>;

  /** Copy file to VM */
  copyToVm(vm: string, localPath: string, remotePath: string): Effect.Effect<void, RemoteError>;

  /** Copy file from VM */
  copyFromVm(vm: string, remotePath: string, localPath: string): Effect.Effect<void, RemoteError>;

  /** Expose a port on VM (returns public URL) */
  exposePort(vm: string, port: number): Effect.Effect<string, RemoteError>;

  /** Create SSH tunnel to VM */
  tunnel(vm: string, remotePort: number, localPort: number): Effect.Effect<{ close: () => void }, RemoteError>;
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
