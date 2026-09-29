import { configuredHarnessBinaryPath, resolveHarnessBinary } from '../harness-binary.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { AuthMode } from '../subscription-types.js';
import { codexModelMinimumVersion, readCodexCliVersion } from './app-server-manager.js';

/** Host facts the pure harness policy cannot read itself (PAN-4363). */
export interface HarnessPolicyContext {
  /** Installed Codex CLI version; set only when a codex floor could apply. */
  codexCliVersion?: string;
}

export interface CodexPolicyContextDeps {
  resolveBinary?: () => Promise<string | null>;
  readVersion?: (binary: string) => Promise<string | undefined>;
}

function defaultResolveBinary(): Promise<string | null> {
  const executablePath = configuredHarnessBinaryPath('codex');
  return resolveHarnessBinary('codex', executablePath ? { executablePath } : undefined);
}

/**
 * Read the Codex CLI version only when the launch could hit a model floor:
 * codex harness, a model in CODEX_MODEL_MINIMUM_VERSIONS, ChatGPT sign-in.
 * Returns {} otherwise, and {} when the binary or version is unreadable.
 */
export async function resolveCodexPolicyContext(
  harness: RuntimeName,
  model: string,
  authMode: AuthMode | undefined,
  deps: CodexPolicyContextDeps = {},
): Promise<HarnessPolicyContext> {
  if (harness !== 'codex' || authMode !== 'subscription' || codexModelMinimumVersion(model) === undefined) {
    return {};
  }
  const resolveBinary = deps.resolveBinary ?? defaultResolveBinary;
  const readVersion = deps.readVersion ?? readCodexCliVersion;
  const binary = await resolveBinary();
  if (!binary) return {};
  const codexCliVersion = await readVersion(binary);
  return codexCliVersion === undefined ? {} : { codexCliVersion };
}
