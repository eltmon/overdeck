import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { DomainEvent, OperatorInterventionEvent } from "./events"

const decodeOperatorInterventionEvent = Schema.decodeUnknownSync(OperatorInterventionEvent)
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
