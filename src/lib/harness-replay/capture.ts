/**
 * Dev-only protocol capture utilities for recording raw JSON-RPC frames to fixtures (PAN-4563).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppServerTransport } from "../codex/app-server-transport.js";
import {
  scrubSecretsAndPaths,
  type ProtocolDirection,
  type ProtocolFixture,
  type ProtocolFixtureFrame,
  type ScrubOptions,
} from "./fixture.js";

export interface ProtocolCaptureSession {
  record(direction: ProtocolDirection, message: unknown): void;
  save(): void;
  getFrames(): readonly ProtocolFixtureFrame[];
}

export function createCaptureSession(
  filePath: string,
  protocol: "codex-app-server" | "acp" | string,
  options: ScrubOptions = {},
): ProtocolCaptureSession {
  const frames: ProtocolFixtureFrame[] = [];
  let saved = false;

  const save = () => {
    if (saved || frames.length === 0) return;
    saved = true;
    const fixture: ProtocolFixture = {
      version: 1,
      protocol,
      recordedAt: new Date().toISOString(),
      frames,
    };
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(fixture, null, 2), "utf-8");
    } catch (error) {
      // Dev-only capture: warn without crashing process
      console.warn(
        `[harness-capture] Failed to save fixture to ${filePath}:`,
        error,
      );
    }
  };

  // Ensure fixture is persisted when process exits
  process.once("beforeExit", save);

  return {
    record(direction: ProtocolDirection, rawMessage: unknown) {
      const scrubbed = scrubSecretsAndPaths(rawMessage, options);
      frames.push({
        direction,
        message: scrubbed,
        timestamp: Date.now(),
      });
    },
    save,
    getFrames() {
      return [...frames];
    },
  };
}

/**
 * Wrap an AppServerTransport to record all outgoing and incoming JSON-RPC messages.
 */
export function wrapCodexTransportForCapture(
  transport: AppServerTransport,
  filePath: string,
  options: ScrubOptions = {},
): AppServerTransport {
  const session = createCaptureSession(filePath, "codex-app-server", options);

  let userMessageHandler: ((text: string) => void) | undefined;
  let userCloseHandler: ((reason: string) => void) | undefined;

  transport.onMessage((text) => {
    try {
      const parsed = JSON.parse(text);
      session.record("incoming", parsed);
    } catch {
      session.record("incoming", text);
    }
    userMessageHandler?.(text);
  });

  transport.onClose((reason) => {
    session.save();
    userCloseHandler?.(reason);
  });

  return {
    send(message) {
      session.record("outgoing", message);
      transport.send(message);
    },
    onMessage(handler) {
      userMessageHandler = handler;
    },
    onClose(handler) {
      userCloseHandler = handler;
    },
    close() {
      session.save();
      transport.close();
    },
  };
}
