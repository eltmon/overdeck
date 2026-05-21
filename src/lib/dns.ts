/**
 * DNS Management
 *
 * Centralized DNS entry management for Panopticon.
 * Supports three sync methods:
 * - wsl2hosts: WSL2 → Windows hosts file sync via PowerShell scheduled task
 * - hosts_file: Direct /etc/hosts manipulation with managed block markers
 * - dnsmasq: System-wide dnsmasq configuration (Linux/macOS)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { detectPlatform } from './platform.js';

const execAsync = promisify(exec);

export type DnsSyncMethod = 'wsl2hosts' | 'hosts_file' | 'dnsmasq';

// ---- Detection ----

/**
 * Detect the best DNS sync method for the current platform.
 */
export function detectDnsSyncMethod(): DnsSyncMethod {
  const plat = Effect.runSync(detectPlatform());
  switch (plat) {
    case 'wsl':
      return 'wsl2hosts';
    case 'darwin':
      return isDnsmasqInstalled() ? 'dnsmasq' : 'hosts_file';
    case 'linux':
      return isDnsmasqInstalled() ? 'dnsmasq' : 'hosts_file';
    default:
      return 'hosts_file';
  }
}

/**
 * Check if dnsmasq is installed.
 * Note: Uses execSync intentionally — this only runs in CLI context (pan install/up),
 * never from the dashboard server.
 */
function isDnsmasqInstalled(): boolean {
  try {
    execSync('which dnsmasq', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---- wsl2hosts method ----

export function addWsl2HostEntry(hostname: string): boolean {
  const wsl2hostsPath = join(homedir(), '.wsl2hosts');

  try {
    let content = '';
    if (existsSync(wsl2hostsPath)) {
      content = readFileSync(wsl2hostsPath, 'utf-8');
    }

    if (!content.includes(hostname)) {
      writeFileSync(wsl2hostsPath, content + (content.endsWith('\n') ? '' : '\n') + hostname + '\n');
    }
    return true;
  } catch {
    return false;
  }
}

export function removeWsl2HostEntry(hostname: string): boolean {
  const wsl2hostsPath = join(homedir(), '.wsl2hosts');

  try {
    if (!existsSync(wsl2hostsPath)) return true;

    const content = readFileSync(wsl2hostsPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== hostname);
    writeFileSync(wsl2hostsPath, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

export async function syncDnsToWindows(): Promise<boolean> {
  try {
    await execAsync('powershell.exe -Command "Start-ScheduledTask -TaskName \'PanopticonWsl2HostsSync\'"');
    return true;
  } catch {
    // Fall back to legacy task name
    try {
      await execAsync('powershell.exe -Command "Start-ScheduledTask -TaskName \'SyncMynHosts\'"');
      return true;
    } catch {
      return false;
    }
  }
}

// ---- hosts_file method ----

const HOSTS_FILE = '/etc/hosts';
const MARKER_START = '# BEGIN panopticon managed entries';
const MARKER_END = '# END panopticon managed entries';

export function addHostsFileEntry(hostname: string, ip: string = '127.0.0.1'): boolean {
  try {
    let content = existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, 'utf-8') : '';
    const entry = `${ip}\t${hostname}`;

    // Already present anywhere in file
    if (content.includes(`\t${hostname}`) || content.includes(` ${hostname}`)) return true;

    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Managed block exists — insert entry before MARKER_END
      const before = content.substring(0, endIdx);
      const after = content.substring(endIdx);
      content = before + entry + '\n' + after;
    } else {
      // Create managed block at end
      content = content.trimEnd() + '\n\n' + MARKER_START + '\n' + entry + '\n' + MARKER_END + '\n';
    }

    writeFileSync(HOSTS_FILE, content);
    return true;
  } catch {
    return false;
  }
}

export function removeHostsFileEntry(hostname: string): boolean {
  try {
    if (!existsSync(HOSTS_FILE)) return true;

    const content = readFileSync(HOSTS_FILE, 'utf-8');
    const lines = content.split('\n').filter(line => {
      const parts = line.trim().split(/\s+/);
      return parts[1] !== hostname;
    });
    writeFileSync(HOSTS_FILE, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

// ---- dnsmasq method ----

function getDnsmasqConfigDir(): string {
  const plat = Effect.runSync(detectPlatform());
  if (plat === 'darwin') {
    // Homebrew Intel location; Apple Silicon uses /opt/homebrew/etc/dnsmasq.d
    const brewPrefix = existsSync('/opt/homebrew') ? '/opt/homebrew' : '/usr/local';
    return `${brewPrefix}/etc/dnsmasq.d`;
  }
  return '/etc/dnsmasq.d';
}

const PANOPTICON_DNSMASQ_CONF = 'panopticon.conf';

export function addDnsmasqEntry(hostname: string, ip: string = '127.0.0.1'): boolean {
  try {
    const configDir = getDnsmasqConfigDir();
    mkdirSync(configDir, { recursive: true });
    const confPath = join(configDir, PANOPTICON_DNSMASQ_CONF);

    let content = '';
    if (existsSync(confPath)) {
      content = readFileSync(confPath, 'utf-8');
    }

    const entry = `address=/${hostname}/${ip}`;
    if (content.includes(entry)) return true;

    content = content.trimEnd() + (content.length > 0 ? '\n' : '') + entry + '\n';
    writeFileSync(confPath, content);
    return true;
  } catch {
    return false;
  }
}

export function removeDnsmasqEntry(hostname: string): boolean {
  try {
    const configDir = getDnsmasqConfigDir();
    const confPath = join(configDir, PANOPTICON_DNSMASQ_CONF);
    if (!existsSync(confPath)) return true;

    const content = readFileSync(confPath, 'utf-8');
    const lines = content.split('\n').filter(line => !line.includes(`/${hostname}/`));
    writeFileSync(confPath, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

export async function restartDnsmasq(): Promise<boolean> {
  const plat = Effect.runSync(detectPlatform());
  try {
    if (plat === 'darwin') {
      await execAsync('brew services restart dnsmasq');
    } else {
      await execAsync('sudo systemctl restart dnsmasq');
    }
    return true;
  } catch {
    return false;
  }
}

// ---- Unified interface ----

/**
 * Add a DNS entry using the specified sync method.
 */
export function addDnsEntry(method: DnsSyncMethod, hostname: string): boolean {
  switch (method) {
    case 'wsl2hosts':
      return addWsl2HostEntry(hostname);
    case 'hosts_file':
      return addHostsFileEntry(hostname);
    case 'dnsmasq':
      return addDnsmasqEntry(hostname);
  }
}

/**
 * Remove a DNS entry using the specified sync method.
 */
export function removeDnsEntry(method: DnsSyncMethod, hostname: string): boolean {
  switch (method) {
    case 'wsl2hosts':
      return removeWsl2HostEntry(hostname);
    case 'hosts_file':
      return removeHostsFileEntry(hostname);
    case 'dnsmasq':
      return removeDnsmasqEntry(hostname);
  }
}

/**
 * Ensure the base Panopticon domain is resolvable.
 * Called during `pan install` and `pan up`.
 */
export function ensureBaseDomain(method: DnsSyncMethod, domain: string = 'pan.localhost'): boolean {
  return addDnsEntry(method, domain);
}
