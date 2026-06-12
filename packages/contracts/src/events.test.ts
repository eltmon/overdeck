import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { AgentContextSaturationChangedEvent, DomainEvent, OperatorInterventionEvent, SubstrateBugFiledEvent, SystemHeartbeatEvent } from "./events"
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
   