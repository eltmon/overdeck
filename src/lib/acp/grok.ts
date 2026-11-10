import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  AcpSessionRuntime,
  layer as acpSessionRuntimeLayer,
  type AcpSessionRuntimeOptions,
  type AcpSpawnInput,
} from "./session-runtime.js";

export interface GrokAcpRuntimeInput extends Omit<AcpSessionRuntimeOptions, "authMethodId" | "spawn"> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly binaryPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

/** The ACP config option Grok Build exposes for reasoning effort (category thought_level). */
export const GROK_EFFORT_CONFIG_ID = "reasoning_effort";

const GROK_SIGN_IN_REQUIRED = "Grok sign-in is required. Run grok login, then retry.";

/**
 * `grok agent stdio` is Grok Build's persistent ACP agent. `--no-leader` keeps
 * one dedicated agent process per Overdeck agent even when the operator's
 * ~/.grok/config.toml enables leader mode; `--always-approve` covers Grok
 * subagents, whose permission asks never reach the ACP client.
 */
export function buildGrokAcpSpawnInput(
  settings: { readonly binaryPath?: string } | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  // An API key takes precedence over the browser sign-in in Grok Build, so an
  // inherited XAI_API_KEY would silently move the agent onto API billing.
  const env = { ...(environment ?? process.env) };
  delete env.XAI_API_KEY;
  return {
    command: settings?.binaryPath || "grok",
    args: ["agent", "--always-approve", "--no-leader", "stdio"],
    cwd,
    env,
  };
}

/** Grok Build 1.0.77 reads the credentials `grok login` saved in ~/.grok/auth.json. */
export function resolveGrokAuthMethodId(result: EffectAcpSchema.InitializeResponse): string {
  const method = result.authMethods?.find((candidate) => candidate.id === "cached_token");
  if (!method) throw new Error(GROK_SIGN_IN_REQUIRED);
  return method.id;
}

/** `grok/grok-4.6` → `grok-4.6`, the value `session/set_config_option configId=model` accepts. */
export function translateGrokAcpModelId(modelId: string): string {
  if (!/^grok\/[a-z0-9][a-z0-9.-]*$/.test(modelId)) {
    throw new Error(`Invalid Grok Build model "${modelId}". Select a grok/* model.`);
  }
  return modelId.slice("grok/".length);
}

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntime["Service"], EffectAcpErrors.AcpError, Crypto.Crypto | Scope.Scope> =>
  Effect.gen(function* () {
    const { childProcessSpawner, binaryPath, environment, ...runtimeOptions } = input;
    const context = yield* Layer.build(
      acpSessionRuntimeLayer({
        ...runtimeOptions,
        spawn: buildGrokAcpSpawnInput({ binaryPath }, input.cwd, environment),
        authMethodId: resolveGrokAuthMethodId,
      }).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner))),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(context));
  });
