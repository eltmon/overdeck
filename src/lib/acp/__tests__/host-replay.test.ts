/**
 * PAN-4563 — replay-backed protocol tests for the ACP host (Kimi).
 *
 * Each case plays a fixture recorded from a live `kimi acp` (see
 * docs/PROTOCOL-REPLAY-TESTS.md) to the real effect-acp client,
 * AcpSessionRuntime, Kimi runtime factory, and AcpHost. Expected values come
 * from the fixture, never from literals, so a re-recording needs no test edits.
 *
 * Timers stay real: these fixtures never exercise session/load, whose
 * replay-idle gap is the only ACP delay. A fixture that does must fake timers.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROTOCOL_CAPTURE_FORMAT, type ProtocolFixture, type ProtocolFrame } from "../../protocol-capture/fixture.js";
import { startKimiReplay, type KimiReplay } from "./fixtures/replay-spawner.js";

const originalOverdeckHome = process.env.OVERDECK_HOME;
let overdeckHome: string;
let active: KimiReplay | undefined;

beforeEach(async () => {
  overdeckHome = await mkdtemp(join(tmpdir(), "pan-acp-replay-"));
  process.env.OVERDECK_HOME = overdeckHome;
});

afterEach(async () => {
  await active?.host.stop();
  active = undefined;
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  await rm(overdeckHome, { recursive: true, force: true });
});

async function start(fixture: string | ProtocolFixture): Promise<KimiReplay> {
  active = await startKimiReplay(fixture, { overdeckHome });
  return active;
}

function inlineFixture(messages: Array<["out" | "in", Record<string, unknown>]>): ProtocolFixture {
  return {
    header: {
      type: "header",
      format: PROTOCOL_CAPTURE_FORMAT,
      harness: "acp",
      provider: "kimi",
      cliVersion: "2.0.1",
      scenario: null,
      recordedAt: "2026-10-20T03:00:00.000Z",
      hostOptions: null,
      scrubbed: true,
    },
    frames: messages.map(([dir, message], seq): ProtocolFrame => ({ type: "frame", seq, dir, t: seq, message })),
  };
}

describe("kimi acp replay harness", () => {
  it("starts and stops the real host against an inline handshake fixture", async () => {
    const fixture = inlineFixture([
      ["out", { jsonrpc: "2.0", id: 0, method: "initialize", params: {} }],
      ["in", {
        jsonrpc: "2.0",
        id: 0,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods: [{ id: "login", name: "Login with Kimi account" }],
        },
      }],
      ["out", { jsonrpc: "2.0", id: 1, method: "authenticate", params: { methodId: "login" } }],
      ["in", { jsonrpc: "2.0", id: 1, result: {} }],
      ["out", { jsonrpc: "2.0", id: 2, method: "session/new", params: {} }],
      ["in", { jsonrpc: "2.0", id: 2, result: { sessionId: "session-replay" } }],
      // host.stop() cancels the session: an optional tail the replay never waits on.
      ["out", { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "session-replay" }, id: "", headers: [] }],
    ]);
    const { host, replay } = await start(fixture);
    await host.start();
    expect(host.status().state).toBe("ready");
    await replay.done;
    await host.stop();
    active = undefined;
    expect(replay.unmatchedClientLines()).toEqual([]);
  });
});
