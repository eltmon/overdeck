import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, type NormalizedTtsDaemonConfig } from '../../lib/config-yaml.js';
import { findVoiceById, findVoiceByName, loadVoices, type TtsVoice } from '../../lib/tts-voices.js';

export const DEFAULT_TTS_TEST_TEXT = 'The quick brown fox jumps over the lazy dog. Panopticon dashboard is now online.';

export interface TtsSpeakPayload {
  text: string;
  voice: string;
  instruct: string;
  volume: number;
  mode?: string;
  embedding?: number[];
}

export interface RunTtsTestDeps {
  config?: NormalizedTtsDaemonConfig;
  findVoiceById?: (id: string) => Promise<TtsVoice | undefined>;
  fetch?: typeof fetch;
  stdout?: Pick<typeof console, 'log'>;
  stderr?: Pick<typeof console, 'error'>;
}

export interface TtsVoiceCommandDeps {
  loadVoices?: () => Promise<TtsVoice[]>;
  findVoiceByName?: (name: string) => Promise<TtsVoice | undefined>;
  stdout?: Pick<typeof console, 'log'>;
  stderr?: Pick<typeof console, 'error'>;
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
  const voices = await (deps.loadVoices ?? loadVoices)();
  const stdout = deps.stdout ?? console;
  if (voices.length === 0) {
    stdout.log('No voices saved yet');
  } else {
    stdout.log(formatVoicesTable(voices));
  }
  return voices;
}

export async function showTtsVoice(name: string, deps: TtsVoiceCommandDeps = {}): Promise<TtsVoice | undefined> {
  const voice = await (deps.findVoiceByName ?? findVoiceByName)(name);
  const stdout = deps.stdout ?? console;
  const stderr = deps.stderr ?? console;
  if (!voice) {
    stderr.error(chalk.red(`Voice not found: ${name}`));
    return undefined;
  }
  stdout.log(formatVoiceDetails(voice));
  return voice;
}

export function buildTtsSpeakPayload(voice: TtsVoice, text: string, config: NormalizedTtsDaemonConfig): TtsSpeakPayload {
  if (voice.kind === 'design') {
    return {
      text,
      voice: voice.description || voice.name,
      instruct: voice.instruct || '',
      volume: config.volume,
      mode: 'design',
    };
  }

  if (voice.kind === 'clone') {
    return {
      text,
      voice: voice.name,
      instruct: voice.instruct || '',
      volume: config.volume,
      mode: 'clone',
      embedding: voice.embedding,
    };
  }

  return {
    text,
    voice: voice.presetName || voice.name,
    instruct: voice.instruct || '',
    volume: config.volume,
  };
}

export async function runTtsTest(text: string | undefined, deps: RunTtsTestDeps = {}): Promise<TtsTestResult> {
  const config = deps.config ?? loadConfig().config.tts;
  const voiceId = config.voice.trim();
  const stdout = deps.stdout ?? console;
  const stderr = deps.stderr ?? console;

  if (!voiceId) {
    const message = 'No system voice set — use pan tts voices set-default <name>';
    stderr.error(chalk.yellow(message));
    return { ok: false, reason: 'no-voice', message };
  }

  const voice = await (deps.findVoiceById ?? findVoiceById)(voiceId);
  if (!voice) {
    const message = `Configured system voice not found: ${voiceId}`;
    stderr.error(chalk.red(message));
    return { ok: false, reason: 'voice-not-found', message };
  }

  const url = `http://${config.daemonHost}:${config.daemonPort}/speak`;
  const payload = buildTtsSpeakPayload(voice, text?.trim() || DEFAULT_TTS_TEST_TEXT, config);

  try {
    const response = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

export function registerTtsCommands(program: Command): void {
  const tts = program.command('tts').description('Local TTS daemon helpers');
  const voices = tts.command('voices').description('List and inspect saved TTS voices').action(async () => {
    await listTtsVoices();
  });

  tts
    .command('test [text]')
    .description('Speak a test phrase using the configured system voice')
    .action(async (text: string | undefined) => {
      const result = await runTtsTest(text);
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
}
