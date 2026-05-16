import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, type NormalizedTtsDaemonConfig } from '../../lib/config-yaml.js';
import { findVoiceById, type TtsVoice } from '../../lib/tts-voices.js';

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

export type TtsTestResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'no-voice' | 'voice-not-found' | 'daemon-unavailable' | 'daemon-error'; message: string };

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

  tts
    .command('test [text]')
    .description('Speak a test phrase using the configured system voice')
    .action(async (text: string | undefined) => {
      const result = await runTtsTest(text);
      if (!result.ok) process.exitCode = 1;
    });
}
