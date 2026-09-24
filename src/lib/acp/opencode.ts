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

export interface OpenCodeAcpRuntimeInput extends Omit<AcpSessionRuntimeOptions, "authMethodId" | "spawn"> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly binaryPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly port?: number;
}

export const OPENCODE_PRE_ALLOWED_PERMISSION = JSON.stringify({
  external_directory: "allow",
  doom_loop: "allow",
  read: { "*.env": "allow", "*.env.*": "allow" },
});

export function buildOpenCodeAcpSpawnInput(
  settings: { readonly binaryPath?: string } | null | undefined,
  cwd: string,
  port: number,
  environment?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  return {
    command: settings?.binaryPath || "opencode",
    args: ["acp", "--hostname", "127.0.0.1", "--port", String(port)],
    cwd,
    env: {
      ...environment,
      OPENCODE_PERMISSION: OPENCODE_PRE_ALLOWED_PERMISSION,
    },
  };
}

/** OpenCode 1.18.29 reads credentials saved by `opencode auth login`. */
export function resolveOpenCodeAuthMethodId(result: EffectAcpSchema.InitializeResponse): string {
  const method = result.authMethods?.find((candidate) => candidate.id === "opencode-login");
  if (!method) throw new Error("OpenCode did not advertise opencode-login authentication. Update OpenCode and run opencode auth login.");
  return method.id;
}

export function translateOpenCodeAcpModelId(modelId: string): string {
  if (!/^opencode(?:-go)?\/[^\s/]+$/.test(modelId)) {
    throw new Error(`Invalid OpenCode model "${modelId}". Select an opencode/* (Zen) or opencode-go/* model.`);
  }
  return modelId;
}

export const makeOpenCodeAcpRuntime = (
  input: OpenCodeAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntime["Service"], EffectAcpErrors.AcpError, Crypto.Crypto | Scope.Scope> =>
  Effect.gen(function* () {
    const { childProcessSpawner, binaryPath, environment, port, ...runtimeOptions } = input;
    if (port === undefined) {
      throw new Error("OpenCode ACP requires a reserved HTTP server port");
    }
    const context = yield* Layer.build(
      acpSessionRuntimeLayer({
        ...runtimeOptions,
        spawn: buildOpenCodeAcpSpawnInput({ binaryPath }, input.cwd, port, environment),
        authMethodId: resolveOpenCodeAuthMethodId,
      }).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner))),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(context));
  });
