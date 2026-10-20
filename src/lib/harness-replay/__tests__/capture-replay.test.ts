import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubSecretsAndPaths, type ProtocolFixture } from "../fixture.js";
import {
  createCaptureSession,
  wrapCodexTransportForCapture,
} from "../capture.js";
import { ReplayEngine } from "../replay-engine.js";
import type { AppServerTransport } from "../../codex/app-server-transport.js";

describe("Harness capture and replay engine unit tests (PAN-4563)", () => {
  it("scrubSecretsAndPaths scrubs paths, tokens, and sensitive keys", () => {
    const input = {
      userDir: "/Users/testdev/repo/overdeck",
      tempFile: "/private/tmp/overdeck-123.sock",
      auth: {
        token: "secret-token-value",
        apiKey: "sk-1234567890abcdef",
        authMethodId: "token-based",
      },
      headers: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz",
      },
      safeArray: [{ path: "/home/ubuntu/project", secretKey: "value" }],
    };

    const scrubbed = scrubSecretsAndPaths(input, {
      workspacePath: "/Users/testdev/repo/overdeck",
    }) as typeof input;

    expect(scrubbed.userDir).toBe("/workspace");
    expect(scrubbed.tempFile).toBe("/tmp/overdeck-123.sock");
    expect(scrubbed.auth.token).toBe("[REDACTED]");
    expect(scrubbed.auth.apiKey).toBe("[REDACTED]");
    // authMethodId should be preserved as protocol identifier
    expect(scrubbed.auth.authMethodId).toBe("token-based");
    expect(scrubbed.headers.authorization).toBe("[REDACTED]");
    expect(scrubbed.safeArray[0].path).toBe("/workspace/project");
    expect(scrubbed.safeArray[0].secretKey).toBe("[REDACTED]");
  });

  it("createCaptureSession records frames and writes scrubbed fixture to file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "capture-test-"));
    const fixturePath = join(tmp, "captured.json");

    try {
      const session = createCaptureSession(fixturePath, "codex-app-server");
      session.record("outgoing", {
        id: 1,
        method: "initialize",
        params: { token: "super-secret" },
      });
      session.record("incoming", {
        id: 1,
        result: { path: "/Users/test/workspace" },
      });
      session.save();

      const written = JSON.parse(
        readFileSync(fixturePath, "utf-8"),
      ) as ProtocolFixture;
      expect(written.version).toBe(1);
      expect(written.protocol).toBe("codex-app-server");
      expect(written.frames).toHaveLength(2);
      expect(
        (written.frames[0].message as { params: { token: string } }).params
          .token,
      ).toBe("[REDACTED]");
      expect(
        (written.frames[1].message as { result: { path: string } }).result.path,
      ).toBe("/workspace");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("wrapCodexTransportForCapture wraps transport to capture incoming and outgoing frames", () => {
    const tmp = mkdtempSync(join(tmpdir(), "transport-capture-test-"));
    const fixturePath = join(tmp, "transport-fixture.json");

    try {
      let messageHandler: ((text: string) => void) | undefined;
      const sent: unknown[] = [];

      const rawTransport: AppServerTransport = {
        send(msg) {
          sent.push(msg);
        },
        onMessage(h) {
          messageHandler = h;
        },
        onClose() {},
        close() {},
      };

      const capturedTransport = wrapCodexTransportForCapture(
        rawTransport,
        fixturePath,
      );
      let received = "";
      capturedTransport.onMessage((msg) => {
        received = msg;
      });

      capturedTransport.send({ id: 1, method: "ping" });
      messageHandler?.(JSON.stringify({ id: 1, result: "pong" }));
      capturedTransport.close();

      expect(sent).toEqual([{ id: 1, method: "ping" }]);
      expect(received).toBe('{"id":1,"result":"pong"}');

      const fixture = JSON.parse(
        readFileSync(fixturePath, "utf-8"),
      ) as ProtocolFixture;
      expect(fixture.frames).toHaveLength(2);
      expect(fixture.frames[0].direction).toBe("outgoing");
      expect(fixture.frames[1].direction).toBe("incoming");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ReplayEngine maps request IDs between client and recorded fixture", () => {
    const fixture: ProtocolFixture = {
      version: 1,
      protocol: "test",
      frames: [
        { direction: "outgoing", message: { id: 100, method: "fetch" } },
        { direction: "incoming", message: { id: 100, result: { data: "ok" } } },
      ],
    };

    const incoming: unknown[] = [];
    const engine = new ReplayEngine(fixture, {
      onIncoming(msg) {
        incoming.push(msg);
      },
    });

    engine.start();
    // Client sends request with ID 42 (differs from recorded 100)
    engine.handleOutgoing({ id: 42, method: "fetch" });

    expect(incoming).toHaveLength(1);
    // Response ID should have been rewritten to 42 to match the client's request ID
    expect(incoming[0]).toEqual({ id: 42, result: { data: "ok" } });
    expect(engine.isFinished()).toBe(true);
  });
});
