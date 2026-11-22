import { mkdir } from "node:fs/promises";

import { EFFORT_LEVELS } from "@overdeck/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  ANTIGRAVITY_AUTH_METHODS,
  ANTIGRAVITY_AUTH_REQUIRED,
  antigravityGeminiDir,
  type AntigravityAuthMethod,
  type AntigravityCredential,
} from "../antigravity-auth.js";
import {
  AcpSessionRuntime,
  layer as acpSessionRuntimeLayer,
  type AcpSessionRuntimeOptions,
  type AcpSpawnInput,
} from "./session-runtime.js";
import type { AcpTurnUsage } from "./transcript.js";

export { translateAntigravityModelId as translateAntigravityAcpModelId } from "../antigravity-models.js";

export interface AntigravityAcpRuntimeInput extends Omit<AcpSessionRuntimeOptions, "authMethodId" | "spawn"> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly binaryPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  /** Resolved by the ACP host's main() before the runtime is built (PAN-5587 D5); required at run time. */
  readonly credential?: AntigravityCredential;
  /** The isolated --gemini-dir; defaults to `<OVERDECK_HOME>/antigravity` (D6). */
  readonly geminiDir?: string;
}

/** The ACP config option `agy` exposes for reasoning effort (category thought_level). */
export const ANTIGRAVITY_EFFORT_CONFIG_ID = "thought_level";

/** Credential env vars the agy child must only ever get from the resolved credential. */
const INHERITED_CREDENTIAL_ENV = ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"] as const;

/**
 * `agy acp` is Antigravity's persistent ACP agent. `--gemini-dir` isolates it from
 * the operator's ~/.gemini (Gemini CLI OAuth credentials, `selectedType: oauth-personal`,
 * agy MCP servers, hooks and skills), so it can only use the credential Overdeck hands it.
 * Tool calls arrive as `session/request_permission`, so no skip-permissions flag is passed.
 */
export function buildAntigravityAcpSpawnInput(
  settings: { readonly binaryPath?: string; readonly geminiDir?: string } | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  credential?: AntigravityCredential,
): AcpSpawnInput {
  const env = { ...(environment ?? process.env) };
  for (const name of INHERITED_CREDENTIAL_ENV) delete env[name];
  Object.assign(env, credential?.env ?? {});
  return {
    command: settings?.binaryPath || "agy",
    args: ["acp", "--gemini-dir", settings?.geminiDir ?? antigravityGeminiDir()],
    cwd,
    env,
  };
}

/**
 * Select the credential's auth method, and only when agy advertises it. Never
 * inspects or returns an OAuth method id (PAN-5587 D3).
 */
export function resolveAntigravityAuthMethodId(
  result: EffectAcpSchema.InitializeResponse,
  method: AntigravityAuthMethod,
): string {
  const offered = ANTIGRAVITY_AUTH_METHODS.includes(method)
    && (result.authMethods ?? []).some((candidate) => candidate.id === method);
  if (!offered) throw new Error(`Antigravity CLI does not offer ${method} auth. ${ANTIGRAVITY_AUTH_REQUIRED}`);
  return method;
}

/**
 * Map an Overdeck effort level onto the thought levels the current model offers
 * (PAN-5587 D11): the requested level if offered; else the highest offered level
 * ranked below it; else the lowest offered level.
 */
export function clampAntigravityThoughtLevel(effort: string, offered: readonly string[]): string {
  const rank = (level: string): number => (EFFORT_LEVELS as readonly string[]).indexOf(level);
  const levels = offered.filter((level) => rank(level) >= 0).sort((a, b) => rank(a) - rank(b));
  if (levels.length === 0) throw new Error("Antigravity offered no thought levels.");
  if (levels.includes(effort)) return effort;
  const requested = rank(effort);
  const below = levels.filter((level) => rank(level) < requested);
  return below.length > 0 ? below[below.length - 1]! : levels[0]!;
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * agy reports ACP-standard turn usage on the `session/prompt` result (PAN-5587 D12).
 * `inputTokens` already excludes cache reads and `outputTokens` already includes
 * thought tokens. agy reports no model id and no cost, so the model is the Overdeck
 * id the host launched with, and pricing happens at reconcile time.
 */
export function extractAntigravityTurnUsage(
  response: EffectAcpSchema.PromptResponse,
  model: string,
): AcpTurnUsage | undefined {
  const raw = (response.usage ?? undefined) as Record<string, unknown> | undefined;
  if (!raw) return undefined;
  const input = finiteNumber(raw.inputTokens);
  const output = finiteNumber(raw.outputTokens);
  if (input === undefined || output === undefined) return undefined;
  const reasoning = finiteNumber(raw.thoughtTokens);
  return {
    model,
    source: "antigravity",
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: finiteNumber(raw.cachedReadTokens) ?? 0,
    cacheWriteTokens: finiteNumber(raw.cachedWriteTokens) ?? 0,
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  };
}

export const makeAntigravityAcpRuntime = (
  input: AntigravityAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntime["Service"], EffectAcpErrors.AcpError, Crypto.Crypto | Scope.Scope> =>
  Effect.gen(function* () {
    const { childProcessSpawner, binaryPath, environment, credential, geminiDir: requestedGeminiDir, ...runtimeOptions } = input;
    // The factory never resolves credentials itself (D5).
    if (!credential) return yield* Effect.die(new Error(ANTIGRAVITY_AUTH_REQUIRED));
    const geminiDir = requestedGeminiDir ?? antigravityGeminiDir();
    yield* Effect.promise(() => mkdir(geminiDir, { recursive: true, mode: 0o700 }));
    const context = yield* Layer.build(
      acpSessionRuntimeLayer({
        ...runtimeOptions,
        spawn: buildAntigravityAcpSpawnInput({ binaryPath, geminiDir }, input.cwd, environment, credential),
        authMethodId: (result) => resolveAntigravityAuthMethodId(result, credential.method),
      }).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner))),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(context));
  });
