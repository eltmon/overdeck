/**
 * Pi-family launcher command (PAN-1989 omp, PAN-5212 pi), extracted from
 * launcher-generator.ts so that file can shrink. Like launcher-codex-command.ts
 * it takes a structural subset of the launcher config, so this module stays a
 * leaf and never imports back into the generator.
 */

import { dirname, join } from 'node:path';

import { shellQuoteModelId } from './model-validation.js';
import { provisionOhmypiProviderForModel } from './ohmypi-models.js';
import { provisionPiProviderForModel } from './pi-models.js';
import { qualifyPiModel } from './providers.js';
import { getPiFamilyProfile, type PiFamilyHarness } from './runtimes/pi-family.js';
import { shellQuote } from './shell-quote.js';

/** The launcher fields the pi-family command reads (a subset of LauncherConfig). */
export interface PiCommandConfig {
  harness?: string;
  piMode?: 'rpc' | 'tui';
  piSessionDir?: string;
  piEffort?: string;
  piExtensionPath?: string;
  piFifoPath?: string;
  model?: string;
  /** Context-layer files folded into the one --append-system-prompt value. */
  systemPromptFiles: readonly string[];
  promptFile?: string;
  promptInline?: string;
  resumeSessionId?: string;
  extraArgs?: string;
}

const PI_FAMILY_MODEL_PROVISIONERS: Record<PiFamilyHarness, (model: string) => void> = {
  pi: (model) => provisionPiProviderForModel(model),
  ohmypi: (model) => provisionOhmypiProviderForModel(model),
};

/**
 * Write the harness's user models.json entry for `model` before a launch
 * (PAN-3531 omp, PAN-5212 pi). pi and omp resolve --model against their
 * bundled catalog plus that registry; a missing model makes omp fail with
 * "No model selected" and makes pi silently bind another provider's model.
 */
export function provisionPiFamilyModel(harness: string | undefined, model: string): void {
  PI_FAMILY_MODEL_PROVISIONERS[getPiFamilyProfile(harness).harness](model);
}

/**
 * Build a pi-family command line: pi (PAN-5212) or oh-my-pi (omp, PAN-1989).
 * The binary, resume flag and fixed launch flags come from the harness's
 * {@link getPiFamilyProfile} profile (.pan/pi-vs-omp.md).
 *
 * RPC mode (work-agents):
 *   <pi|omp> --mode rpc \
 *      --model <model> \
 *      --session-dir <piSessionDir> \
 *      --extension <piExtensionPath> \
 *      [--no-approve] \
 *      [--session|--resume <resumeSessionId>] \
 *      [--append-system-prompt "$prompt"] \
 *      <> <piFifoPath> >> <agentDir>/output.log 2>&1
 *
 * TUI mode (conversations): the same without `--mode rpc` and the FIFO.
 *
 * - `--no-context-files` is never emitted: omp removed it, and pi keeps
 *   loading AGENTS.md/CLAUDE.md for parity.
 * - Resume: pi uses `--session <id>` (its `--resume` opens a picker); omp
 *   uses `--resume <id>` (its `--session` silently starts fresh).
 */
export function buildPiFamilyCommand(config: PiCommandConfig, useExec: boolean): string[] {
  const profile = getPiFamilyProfile(config.harness);
  const label = profile.harness;
  const piMode = config.piMode ?? 'rpc';
  if (!config.piSessionDir) {
    throw new Error(`${label} launcher requires piSessionDir`);
  }
  if (!config.piEffort) throw new Error(`${label} launcher requires piEffort`);
  if (piMode === 'rpc') {
    if (!config.piExtensionPath) {
      throw new Error(`${label} launcher (rpc mode) requires piExtensionPath`);
    }
    if (!config.piFifoPath) {
      throw new Error(`${label} launcher (rpc mode) requires piFifoPath`);
    }
  }

  const tokens: string[] = [profile.binary];
  if (piMode === 'rpc') {
    tokens.push('--mode', 'rpc');
  }
  tokens.push('--thinking', shellQuote(config.piEffort));
  if (config.model) {
    tokens.push('--model', shellQuoteModelId(qualifyPiModel(config.model, profile.harness)));
  }
  tokens.push('--session-dir', shellQuote(config.piSessionDir));
  if (config.piExtensionPath) {
    tokens.push('--extension', shellQuote(config.piExtensionPath));
  }
  tokens.push(...profile.launchArgs);

  // One append value carrying every layer: omp accepts only one (repeating
  // the flag loses earlier layers); pi accepts the joined value the same way.
  const promptSections = config.systemPromptFiles.map(file => `"$(cat -- ${shellQuote(file)})"`);
  if (config.promptFile) promptSections.push('"$prompt"');
  else if (config.promptInline) promptSections.push(shellQuote(config.promptInline));
  if (promptSections.length > 0) {
    tokens.push('--append-system-prompt', `"$(printf '%s\\n\\n' ${promptSections.join(' ')})"`);
  }

  if (config.resumeSessionId) {
    tokens.push(profile.resumeFlag, shellQuote(config.resumeSessionId));
  }
  if (config.extraArgs) {
    tokens.push(config.extraArgs);
  }
  let cmd = tokens.join(' ').replace(/\s+/g, ' ').trim();

  if (piMode === 'rpc') {
    // PAN-2108: capture the harness's exit so a silent post-startup death leaves a trace.
    // The launcher bash must OUTLIVE the harness to record the exit code + timestamp, so
    // the rpc path deliberately does NOT `exec` (exec would replace bash with the harness
    // and the exit would be lost — the failure mode that made the flywheel
    // orchestrator's death undiagnosable). `remain-on-exit on` keeps the dead
    // pane for `#{pane_exit_status}`; the exit-status file survives even if the
    // pane is later reaped. The deacon reads both on death detection.
    const agentDir = dirname(config.piFifoPath!);
    const outputLogPath = join(agentDir, 'output.log');
    const exitStatusPath = join(agentDir, 'exit-status');
    const runLine = `${cmd} <> ${shellQuote(config.piFifoPath!)} >> ${shellQuote(outputLogPath)} 2>&1`;
    return [
      runLine,
      '__omp_exit=$?',
      `printf '%s %s\\n' "$__omp_exit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${shellQuote(exitStatusPath)}`,
      'exit $__omp_exit',
    ];
  }

  return [useExec ? `exec ${cmd}` : cmd];
}
