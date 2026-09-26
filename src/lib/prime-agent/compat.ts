/**
 * Prime Agent compatibility pin (PAN-3668 D14, FR-25). The host launcher and
 * `pan doctor` both refuse a Prime version outside this range, naming the found
 * version and the range. There is no silent fallback to another harness.
 *
 * Bumping support: update this range, re-run the WI-23 live verification, and
 * record the new version in docs/PRIME-AGENT-HARNESS.md.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PRIME_AGENT_SUPPORTED_RANGE = { min: '0.8.0', maxExclusive: '0.9.0' } as const;

/** `prime-agent status --json` → `protocolVersion` for the pinned range. */
export const PRIME_AGENT_PROTOCOL_VERSION = 7;

export const PRIME_AGENT_INSTALL_COMMAND = 'npm install -g prime-agent@0.8';

/** Levels `--thinking` and `set_thinking_level` accept. Overdeck effort values map 1:1. */
export const PRIME_AGENT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const PRIME_AGENT_SUPPORTED_RANGE_LABEL = `${PRIME_AGENT_SUPPORTED_RANGE.min} – <${PRIME_AGENT_SUPPORTED_RANGE.maxExclusive}`;

type Triple = readonly [number, number, number];

function parseTriple(version: string): Triple | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(a: Triple, b: Triple): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

/**
 * Output of `<binary> --version`. Prime 0.8.0 prints its version on stderr, not stdout,
 * so both streams are returned.
 */
export async function readPrimeAgentVersionOutput(binary: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(binary, ['--version'], { timeout: 15_000 });
  return `${stdout}\n${stderr}`;
}

/** The first `x.y.z` token in `prime-agent --version` output, or null. */
export function parsePrimeAgentVersion(output: string): string | null {
  return /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(output)?.[1] ?? null;
}

export type PrimeAgentVersionCheck =
  | { ok: true; version: string }
  | { ok: false; version: string | null; message: string };

/** Check `prime-agent --version` output against PRIME_AGENT_SUPPORTED_RANGE. */
export function checkPrimeAgentVersion(output: string): PrimeAgentVersionCheck {
  const version = parsePrimeAgentVersion(output);
  const parsed = version ? parseTriple(version) : null;
  if (!version || !parsed) {
    return {
      ok: false,
      version: null,
      message: `Could not read the Prime Agent version from \`prime-agent --version\`. Overdeck supports ${PRIME_AGENT_SUPPORTED_RANGE_LABEL}; install it with \`${PRIME_AGENT_INSTALL_COMMAND}\`.`,
    };
  }
  const min = parseTriple(PRIME_AGENT_SUPPORTED_RANGE.min)!;
  const maxExclusive = parseTriple(PRIME_AGENT_SUPPORTED_RANGE.maxExclusive)!;
  if (compare(parsed, min) < 0 || compare(parsed, maxExclusive) >= 0) {
    return {
      ok: false,
      version,
      message: `Prime Agent ${version} is outside the supported range ${PRIME_AGENT_SUPPORTED_RANGE_LABEL}. Install a supported version with \`${PRIME_AGENT_INSTALL_COMMAND}\`, then launch again.`,
    };
  }
  return { ok: true, version };
}
