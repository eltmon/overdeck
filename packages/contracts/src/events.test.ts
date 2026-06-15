import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { AgentContextSaturationChangedEvent, DomainEvent, OperatorInterventionEvent, SubstrateBugFiledEvent, SystemHeartbeatEvent } from "./events"
import { AgentSnapshot } from "./types"
import { INITIAL_READ_MODEL_STATE, applyEvent } from "./event-reducers"

const decodeAgentContextSaturationChangedEvent = Schema.decodeUnknownSync(AgentContextSaturationChangedEvent)
const decodeOperatorInterventionEvent = Schema.decodeUnknownSync(OperatorInterventionEvent)
const decodeSubstrateBugFiledEvent = Schema.decodeUnknownSync(SubstrateBugFiledEvent)
const encodeSubstrateBugFiledEvent = Schema.encodeSync(SubstrateBugFiledEvent)
const decodeSystemHeartbeatEvent = Schema.decodeUnknownSync(SystemHeartbeatEvent)
const decodeDomainEvent = Schema.decodeUnknownSync(DomainEvent)

const operatorInterventionKinds = [
  "tell",
  "pause",
  "restart",
  "manual_edit",
  "deep_wipe",
  "unpause",
  "untroubled",
] as const

function operatorInterventionEvent(kind: typeof operatorInterventionKinds[number]) {
  return {
    type: "operator.intervention",
    sequence: 1,
    timestamp: "2026-05-25T12:00:00.000Z",
    payload: {
      issueId: "PAN-1487",
      kind,
      source: "pan tell",
    },
  }
}

describe("AgentContextSaturationChangedEvent", () => {
  it("decodes set and clear events through DomainEvent", () => {
    const setEvent = {
      type: "agent.context_saturation_changed",
      sequence: 1,
      timestamp: "2026-06-05T12:00:00.000Z",
      payload: {
        agentId: "agent-pan-1615",
        contextSaturatedAt: "2026-06-05T12:00:00.000Z",
      },
    }
    const clearEvent = {
      type: "agent.context_saturation_changed",
      sequence: 2,
      timestamp: "2026-06-05T12:01:00.000Z",
      payload: {
        agentId: "agent-pan-1615",
      },
    }

    expect(decodeAgentContextSaturationChangedEvent(setEvent)).toEqual(setEvent)
    expect(decodeDomainEvent(setEvent)).toEqual(setEvent)
    expect(decodeAgentContextSaturationChangedEvent(clearEvent)).toEqual(clearEvent)
    expect(decodeDomainEvent(clearEvent)).toEqual(clearEvent)
  })
})

describe("SystemHeartbeatEvent", () => {
  it("decodes through DomainEvent and leaves the read model unchanged", () => {
    const event = {
      type: "system.heartbeat",
      timestamp: "2026-06-07T03:10:00.000Z",
      payload: { ts: 1780792200000 },
    }

    expect(decodeSystemHeartbeatEvent(event)).toEqual(event)
    const decoded = decodeDomainEvent(event)
    expect(decoded).toEqual(event)
    expect(applyEvent(INITIAL_READ_MODEL_STATE, decoded)).toBe(INITIAL_READ_MODEL_STATE)
  })
})

describe("OperatorInterventionEvent", () => {
  it.each(operatorInterventionKinds)("decodes %s interventions", (kind) => {
    const event = operatorInterventionEvent(kind)

    expect(decodeOperatorInterventionEvent(event)).toEqual(event)
    expect(decodeDomainEvent(event)).toEqual(event)
  })

  it("rejects unknown intervention kinds", () => {
    expect(() => decodeOperatorInterventionEvent({
      ...operatorInterventionEvent("tell"),
      payload: {
        ...operatorInterventionEvent("tell").payload,
        kind: "poke",
      },
    })).toThrow()
  })
})

describe("SubstrateBugFiledEvent", () => {
  it("decodes, encodes, and decodes through DomainEvent", () => {
    const event = {
      type: "substrate.bug_filed",
      sequence: 2,
      timestamp: "2026-05-25T12:30:00.000Z",
      payload: {
        issueId: "PAN-1487",
        runId: "RUN-123",
        filedBy: "agent",
        discoveredIn: "PAN-1486",
        severity: "P1",
      },
    }

    const decoded = decodeSubstrateBugFiledEvent(event)

    expect(decoded).toEqual(event)
    expect(encodeSubstrateBugFiledEvent(decoded)).toEqual(event)
    expect(decodeDomainEvent(event)).toEqual(event)
  })

  it("decodes when optional fields are missing", () => {
    const event = {
      type: "substrate.bug_filed",
      sequence: 3,
      timestamp: "2026-05-25T12:31:00.000Z",
      payload: {
        issueId: "PAN-1487",
        filedBy: "operator",
        severity: "P2",
      },
    }

    expect(decodeDomainEvent(event)).toEqual(event)
  })
})

import {
  AgentCreatedEvent,
  AgentStartedEvent,
  AgentStatusChangedEvent,
  AgentStoppedEvent,
  AgentHeartbeatDeadEvent,
} from "./events"

const decodeAgentCreatedEvent = Schema.decodeUnknownSync(AgentCreatedEvent)
const decodeAgentStartedEvent = Schema.decodeUnknownSync(AgentStartedEvent)
const decodeAgentStatusChangedEvent = Schema.decodeUnknownSync(AgentStatusChangedEvent)
const decodeAgentStoppedEvent = Schema.decodeUnknownSync(AgentStoppedEvent)
const decodeAgentHeartbeatDeadEvent = Schema.decodeUnknownSync(AgentHeartbeatDeadEvent)

function baseAgentSnapshot(overrides: Partial<typeof AgentSnapshot.Type> = {}): typeof AgentSnapshot.Type {
  return {
    id: "agent-pan-1908",
    issueId: "PAN-1908",
    status: "idle",
    ...overrides,
  } as typeof AgentSnapshot.Type
}

describe("Agent lifecycle events", () => {
  describe("agent.created", () => {
    it("decodes a full agent snapshot through DomainEvent", () => {
      const event = {
        type: "agent.created" as const,
        sequence: 1,
        timestamp: "2026-06-15T12:00:00.000Z",
        payload: {
          agentId: "agent-pan-1908",
          issueId: "PAN-1908",
          agent: baseAgentSnapshot({ status: "starting" }),
        },
      }

      expect(decodeAgentCreatedEvent(event)).toEqual(event)
      expect(decodeDomainEvent(event)).toEqual(event)
    })
  })

  describe("agent.started", () => {
    it("applies idempotently", () => {
      const agent = baseAgentSnapshot({ status: "running" })
      const event = {
        type: "agent.started" as const,
        sequence: 1,
        timestamp: "2026-06-15T12:00:00.000Z",
        payload: {
          agentId: "agent-pan-1908",
          issueId: "PAN-1908",
          agent,
        },
      }

      const decoded = decodeDomainEvent(event)
      const first = applyEvent(INITIAL_READ_MODEL_STATE, decoded)
      const second = applyEvent(first, decoded)

      expect(second.agentsById["agent-pan-1908"]).toEqual(agent)
      expect(second.agentsById["agent-pan-1908"]).toEqual(first.agentsById["agent-pan-1908"])
    })
  })

  describe("agent.status_changed", () => {
    it("decodes a partial payload and merges only present fields", () => {
      const event = {
        type: "agent.status_changed" as const,
        sequence: 2,
        timestamp: "2026-06-15T12:01:00.000Z",
        payload: {
          agentId: "agent-pan-1908",
          status: "running",
          hasLiveTmuxSession: true,
          pausedReason: null,
          costSoFar: 1.23,
        },
      }

      expect(decodeAgentStatusChangedEvent(event)).toEqual(event)
      expect(decodeDomainEvent(event)).toEqual(event)
    })

    it("preserves absent columns when applying a partial event", () => {
      const agent = baseAgentSnapshot({
        status: "idle",
        model: "claude-sonnet-4",
        workspace: "/tmp/ws",
        hasLiveTmuxSession: false,
        pausedReason: "paused-by-operator",
      })
      const started = applyEvent(INITIAL_READ_MODEL_STATE, decodeDomainEvent({
        type: "agent.started" as const,
        sequence: 1,
        timestamp: "2026-06-15T12:00:00.000Z",
        payload: { agentId: "agent-pan-1908", issueId: "PAN-1908", agent },
      }))

      const changed = applyEvent(started, decodeDomainEvent({
        type: "agent.status_changed" as const,
        sequence: 2,
        timestamp: "2026-06-15T12:01:00.000Z",
        payload: {
          agentId: "agent-pan-1908",
          status: "running",
          hasLiveTmuxSession: true,
        },
      }))

      expect(changed.agentsById["agent-pan-1908"].status).toBe("running")
      expect(changed.agentsById["agent-pan-1908"].hasLiveTmuxSession).toBe(true)
      expect(changed.agentsById["agent-pan-1908"].model).toBe("claude-sonnet-4")
      expect(changed.agentsById["agent-pan-1908"].workspace).toBe("/tmp/ws")
      expect(changed.agentsById["agent-pan-1908"].pausedReason).toBe("paused-by-operator")
    })

    it("is idempotent when replayed", () => {
      const agent = baseAgentSnapshot({ status: "running" })
      const started = applyEvent(INITIAL_READ_MODEL_STATE, decodeDomainEvent({
        type: "agent.started" as const,
        sequence: 1,
        timestamp: "2026-06-15T12:00:00.000Z",
        payload: { agentId: "agent-pan-1908", issueId: "PAN-1908", agent },
      }))
      const event = decodeDomainEvent({
        type: "agent.status_changed" as const,
        sequence: 2,
        timestamp: "2026-06-15T12:01:00.000Z",
        payload: {
          agentId: "agent-pan-1908",
          status: "paused",
          paused: true,
          pausedReason: "operator-request",
          pausedAt: "2026-06-15T12:01:00.000Z",
        },
      })

      const first = applyEvent(started, event)
      const second = applyEvent(first, event)

      expect(second.agentsById["agent-pan-1908"]).toEqual(first.agentsById["agent-pan-1908"])
    })
  })

  describe("agent.stopped", () => {
    it("removes the agent from the read model", () => {
      const agent = baseAgentSnapshot({ status: "running" })
      const started = applyEvent(INITIAL_READ_MODEL_STATE, decodeDomainEvent({
        type: "agent.started" as const,
        sequence: 1,
        timestamp: "2026-06-15T12:00:00.000Z",
        payload: { agentId: "agent-pan-1908", issueId: "PAN-1908", agent },
      }))
      const stopped = applyEvent(started, decodeDomainEvent({
        type: "agent.stopped" as const,
        sequence: 2,
        timestamp: "2026-06-15T12:02:00.000Z",
        payload: { agentId: "agent-pan-1908", issueId: "PAN-1908" },
      }))

      expect(stopped.agentsById["agent-pan-1908"]).toBeUndefined()
    })
  })

  describe("agent.heartbeat_dead", () => {
    it("decodes and transitions the agent to error status", () => {
      const agent = baseAgentSnapshot({ status: "running" })
      const started = applyEvent(INITIAL_READ_MODEL_STATE, decodeDomainEvent({
        type: "agent.started" as const,
        sequence: 1,
        timestamp: "2026-06-15T12:00:00.000Z",
        payload: { agentId: "agent-pan-1908", issueId: "PAN-1908", agent },
      }))
      const event = {
        type: "agent.heartbeat_dead" as const,
        sequence: 2,
        timestamp: "2026-06-15T12:03:00.000Z",
        payload: { agentId: "agent-pan-1908", issueId: "PAN-1908" },
      }

      expect(decodeAgentHeartbeatDeadEvent(event)).toEqual(event)
      const next = applyEvent(started, decodeDomainEvent(event))
      expect(next.agentsById["agent-pan-1908"].status).toBe("error")
    })
  })
})
