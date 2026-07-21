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

export interface KimiAcpSettings {
  readonly binaryPath?: string;
}

export interface KimiAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly kimiSettings?: KimiAcpSettings | null;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildKimiAcpSpawnInput(
  kimiSettings: KimiAcpSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  return {
    command: kimiSettings?.binaryPath || "kimi",
    args: ["acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

function authMethodSearchText(method: EffectAcpSchema.AuthMethod): string {
  return [method.id, method.name, method.description ?? ""].join(" ").toLowerCase();
}

export function resolveKimiAuthMethodId(
  initializeResult: EffectAcpSchema.InitializeResponse,
): string {
  const authMethods = initializeResult.authMethods ?? [];
  const cachedCredentialMethod = authMethods.find((method) => {
    const searchText = authMethodSearchText(method);
    return (
      searchText.includes("cached") ||
      searchText.includes("saved credential") ||
      searchText.includes("existing credential")
    );
  });
  if (cachedCredentialMethod) {
    return cachedCredentialMethod.id;
  }

  const kimiLoginMethod = authMethods.find((method) => {
    const searchText = authMethodSearchText(method);
    return (
      method.id.toLowerCase() === "login" ||
      searchText.includes("kimi account") ||
      searchText.includes("/login")
    );
  });
  if (kimiLoginMethod) {
    return kimiLoginMethod.id;
  }

  throw new Error(
    "Kimi ACP did not advertise a usable cached-credential authentication method. Run /login in Kimi Code CLI, then retry.",
  );
}

export const makeKimiAcpRuntime = (
  input: KimiAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const {
      childProcessSpawner,
      kimiSettings,
      environment,
      ...runtimeOptions
    } = input;
    const acpContext = yield* Layer.build(
      acpSessionRuntimeLayer({
        ...runtimeOptions,
        spawn: buildKimiAcpSpawnInput(kimiSettings, input.cwd, environment),
        authMethodId: resolveKimiAuthMethodId,
      }).pipe(
        Layer.provide(
          Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            childProcessSpawner,
          ),
        ),
      ),
    );

    return yield* Effect.service(AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });
