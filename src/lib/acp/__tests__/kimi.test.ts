import { describe, expect, it, vi } from "vitest";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  buildKimiAcpSpawnInput,
  resolveKimiAuthMethodId,
  translateKimiAcpModelId,
} from "../kimi.js";
import { resolveAcpModelId, resolveAcpProviderSupport } from "../providers.js";
import {
  checkSystemPrerequisites,
  PREREQUISITES,
} from "../../system-prerequisites.js";

function initializeResult(
  authMethods: ReadonlyArray<EffectAcpSchema.AuthMethod>,
): EffectAcpSchema.InitializeResponse {
  return {
    protocolVersion: 1,
    authMethods,
  };
}

describe("Kimi ACP support", () => {
  it("builds the default kimi acp spawn input", () => {
    const env = { KIMI_TEST: "1" };

    expect(buildKimiAcpSpawnInput(undefined, "/workspace", env)).toEqual({
      command: "kimi",
      args: ["acp"],
      cwd: "/workspace",
      env,
    });
  });

  it("uses the configured Kimi binary path", () => {
    expect(
      buildKimiAcpSpawnInput(
        { binaryPath: "/opt/kimi/bin/kimi" },
        "/workspace",
      ),
    ).toEqual({
      command: "/opt/kimi/bin/kimi",
      args: ["acp"],
      cwd: "/workspace",
    });
  });

  it("prefers an advertised cached-credential authentication method", () => {
    const result = initializeResult([
      {
        id: "login",
        name: "Login with Kimi account",
        type: "terminal",
        args: ["login"],
      },
      {
        id: "cached-oauth",
        name: "Use cached credentials",
        description: "Reuse credentials stored by a prior /login.",
      },
    ]);

    expect(resolveKimiAuthMethodId(result)).toBe("cached-oauth");
  });

  it("uses Kimi's advertised login method for cached account state", () => {
    const result = initializeResult([
      {
        id: "login",
        name: "Login with Kimi account",
        description: "Run kimi login, then reuse the saved account.",
        type: "terminal",
        args: ["login"],
      },
    ]);

    expect(resolveKimiAuthMethodId(result)).toBe("login");
  });

  it("explains how to establish Kimi credentials when no usable method is advertised", () => {
    expect(() =>
      resolveKimiAuthMethodId(
        initializeResult([
          {
            id: "api-key",
            name: "API key",
            type: "env_var",
            vars: [{ name: "KIMI_API_KEY" }],
          },
        ]),
      ),
    ).toThrow(/kimi.*\/login/i);
  });
});

describe("Kimi ACP model translation", () => {
  it.each([
    ["k3", "kimi-code/k3-256k"],
    ["k3[1m]", "kimi-code/k3"],
    ["kimi-k2.7-code", "kimi-code/kimi-for-coding"],
    ["kimi-for-coding", "kimi-code/kimi-for-coding"],
  ])("maps Overdeck id %s to %s", (overdeckId, kimiCodeId) => {
    expect(translateKimiAcpModelId(overdeckId)).toBe(kimiCodeId);
  });

  it("passes already-prefixed and unknown ids through unchanged", () => {
    expect(translateKimiAcpModelId("kimi-code/k3")).toBe("kimi-code/k3");
    expect(translateKimiAcpModelId("kimi-code/kimi-for-coding-highspeed"))
      .toBe("kimi-code/kimi-for-coding-highspeed");
    expect(translateKimiAcpModelId("kimi-k2.6")).toBe("kimi-k2.6");
  });

  it("routes through resolveAcpModelId for the kimi provider and passes through otherwise", () => {
    expect(resolveAcpModelId("kimi", "k3[1m]")).toBe("kimi-code/k3");
    expect(resolveAcpModelId("not-a-provider", "k3[1m]")).toBe("k3[1m]");
  });
});

describe("ACP provider registry", () => {
  it("resolves the Kimi support module", () => {
    const support = resolveAcpProviderSupport("kimi");

    expect(support.buildSpawnInput).toBe(buildKimiAcpSpawnInput);
    expect(support.resolveAuthMethodId).toBe(resolveKimiAuthMethodId);
    expect(support.translateModelId).toBe(translateKimiAcpModelId);
  });

  it("lists supported providers when the provider is unknown", () => {
    expect(() => resolveAcpProviderSupport("unknown")).toThrow(
      /unknown ACP provider.*supported providers: kimi/i,
    );
  });
});

describe("Kimi prerequisite", () => {
  it("probes kimi --version as an optional prerequisite", async () => {
    const probe = vi.fn(async (command: string) => `${command} 1.49.0`);
    const resolver = vi.fn(async (command: string) => command);
    const report = await checkSystemPrerequisites(probe, resolver);
    const kimi = report.checks.find((check) => check.id === "kimi");

    expect(kimi).toMatchObject({
      found: true,
      required: false,
      version: "kimi 1.49.0",
    });
    expect(resolver).toHaveBeenCalledWith("kimi", { acpHarness: true });
    expect(probe).toHaveBeenCalledWith("kimi", ["--version"]);
    expect(PREREQUISITES.find((definition) => definition.id === "kimi")?.install.linux)
      .toContain("kimi-code-cli");
  });

  it("reports a missing kimi binary without failing required prerequisites", async () => {
    const resolver = vi.fn(async (command: string) => command === "kimi" ? null : command);
    const report = await checkSystemPrerequisites(
      async (command) => `${command} 1.0.0`,
      resolver,
    );

    expect(report.checks.find((check) => check.id === "kimi")).toMatchObject({
      found: false,
      required: false,
      version: null,
    });
    expect(resolver).toHaveBeenCalledWith("kimi", { acpHarness: true });
    expect(report.allRequiredFound).toBe(true);
  });
});
