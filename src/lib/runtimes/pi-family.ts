/**
 * Pi-family launch profiles (PAN-5212).
 *
 * pi (the Pi Coding Agent, binary `pi`) and oh-my-pi (binary `omp`, PAN-1989)
 * share one launch kind (`ohmypi-rpc`), the rpc.in FIFO, the ready.json
 * extension handshake and the `<agentDir>/sessions` v3 JSONL layout. What
 * differs between them is data, kept here so callers look up a profile
 * instead of comparing harness names (PAN-4562). Each difference was verified
 * against pi 0.85.0 and omp 17.4.1 in .pan/pi-vs-omp.md.
 *
 * Leaf module: imports only node and paths.ts.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ohmypiExtensionCandidates, piExtensionCandidates, resolveOhmypiExtensionPath, resolvePiExtensionPath } from '../paths.js'

export type PiFamilyHarness = 'pi' | 'ohmypi'

export interface PiFamilyProfile {
  readonly harness: PiFamilyHarness
  /** CLI binary the launcher runs. */
  readonly binary: 'pi' | 'omp'
  /** Flag that reopens a stored session by id. pi's `--resume` is a picker, so pi resumes with `--session <id>`. */
  readonly resumeFlag: '--session' | '--resume'
  /**
   * Flags every launch carries. pi: `--no-approve`, so a project-trust dialog
   * (shown in TUI mode for `.pi/` or `.agents/skills` resources) never blocks
   * a conversation; RPC mode already ignores those resources.
   */
  readonly launchArgs: readonly string[]
  /** The harness's own agent dir, which holds its user `models.json`. */
  readonly userAgentDir: () => string
  /** Candidate paths of the Overdeck extension bundle, in resolution order. */
  readonly extensionCandidates: () => string[]
  /** First existing extension bundle, or null when none is built. */
  readonly resolveExtensionPath: () => string | null
  /** The launch checks omp's own openai-codex login before an OpenAI-model start. */
  readonly checksOmpCodexAuth: boolean
  /**
   * Overdeck provider → this harness's provider id, where it differs from the
   * shared map in `piProviderForModel` (providers.ts). pi: MiMo keys are
   * token-plan SGP keys, which pi serves as `xiaomi-token-plan-sgp`; Nous is a
   * custom `nous` provider that pi-models.ts provisions.
   */
  readonly providerOverrides: Readonly<Record<string, string>>
}

const PROFILES: Record<PiFamilyHarness, PiFamilyProfile> = {
  pi: {
    harness: 'pi',
    binary: 'pi',
    resumeFlag: '--session',
    launchArgs: ['--no-approve'],
    userAgentDir: () => process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent'),
    extensionCandidates: piExtensionCandidates,
    resolveExtensionPath: resolvePiExtensionPath,
    checksOmpCodexAuth: false,
    providerOverrides: { mimo: 'xiaomi-token-plan-sgp', nous: 'nous' },
  },
  ohmypi: {
    harness: 'ohmypi',
    binary: 'omp',
    resumeFlag: '--resume',
    launchArgs: [],
    userAgentDir: () => join(homedir(), '.omp', 'agent'),
    extensionCandidates: ohmypiExtensionCandidates,
    resolveExtensionPath: resolveOhmypiExtensionPath,
    checksOmpCodexAuth: true,
    providerOverrides: {},
  },
}

/**
 * The profile for a pi-family harness. Any other value gets the ohmypi
 * profile, which is what every pi-family launch used before PAN-5212.
 */
export function getPiFamilyProfile(harness: string | null | undefined): PiFamilyProfile {
  return harness && Object.hasOwn(PROFILES, harness) ? PROFILES[harness as PiFamilyHarness] : PROFILES.ohmypi
}
