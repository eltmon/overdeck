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

/**
 * Overdeck model ids → kimi-code session-config model values.
 *
 * The kimi-code ACP agent validates the "model" session config option against
 * its own registry ids (see `kimi provider list --json`), which carry the
 * managed-provider prefix:
 *
 *   kimi-code/k3                         K3, 1,048,576-token context
 *   kimi-code/k3-256k                    K3, 262,144-token context
 *   kimi-code/kimi-for-coding            K2.7 Coding, 262,144-token context
 *   kimi-code/kimi-for-coding-highspeed  K2.7 Coding Highspeed
 *
 * Overdeck's catalog ids (`k3` = 256K, `k3[1m]` = 1M — see
 * src/lib/model-capabilities.ts) must be translated at this boundary or the
 * session runtime rejects the spawn with
 * `Invalid value "k3[1m]" for session config option "model"`.
 */
const KIMI_ACP_MODEL_IDS: Record<string, string> = {
  "k3": "kimi-code/k3-256k",
  "k3[1m]": "kimi-code/k3",
  "kimi-k2.7-code": "kimi-code/kimi-for-coding",
  "kimi-for-coding": "kimi-code/kimi-for-coding",
};

/**
 * Translate an Overdeck model id to the kimi-code agent's model config value.
 * Unknown ids (including already-prefixed `kimi-code/...` values) pass through
 * unchanged so the session runtime's allowed-values validation fails loudly
 * instead of silently substituting a model the operator never chose.
 */
export function translateKimiAcpModelId(modelId: string): string {
  return KIMI_ACP_MODEL_IDS[modelId] ?? modelId;
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
