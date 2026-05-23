import { Effect } from 'effect';
import { Command } from 'commander';
import chalk from 'chalk';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { parseDocument } from 'yaml';
import { clearConfigCache, getGlobalConfigPath, loadConfigSync, type NormalizedTtsDaemonConfig } from '../../lib/config-yaml.js';
import { buildTtsSpeakPayloadSync as buildRuntimeTtsSpeakPayload, type TtsSpeakPayload } from '../../lib/tts-speak.js';
import { deleteVoice, findVoiceById, findVoiceByName, loadVoices, type TtsVoice } from '../../lib/tts-voices.js';
import {
  getTtsDaemonAuthHeaders,
  getTtsDaemonStatus,
  installTtsSystemdUnit,
  runTtsDaemonForeground,
  startTtsDaemon,
  stopTtsDaemon,
  type TtsDaemonStartResult,
  type TtsDaemonStatus,
  type TtsDaemonStopResult,
} from '../../lib/tts-daemon.js';

export const DEFAULT_TTS_TEST_TEXT = 'The quick brown fox jumps over the lazy dog. Panopticon dashboard is now online.';
export const DEFAULT_TTS_TEST_VOICE = 'Vivian';

export type TtsTestVoiceKind = 'system' | 'status';

type PromiseOrProgram<T> = Promise<T> | Effect.Effect<T, unknown, never>;

async function runPromiseOrProgram<T>(value: PromiseOrProgram<T>): Promise<T> {
  return typeof (value as { pipe?: unknown }).pipe === 'function'
    ? Effect.runPromise(value as Effect.Effect<T, unknown, never>)
    : value as Promise<T>;
}

export interface RunTtsTestDeps {
  config?: NormalizedTtsDaemonConfig;
  findVoiceById?: (id: string) => PromiseOrProgram<TtsVoice | undefined>;
  fetch?: typeof fetch;
  stdout?: Pick<typeof console, 'log'>;
  stderr?: Pick<typeof console, 'error'>;
  voiceKind?: TtsTestVoiceKind;
}

export interface TtsVoiceCommandDeps {
  config?: NormalizedTtsDaemonConfig;
  loadVoices?: () => PromiseOrProgram<readonly TtsVoice[]>;
  findVoiceByName?: (name: string) => PromiseOrProgram<TtsVoice | undefined>;
  deleteVoice?: (id: string) => PromiseOrProgram<boolean>;
  updateTtsConfig?: (updates: TtsConfigUpdate) => Promise<void>;
  fetch?: typeof fetch;
  stdout?: Pick<typeof console, 'log'>;
  stderr?: Pick<typeof console, 'error'>;
}

export interface TtsDaemonCommandDeps {
  config?: NormalizedTtsDaemonConfig;
  getStatus?: (config: NormalizedTtsDaemonConfig) => PromiseOrProgram<TtsDaemonStatus>;
  startDaemon?: (options: { config: NormalizedTtsDaemonConfig; detach?: boolean; waitForHealth?: boolean; timeoutMs?: number }) => PromiseOrProgram<TtsDaemonStartResult>;
  stopDaemon?: (timeoutMs?: number) => PromiseOrProgram<TtsDaemonStopResult>;
  installSystemdUnit?: () => PromiseOrProgram<string>;
  runForeground?: (config: NormalizedTtsDaemonConfig) => PromiseOrProgram<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  stdout?: Pick<typeof console, 'log'>;
  stderr?: Pick<typeof console, 'error'>;
}

export interface TtsConfigUpdate {
  voice?: string;
  voiceMap?: Record<string, string>;
}

export type TtsTestResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'no-voice' | 'voice-not-found' | 'daemon-unavailable' | 'daemon-error'; message: string };

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

export function formatVoiceSource(voice: TtsVoice): string {
  if (voice.kind === 'preset') return voice.presetName || '';
  if (voice.kind === 'design') return truncate(voice.description, 40);
  const designedFrom = truncate(voice.description, 30);
  return designedFrom ? `embedding (designed from ${designedFrom})` : 'embedding';
}

export function formatVoicesTable(voices: TtsVoice[]): string {
  const rows = voices.map((voice) => [voice.name, voice.kind, formatVoiceSource(voice)]);
  const widths = [
    Math.max('NAME'.length, ...rows.map((row) => row[0].length)),
    Math.max('KIND'.length, ...rows.map((row) => row[1].length)),
    Math.max('MODEL/SOURCE'.length, ...rows.map((row) => row[2].length)),
  ];
  const lines = [
    `${pad('NAME', widths[0])}  ${pad('KIND', widths[1])}  ${pad('MODEL/SOURCE', widths[2])}`,
    `${'-'.repeat(widths[0])}  ${'-'.repeat(widths[1])}  ${'-'.repeat(widths[2])}`,
    ...rows.map((row) => `${pad(row[0], widths[0])}  ${pad(row[1], widths[1])}  ${pad(row[2], widths[2])}`),
  ];
  return lines.join('\n');
}

export function formatVoiceDetails(voice: TtsVoice): string {
  return JSON.stringify({
    ...voice,
    embedding: `[${voice.embedding?.length ?? 0} floats]`,
  }, null, 2);
}

export async function listTtsVoices(deps: TtsVoiceCommandDeps = {}): Promise<TtsVoice[]> {
  const voices = [...await runPromiseOrProgram((deps.loadVoices ?? loadVoices)())];
  const stdout = deps.stdout ?? console;
  if (voices.length === 0) {
    stdout.log('No voices saved yet');
  } else {
    stdout.log(formatVoicesTable(voices));
  }
  return voices;
}

async function findVoiceByNameOrReport(name: string, deps: TtsVoiceCommandDeps): Promise<TtsVoice | undefined> {
  const voice = await runPromiseOrProgram((deps.findVoiceByName ?? findVoiceByName)(name));
  if (!voice) (deps.stderr ?? console).error(chalk.red(`Voice not found: ${name}`));
  return voice;
}

export async function showTtsVoice(name: string, deps: TtsVoiceCommandDeps = {}): Promise<TtsVoice | undefined> {
  const voice = await findVoiceByNameOrReport(name, deps);
  if (!voice) return undefined;
  (deps.stdout ?? console).log(formatVoiceDetails(voice));
  return voice;
}

export async function updateTtsConfig(updates: TtsConfigUpdate): Promise<void> {
  const configPath = getGlobalConfigPath();
  let content = '';
  try {
    content = await readFile(configPath, 'utf-8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  const doc = parseDocument(content || '{}');
  if (updates.voice !== undefined) doc.setIn(['tts', 'voice'], updates.voice);
  if (updates.voiceMap) {
    for (const [event, voiceId] of Object.entries(updates.voiceMap)) {
      doc.setIn(['tts', 'voiceMap', event], voiceId);
    }
  }
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, doc.toString({ lineWidth: 120 }), 'utf-8');
  clearConfigCache();
}

export function buildTtsSpeakPayload(voice: TtsVoice, text: string, config: NormalizedTtsDaemonConfig): TtsSpeakPayload {
  return buildRuntimeTtsSpeakPayload(voice, text, config);
}

function buildDefaultTtsTestVoice(): TtsVoice {
  const presetName = process.env.QWEN_TTS_VOICE?.trim() || DEFAULT_TTS_TEST_VOICE;
  return {
    id: 'daemon-default-preset',
    name: presetName,
    kind: 'preset',
    createdAt: new Date(0).toISOString(),
    presetName,
    instruct: process.env.QWEN_TTS_INSTRUCT?.trim() || '',
  };
}

async function postTtsSpeakPayload(
  voice: TtsVoice,
  text: string | undefined,
  config: NormalizedTtsDaemonConfig,
  deps: Pick<TtsVoiceCommandDeps, 'fetch' | 'stdout' | 'stderr'>,
): Promise<TtsTestResult> {
  const url = `http://${config.daemonHost}:${config.daemonPort}/speak`;
  const payload = buildTtsSpeakPayload(voice, text?.trim() || DEFAULT_TTS_TEST_TEXT, config);
  const stdout = deps.stdout ?? console;
  const stderr = deps.stderr ?? console;

  try {
    const response = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await Effect.runPromise(getTtsDaemonAuthHeaders()) },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      const message = details ? `TTS daemon returned ${response.status}: ${details}` : `TTS daemon returned ${response.status}`;
      stderr.error(chalk.red(message));
      return { ok: false, reason: 'daemon-error', message };
    }

    stdout.log(chalk.green(`✓ Sent TTS test phrase to ${config.daemonHost}:${config.daemonPort}`));
    return { ok: true, url };
  } catch {
    const message = `Daemon not running at ${config.daemonHost}:${config.daemonPort}`;
    stderr.error(chalk.red(message));
    return { ok: false, reason: 'daemon-unavailable', message };
  }
}

export async function runTtsTest(text: string | undefined, deps: RunTtsTestDeps = {}): Promise<TtsTestResult> {
  const config = deps.config ?? loadConfigSync().config.tts;
  const voiceKind: TtsTestVoiceKind = deps.voiceKind ?? 'system';
  const configuredVoiceId = voiceKind === 'status' ? (config.statusVoice ?? '').trim() : config.voice.trim();
  const stdout = deps.stdout ?? console;
  const stderr = deps.stderr ?? console;

  if (!configuredVoiceId) {
    if (voiceKind === 'status') {
      const message = 'No status voice configured (set tts.statusVoice in config.yaml or pick one in Settings → TTS).';
      stderr.error(chalk.red(message));
      return { ok: false, reason: 'voice-not-found', message };
    }
    return postTtsSpeakPayload(buildDefaultTtsTestVoice(), text, config, { fetch: deps.fetch, stdout, stderr });
  }

  const voice = await runPromiseOrProgram((deps.findVoiceById ?? findVoiceById)(configuredVoiceId));
  if (!voice) {
    const label = voiceKind === 'status' ? 'status voice' : 'system voice';
    const message = `Configured ${label} not found: ${configuredVoiceId}`;
    stderr.error(chalk.red(message));
    return { ok: false, reason: 'voice-not-found', message };
  }

  return postTtsSpeakPayload(voice, text, config, { fetch: deps.fetch, stdout, stderr });
}

export async function playTtsVoice(name: string, text: string | undefined, deps: TtsVoiceCommandDeps = {}): Promise<TtsTestResult | undefined> {
  const voice = await findVoiceByNameOrReport(name, deps);
  if (!voice) return undefined;
  const config = deps.config ?? loadConfigSync().config.tts;
  return postTtsSpeakPayload(voice, text, config, deps);
}

export async function deleteTtsVoiceByName(name: string, deps: TtsVoiceCommandDeps = {}): Promise<boolean> {
  const voice = await findVoiceByNameOrReport(name, deps);
  if (!voice) return false;
  const deleted = await runPromiseOrProgram((deps.deleteVoice ?? deleteVoice)(voice.id));
  if (deleted) (deps.stdout ?? console).log(`Deleted ${voice.name}`);
  return deleted;
}

export async function setDefaultTtsVoice(name: string, deps: TtsVoiceCommandDeps = {}): Promise<TtsVoice | undefined> {
  const voice = await findVoiceByNameOrReport(name, deps);
  if (!voice) return undefined;
  await (deps.updateTtsConfig ?? updateTtsConfig)({ voice: voice.id });
  (deps.stdout ?? console).log(`Set ${voice.name} as system voice`);
  return voice;
}

export async function mapTtsVoice(event: string, name: string, deps: TtsVoiceCommandDeps = {}): Promise<TtsVoice | undefined> {
  const voice = await findVoiceByNameOrReport(name, deps);
  if (!voice) return undefined;
  await (deps.updateTtsConfig ?? updateTtsConfig)({ voiceMap: { [event]: voice.id } });
  (deps.stdout ?? console).log(`Mapped ${event} → ${voice.name}`);
  return voice;
}

function getTtsConfig(deps: TtsDaemonCommandDeps): NormalizedTtsDaemonConfig {
  return deps.config ?? loadConfigSync().config.tts;
}

function formatSeconds(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatMegabytes(mb: number | undefined): string | undefined {
  if (mb === undefined) return undefined;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${mb}MB`;
}

export function formatTtsDaemonStatus(status: TtsDaemonStatus): string {
  const state = status.phase === 'starting'
    ? chalk.yellow('starting')
    : status.ok
      ? chalk.green('healthy')
      : status.running
        ? chalk.yellow('unhealthy')
        : chalk.red('stopped');
  const lines = [
    `Daemon: ${state}`,
    `Endpoint: ${status.daemonHost}:${status.daemonPort}`,
    `PID: ${status.pid ?? '—'}`,
  ];
  if (status.model) lines.push(`Model: ${String(status.model)}`);
  if (status.queueDepth !== undefined) lines.push(`Queue depth: ${status.queueDepth}`);
  const uptime = formatSeconds(status.uptimeSeconds);
  if (uptime) lines.push(`Uptime: ${uptime}`);
  const gpuMemory = formatMegabytes(status.gpuMemoryUsedMb);
  if (gpuMemory) lines.push(`GPU memory: ${gpuMemory}`);
  if (status.error) lines.push(`Error: ${status.error}`);
  return lines.join('\n');
}

export async function runTtsDaemonStatus(deps: TtsDaemonCommandDeps = {}): Promise<TtsDaemonStatus> {
  const config = getTtsConfig(deps);
  const status = await runPromiseOrProgram((deps.getStatus ?? getTtsDaemonStatus)(config));
  (deps.stdout ?? console).log(formatTtsDaemonStatus(status));
  return status;
}

export async function runTtsDaemonStart(
  options: { detach?: boolean; waitForHealth?: boolean; timeoutMs?: number } = {},
  deps: TtsDaemonCommandDeps = {},
): Promise<TtsDaemonStartResult> {
  const config = getTtsConfig(deps);
  const result = await runPromiseOrProgram((deps.startDaemon ?? startTtsDaemon)({
    config,
    detach: options.detach,
    waitForHealth: options.waitForHealth,
    timeoutMs: options.timeoutMs,
  }));
  const stdout = deps.stdout ?? console;
  const stderr = deps.stderr ?? console;
  if (result.ok) {
    const prefix = result.alreadyRunning ? 'TTS daemon already running' : 'TTS daemon started';
    stdout.log(chalk.green(`✓ ${prefix}${result.pid ? ` (pid ${result.pid})` : ''}`));
  } else {
    stderr.error(chalk.red(result.error ?? result.status?.error ?? 'Failed to start TTS daemon'));
  }
  if (result.status) stdout.log(formatTtsDaemonStatus(result.status));
  return result;
}

export async function runTtsDaemonForegroundCommand(deps: TtsDaemonCommandDeps = {}): Promise<number> {
  const config = getTtsConfig(deps);
  const result = await runPromiseOrProgram((deps.runForeground ?? runTtsDaemonForeground)(config));
  if (result.signal) (deps.stderr ?? console).error(chalk.yellow(`TTS daemon exited from ${result.signal}`));
  return result.exitCode ?? (result.signal ? 1 : 0);
}

export async function runTtsDaemonStop(deps: TtsDaemonCommandDeps = {}): Promise<TtsDaemonStopResult> {
  const result = await runPromiseOrProgram((deps.stopDaemon ?? stopTtsDaemon)());
  const stdout = deps.stdout ?? console;
  const stderr = deps.stderr ?? console;
  if (result.stopped) stdout.log(chalk.green(`✓ Stopped TTS daemon${result.pid ? ` (pid ${result.pid})` : ''}`));
  else stderr.error(chalk.red(result.error ?? 'TTS daemon did not stop'));
  return result;
}

export async function runTtsDaemonRestart(
  options: { detach?: boolean; waitForHealth?: boolean; timeoutMs?: number } = {},
  deps: TtsDaemonCommandDeps = {},
): Promise<TtsDaemonStartResult> {
  await runTtsDaemonStop(deps);
  return runTtsDaemonStart(options, deps);
}

export async function runTtsInstallSystemd(deps: TtsDaemonCommandDeps = {}): Promise<string> {
  const unitPath = await runPromiseOrProgram((deps.installSystemdUnit ?? installTtsSystemdUnit)());
  (deps.stdout ?? console).log(chalk.green(`✓ Installed systemd user unit at ${unitPath}`));
  (deps.stdout ?? console).log('Enable it with: systemctl --user enable --now panopticon-qwen-tts.service');
  return unitPath;
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid timeout: ${value}`);
  return parsed;
}

export function registerTtsCommands(program: Command): void {
  const tts = program.command('tts').description('Local TTS daemon helpers');
  const voices = tts.command('voices').description('List and inspect saved TTS voices').action(async () => {
    await listTtsVoices();
  });

  tts
    .command('start')
    .description('Start the local Qwen TTS daemon')
    .option('--detach', 'Run the daemon detached in the background')
    .option('--foreground', 'Run the daemon in the foreground')
    .option('--no-wait-for-health', 'Return without waiting for /health')
    .option('--timeout-ms <ms>', 'Health wait timeout in milliseconds')
    .action(async (options: { detach?: boolean; foreground?: boolean; waitForHealth?: boolean; timeoutMs?: string }) => {
      if (options.foreground) {
        process.exitCode = await runTtsDaemonForegroundCommand();
        return;
      }
      const result = await runTtsDaemonStart({
        detach: true,
        waitForHealth: options.waitForHealth,
        timeoutMs: parseTimeoutMs(options.timeoutMs),
      });
      if (!result.ok) process.exitCode = 1;
    });

  tts
    .command('stop')
    .description('Stop the local Qwen TTS daemon')
    .action(async () => {
      const result = await runTtsDaemonStop();
      if (!result.stopped) process.exitCode = 1;
    });

  tts
    .command('status')
    .description('Show local Qwen TTS daemon status')
    .action(async () => {
      const status = await runTtsDaemonStatus();
      if (!status.ok) process.exitCode = status.running ? 2 : 1;
    });

  tts
    .command('restart')
    .description('Restart the local Qwen TTS daemon')
    .option('--no-wait-for-health', 'Return without waiting for /health')
    .option('--timeout-ms <ms>', 'Health wait timeout in milliseconds')
    .action(async (options: { waitForHealth?: boolean; timeoutMs?: string }) => {
      const result = await runTtsDaemonRestart({
        detach: true,
        waitForHealth: options.waitForHealth,
        timeoutMs: parseTimeoutMs(options.timeoutMs),
      });
      if (!result.ok) process.exitCode = 1;
    });

  tts
    .command('install-systemd')
    .description('Install a user systemd unit for the local Qwen TTS daemon')
    .action(async () => {
      await runTtsInstallSystemd();
    });

  tts
    .command('test [text]')
    .description('Speak a test phrase using the configured system (priority) voice')
    .option('--status', 'Use the status voice instead of the system (priority) voice')
    .action(async (text: string | undefined, options: { status?: boolean }) => {
      const result = await runTtsTest(text, { voiceKind: options.status ? 'status' : 'system' as TtsTestVoiceKind });
      if (!result.ok) process.exitCode = 1;
    });

  voices
    .command('list')
    .description('List saved TTS voices')
    .action(async () => {
      await listTtsVoices();
    });

  voices
    .command('show <name>')
    .description('Show saved TTS voice details')
    .action(async (name: string) => {
      const voice = await showTtsVoice(name);
      if (!voice) process.exitCode = 1;
    });

  voices
    .command('play <name> [text]')
    .description('Speak with a saved TTS voice')
    .action(async (name: string, text: string | undefined) => {
      const result = await playTtsVoice(name, text);
      if (!result?.ok) process.exitCode = 1;
    });

  voices
    .command('delete <name>')
    .description('Delete a saved TTS voice')
    .action(async (name: string) => {
      const deleted = await deleteTtsVoiceByName(name);
      if (!deleted) process.exitCode = 1;
    });

  voices
    .command('set-default <name>')
    .description('Set the system TTS voice')
    .action(async (name: string) => {
      const voice = await setDefaultTtsVoice(name);
      if (!voice) process.exitCode = 1;
    });

  voices
    .command('map <event> <name>')
    .description('Map a TTS event key to a saved voice')
    .action(async (event: string, name: string) => {
      const voice = await mapTtsVoice(event, name);
      if (!voice) process.exitCode = 1;
    });
}
