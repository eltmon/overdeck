/**
 * This machine's capability tags and placement mode (PAN-4651 FR-7, D-4651-8).
 *
 * Tags are detected at server start and every 10 minutes: the OS (`linux`,
 * `macos`, `windows`), `docker` when `docker info` exits 0, `gpu` when
 * `nvidia-smi -L` exits 0, and `ios-sim` on macOS when `xcrun simctl list
 * devices` exits 0. Operator tags from `anywhere.machine.tags` are appended.
 * Every probe is an async `execFile` with a timeout (NFR-4). Tags are
 * lower-case, match `TAG_PATTERN`, deduplicated and sorted; an invalid operator
 * tag is dropped with one warning. Tags ride in the link heartbeat, never in
 * the public environment descriptor (which needs no credential).
 */
import { execFile as nodeExecFile } from 'node:child_process';

import type { LoadSample, MachinePlacementMode } from '@overdeck/contracts';

import { type MachineConfig, readMachineConfig } from './machine-config.js';

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CAPABILITY_REFRESH_MS = 10 * 60_000;

export interface MachineProfile {
  tags: string[];
  placement: MachinePlacementMode;
}

/** What a viewer knows about a peer's load and profile; old peers send none of it. */
export interface PeerMachineFacts {
  load: LoadSample | null;
  tags: string[];
  placement: MachinePlacementMode;
}

export const UNKNOWN_PEER_MACHINE_FACTS: PeerMachineFacts = { load: null, tags: [], placement: 'auto' };

export type ProbeExecFile = (file: string, args: readonly string[], options: { timeout: number }) => Promise<void>;

export interface CapabilityDeps {
  platform: NodeJS.Platform;
  execFile: ProbeExecFile;
  readConfig: () => Promise<MachineConfig>;
  warn: (message: string) => void;
}

const defaultExecFile: ProbeExecFile = (file, args, options) =>
  new Promise((resolve, reject) => {
    nodeExecFile(file, [...args], { timeout: options.timeout, windowsHide: true }, (error) => (error ? reject(error) : resolve()));
  });

export const defaultCapabilityDeps = (): CapabilityDeps => ({
  platform: process.platform,
  execFile: defaultExecFile,
  readConfig: readMachineConfig,
  warn: (message) => console.warn(`[anywhere] ${message}`),
});

const OS_TAGS: Partial<Record<NodeJS.Platform, string>> = { linux: 'linux', darwin: 'macos', win32: 'windows' };

async function exitsZero(deps: CapabilityDeps, file: string, args: readonly string[], timeout: number): Promise<boolean> {
  try {
    await deps.execFile(file, args, { timeout });
    return true;
  } catch {
    return false;
  }
}

/** Lower-case, valid, deduplicated and sorted. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.toLowerCase()).filter((tag) => TAG_PATTERN.test(tag)))].sort();
}

/** Detect the tags and read the placement mode once. */
export async function detectMachineProfile(deps: CapabilityDeps = defaultCapabilityDeps()): Promise<MachineProfile> {
  const detected: string[] = [];
  const os = OS_TAGS[deps.platform];
  if (os) detected.push(os);
  const [docker, gpu, iosSim, config] = await Promise.all([
    exitsZero(deps, 'docker', ['info'], 10_000),
    exitsZero(deps, 'nvidia-smi', ['-L'], 5_000),
    deps.platform === 'darwin' ? exitsZero(deps, 'xcrun', ['simctl', 'list', 'devices'], 10_000) : Promise.resolve(false),
    deps.readConfig(),
  ]);
  if (docker) detected.push('docker');
  if (gpu) detected.push('gpu');
  if (iosSim) detected.push('ios-sim');
  const invalid = config.tags.filter((tag) => !TAG_PATTERN.test(tag.toLowerCase()));
  if (invalid.length > 0) deps.warn(`anywhere.machine.tags: ignoring invalid tag(s) ${invalid.map((tag) => JSON.stringify(tag)).join(', ')}`);
  return { tags: normalizeTags([...detected, ...config.tags]), placement: config.placement };
}

let current: MachineProfile | null = null;
let timer: NodeJS.Timeout | null = null;

/** The last detected profile; null until the first detection finishes. */
export function currentMachineProfile(): MachineProfile | null {
  return current;
}

/** Detect now and every `CAPABILITY_REFRESH_MS`; the interval is unref'd. */
export function startMachineCapabilities(deps: CapabilityDeps = defaultCapabilityDeps()): void {
  if (timer) return;
  const refresh = (): void => {
    void detectMachineProfile(deps).then(
      (profile) => { current = profile; },
      (error: Error) => deps.warn(`capability detection failed: ${error.message}`),
    );
  };
  refresh();
  timer = setInterval(refresh, CAPABILITY_REFRESH_MS);
  timer.unref?.();
}

export function stopMachineCapabilities(): void {
  if (timer) clearInterval(timer);
  timer = null;
  current = null;
}

const finiteOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A heartbeat's `load` field from a peer (plain JSON, no schema); null when absent or malformed. */
export function parseLoadSample(raw: unknown): LoadSample | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value['cpuSaturated'] !== 'boolean' || typeof value['sampledAt'] !== 'string') return null;
  return {
    cpuPsiSomeAvg10: finiteOrNull(value['cpuPsiSomeAvg10']),
    cpuSaturated: value['cpuSaturated'],
    memAvailableBytes: finiteOrNull(value['memAvailableBytes']),
    workingAgents: finiteOrNull(value['workingAgents']) ?? 0,
    sampledAt: value['sampledAt'],
  };
}

/** The load, tags and placement a peer's heartbeat carries; defaults for a peer that predates them. */
export function peerMachineFacts(payload: { load?: unknown; tags?: unknown; placement?: unknown }): PeerMachineFacts {
  const tags = Array.isArray(payload.tags) ? normalizeTags(payload.tags.filter((tag): tag is string => typeof tag === 'string')) : [];
  return { load: parseLoadSample(payload.load), tags, placement: payload.placement === 'on-request' ? 'on-request' : 'auto' };
}
