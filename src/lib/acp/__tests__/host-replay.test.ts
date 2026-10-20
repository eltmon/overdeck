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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { frameKind, PROTOCOL_CAPTURE_FORMAT, type ProtocolFixture, type ProtocolFrame } from "../../protocol-capture/fixture.js";
import { ACP_TRANSCRIPT_FILE } from "../../runtimes/storage/acp.js";
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Facts the ACP cases read from their fixture instead of hard-coding them. */
function promptFacts(fixture: ProtocolFixture) {
  const frames = fixture.frames;
  const promptIndex = frames.findIndex((frame) => frame.dir === "out" && frame.message?.method === "session/prompt");
  const promptId = frames[promptIndex]?.message?.id;
  const responseIndex = frames.findIndex((frame) =>
    frame.dir === "in" && frameKind(frame) === "response" && frame.message?.id === promptId);
  const update = (frame: ProtocolFrame) => record(record(frame.message?.params).update);
  const chunkText = (from: number, to: number) => frames.slice(from, to)
    .filter((frame) => frame.dir === "in" && frame.message?.method === "session/update" && update(frame).sessionUpdate === "agent_message_chunk")
    .map((frame) => String(record(update(frame).content).text ?? ""))
    .join("");
  return {
    frames,
    promptIndex,
    responseIndex,
    stopReason: record(frames[responseIndex]?.message?.result).stopReason,
    chunkText,
  };
}

interface TranscriptRecord {
  role: string;
  content: string;
  event?: string;
  stopReason?: string;
}

async function readTranscript(): Promise<TranscriptRecord[]> {
  const text = await readFile(join(overdeckHome, "agents", "agent-replay", ACP_TRANSCRIPT_FILE), "utf-8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as TranscriptRecord);
}

/** The lifecycle shape of a transcript: assistant runs collapse to one entry. */
function lifecycle(records: TranscriptRecord[]): string[] {
  const shape: string[] = [];
  for (const entry of records) {
    const label = entry.event ?? entry.role;
    if (label === "assistant" && shape[shape.length - 1] === "assistant") continue;
    shape.push(label);
  }
  return shape;
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

describe("kimi acp case: turn completion", () => {
  it("records the prompt lifecycle and the assistant text in order, ending on the recorded stop reason", async () => {
    const { host, replay } = await start("kimi-turn-completion");
    const facts = promptFacts(replay.fixture);
    expect(facts.responseIndex, "re-check the ACP turn-completion case: no session/prompt response recorded").toBeGreaterThan(facts.promptIndex);
    const recordedText = facts.chunkText(facts.promptIndex, facts.responseIndex);

    await host.start();
    expect(await host.handleOp({ op: "message", content: String(replay.fixture.header.hostOptions?.prompt) }))
      .toMatchObject({ status: 202 });
    await host.waitForIdle();

    const records = await readTranscript();
    expect(lifecycle(records)).toEqual(["prompt_queued", "user", "assistant", "turn_completed"]);
    expect(records.filter((entry) => entry.role === "assistant").map((entry) => entry.content).join("")).toBe(recordedText);
    expect(records.filter((entry) => entry.event === "turn_completed")).toEqual([
      expect.objectContaining({ stopReason: facts.stopReason }),
    ]);
    expect(records.some((entry) => entry.event === "prompt_failed")).toBe(false);

    await host.stop();
    active = undefined;
    await replay.done;
    expect(replay.unmatchedClientLines()).toEqual([]);
  });
});

describe("kimi acp case: interrupt", () => {
  it("ends the turn cancelled once, with no failure record", async () => {
    const { host, replay, lines } = await start("kimi-interrupt");
    const facts = promptFacts(replay.fixture);
    const promptSeq = facts.frames[facts.promptIndex]!.seq;
    // The first client frame after the prompt is what the interrupt produces
    // (effect-rpc's interrupt for the prompt request, then session/cancel).
    const firstAfterPrompt = facts.frames.find((frame) => frame.dir === "out" && frame.seq > promptSeq);
    expect(firstAfterPrompt, "re-check the ACP interrupt case: no client frame after the prompt").toBeDefined();
    const cancelIndex = facts.frames.findIndex((frame) => frame.dir === "out" && frame.message?.method === "session/cancel");
    expect(cancelIndex, "re-check the ACP interrupt case: no session/cancel recorded").toBeGreaterThan(facts.promptIndex);

    await host.start();
    const awaitingInterrupt = replay.awaitingClient({ dir: "out", where: (frame) => frame.seq === firstAfterPrompt!.seq });
    expect(await host.handleOp({ op: "message", content: String(replay.fixture.header.hostOptions?.prompt) }))
      .toMatchObject({ status: 202 });
    await awaitingInterrupt;
    // The recorder interrupted on the first [assistant] pane line; do the same.
    await vi.waitFor(() => expect(lines.some((line) => line.startsWith("[assistant]"))).toBe(true), { timeout: 10_000 });
    expect(await host.handleOp({ op: "interrupt" })).toMatchObject({ status: 200 });
    await host.waitForIdle();
    await replay.done;
    // done means every frame was delivered, not that the host has written it yet.
    const assistantText = (entries: TranscriptRecord[]) => entries.filter((entry) => entry.role === "assistant").map((entry) => entry.content).join("");
    const visible = (text: string) => text.replace(/\s+/g, "");
    const recordedText = visible(facts.chunkText(facts.promptIndex, facts.frames.length));
    // Every visible chunk lands. The cancel closes the assistant segment, and
    // session-events.ts drops a whitespace-only chunk that would open a new one,
    // so whitespace is compared loosely.
    // Hundreds of late appends drain here; allow for a loaded CI host.
    await vi.waitFor(async () => expect(visible(assistantText(await readTranscript()))).toBe(recordedText), { timeout: 10_000 });

    const records = await readTranscript();
    const completed = records.filter((entry) => entry.event === "turn_completed");
    expect(completed).toEqual([expect.objectContaining({ stopReason: "cancelled" })]);
    expect(records.some((entry) => entry.event === "prompt_failed")).toBe(false);
    // PAN-4575: effect-acp sends session/cancel with "id":"", Kimi rejects it as an
    // unknown request and keeps streaming; the late chunks land after turn_completed.
    // Flip to "no assistant record after turn_completed" when fixed.
    const completedAt = records.findIndex((entry) => entry.event === "turn_completed");
    // Which chunks land after the boundary depends on delivery timing; pin that some do.
    expect(visible(assistantText(records.slice(completedAt + 1))).length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.startsWith("[error]"))).toEqual([]);

    await host.stop();
    active = undefined;
    expect(replay.unmatchedClientLines()).toEqual([]);
  });
});
