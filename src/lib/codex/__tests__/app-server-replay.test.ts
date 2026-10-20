import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CodexAppServerManager,
  type AppServerMessage,
} from "../app-server-manager.js";
import { createCodexReplayTransport } from "../replay-transport.js";
import type { ProtocolFixture } from "../../harness-replay/fixture.js";

function loadFixture(name: string): ProtocolFixture {
  const filePath = join(__dirname, "../__fixtures__/replay", `${name}.json`);
  return JSON.parse(readFileSync(filePath, "utf-8")) as ProtocolFixture;
}

describe("Codex app-server replay integration tests (PAN-4563)", () => {
  it("case 1: idle status notification arriving before turn-completed does not end the turn early", async () => {
    const fixture = loadFixture("codex-idle-before-turn-completed");
    const transport = createCodexReplayTransport(fixture);
    const manager = new CodexAppServerManager({
      cwd: "/workspace",
      readVersion: async () => "0.153.4",
      transport,
    });

    let stateDuringIdleStatus: ReturnType<typeof manager.getState> | undefined;

    manager.on("notification", (msg: AppServerMessage) => {
      if (msg.method === "thread/status/changed") {
        // Record manager state when idle status notification arrives
        stateDuringIdleStatus = manager.getState();
      }
    });

    await manager.start();
    await manager.startThread({ model: "gpt-5-preview" });

    expect(manager.getState()).toEqual({
      state: "idle",
      threadId: "th-parent-101",
    });

    await manager.startTurn("Analyze the codebase");

    // Idle notification arrived during turn execution
    expect(stateDuringIdleStatus).toEqual({
      state: "running",
      threadId: "th-parent-101",
      activeTurnId: "turn-201",
    });

    // Final state after turn/completed arrived
    expect(manager.getState()).toEqual({
      state: "idle",
      threadId: "th-parent-101",
      activeTurnId: undefined,
    });

    manager.stop();
  });

  it("case 2: interrupt request returns first, followed by interrupted terminal state in separate event", async () => {
    const fixture = loadFixture("codex-interrupt-before-terminal");
    const transport = createCodexReplayTransport(fixture);
    const manager = new CodexAppServerManager({
      cwd: "/workspace",
      readVersion: async () => "0.153.4",
      transport,
    });

    let completedNotificationSeen = false;
    manager.on("notification", (msg: AppServerMessage) => {
      if (msg.method === "turn/completed") {
        completedNotificationSeen = true;
      }
    });

    await manager.start();
    await manager.startThread({ model: "gpt-5-preview" });
    await manager.startTurn("Start long operation");

    expect(manager.getState().state).toBe("running");
    expect(manager.getState().activeTurnId).toBe("turn-201");

    // Interrupt turn
    await manager.interruptTurn();

    expect(completedNotificationSeen).toBe(true);
    expect(manager.getState()).toEqual({
      state: "idle",
      threadId: "th-parent-101",
      activeTurnId: undefined,
    });

    manager.stop();
  });

  it("case 3: subagent child turn completion does not end parent's active turn", async () => {
    const fixture = loadFixture("codex-subagent-child-turn-completed");
    const transport = createCodexReplayTransport(fixture);
    const manager = new CodexAppServerManager({
      cwd: "/workspace",
      readVersion: async () => "0.153.4",
      transport,
    });

    const completedTurnThreads: string[] = [];
    const parentStateWhenChildCompleted: Array<
      ReturnType<typeof manager.getState>
    > = [];

    manager.on("notification", (msg: AppServerMessage) => {
      if (msg.method === "turn/completed") {
        const threadId = (msg.params as { threadId?: string })?.threadId ?? "";
        completedTurnThreads.push(threadId);
        if (threadId === "th-child-301") {
          parentStateWhenChildCompleted.push(manager.getState());
        }
      }
    });

    await manager.start();
    await manager.startThread({ model: "gpt-5-preview" });
    await manager.startTurn("Delegate task to subagent");

    expect(completedTurnThreads).toEqual(["th-child-301", "th-parent-101"]);
    // When the child turn completed, the parent turn MUST still have been running
    expect(parentStateWhenChildCompleted[0]).toEqual({
      state: "running",
      threadId: "th-parent-101",
      activeTurnId: "turn-parent-201",
    });

    // Parent turn completes afterwards
    expect(manager.getState()).toEqual({
      state: "idle",
      threadId: "th-parent-101",
      activeTurnId: undefined,
    });

    manager.stop();
  });

  it("case 4: provider-initiated mid-turn approval request is surfaced and resolved", async () => {
    const fixture = loadFixture("codex-midturn-approval-request");
    const transport = createCodexReplayTransport(fixture);
    const manager = new CodexAppServerManager({
      cwd: "/workspace",
      readVersion: async () => "0.153.4",
      transport,
    });

    const requests: AppServerMessage[] = [];
    manager.on("request", (msg: AppServerMessage) => {
      requests.push(msg);
      if (
        msg.id !== undefined &&
        msg.method === "item/command/requestApproval"
      ) {
        // Answer approval mid-turn
        manager.answerApproval(msg.id, "accept");
      }
    });

    await manager.start();
    await manager.startThread({ model: "gpt-5-preview" });
    await manager.startTurn("Run dangerous command");

    expect(requests).toHaveLength(1);
    expect(requests[0].id).toBe("req-approval-999");
    expect(requests[0].method).toBe("item/command/requestApproval");
    expect(requests[0].params).toMatchObject({
      threadId: "th-parent-101",
      turnId: "turn-201",
      command: "rm -rf /tmp/danger",
    });

    expect(manager.getState()).toEqual({
      state: "idle",
      threadId: "th-parent-101",
      activeTurnId: undefined,
    });

    manager.stop();
  });
});
