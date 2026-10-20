/**
 * Protocol fixture types and sanitization helpers for harness recording and replay (PAN-4563).
 */

export type ProtocolDirection = "outgoing" | "incoming";

export interface ProtocolFixtureFrame {
  readonly direction: ProtocolDirection;
  readonly message: unknown;
  readonly timestamp?: number;
}

export interface ProtocolFixture {
  readonly version: 1;
  readonly protocol: "codex-app-server" | "acp" | string;
  readonly recordedAt?: string;
  readonly frames: readonly ProtocolFixtureFrame[];
}

export interface ScrubOptions {
  readonly workspacePath?: string;
  readonly customSensitiveKeys?: readonly string[];
}

const DEFAULT_SENSITIVE_KEY_PATTERN =
  /(?:token|secret|password|api[_-]?key|credential|cookie|authorization|bridge[_-]?token)/i;

/**
 * Recursively scrub sensitive paths and secrets from message payloads.
 * Dev-only recording uses this to prevent committing host paths, API keys, or tokens.
 */
export function scrubSecretsAndPaths(
  value: unknown,
  options: ScrubOptions = {},
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return scrubString(value, options);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubSecretsAndPaths(item, options));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(record)) {
      if (typeof val === "object" && val !== null) {
        // Always recurse into objects and arrays
        result[key] = scrubSecretsAndPaths(val, options);
      } else if (isSensitiveKey(key, options.customSensitiveKeys)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = scrubSecretsAndPaths(val, options);
      }
    }

    return result;
  }

  return value;
}

function isSensitiveKey(key: string, customKeys?: readonly string[]): boolean {
  if (customKeys?.includes(key)) return true;
  if (key === "authMethodId" || key === "status" || key === "author")
    return false;
  if (key.toLowerCase() === "key" || key.toLowerCase().endsWith("key"))
    return true;
  return DEFAULT_SENSITIVE_KEY_PATTERN.test(key);
}

function scrubString(text: string, options: ScrubOptions): string {
  let result = text;

  // Scrub custom workspace path if provided
  if (options.workspacePath && options.workspacePath.length > 1) {
    result = result.split(options.workspacePath).join("/workspace");
  }

  // Scrub /Users/<user>/workspace or /home/<user>/workspace -> /workspace
  result = result.replace(
    /(?:\/Users|\/home)\/[a-zA-Z0-9._-]+\/workspace\b/g,
    "/workspace",
  );

  // Scrub standard user home directories: /Users/<user> or /home/<user>
  result = result.replace(/(?:\/Users|\/home)\/[a-zA-Z0-9._-]+/g, "/workspace");

  // Avoid duplicated /workspace/workspace
  result = result.replace(/\/workspace\/workspace\b/g, "/workspace");

  // Scrub /private/tmp to /tmp
  result = result.replace(/\/private\/tmp/g, "/tmp");

  // Scrub bearer tokens: Bearer <token>
  result = result.replace(
    /Bearer\s+[a-zA-Z0-9._~+/-]+=*/g,
    "Bearer [REDACTED]",
  );

  // Scrub long hex or uuid tokens in socket names: appserver-[uuid].sock
  result = result.replace(
    /appserver-[0-9a-fA-F-]+\.sock/g,
    "appserver-mock.sock",
  );

  return result;
}
