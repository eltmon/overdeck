import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  FlywheelStatus,
  OrderBook,
  type OrderBookItem,
} from "../index"

const decodeOrderBook = Schema.decodeUnknownSync(OrderBook)
const encodeOrderBook = Schema.encodeSync(OrderBook)
const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus)

const validBook = {
  id: "2026-07-17-special-orders",
  name: "Special orders",
  status: "running",
  settings: {
    laneAConcurrency: 3,
    briefOverlay: "Prioritize the operator-supplied campaign.",
    posture: "open",
  },
  items: [
    {
      issue: "PAN-2377",
      lane: "A",
      order: 1,
      prereqs: [],
      reVerify: true,
      addedAt: "2026-07-17T12:00:00.000Z",
      addedBy: "operator",
    },
    {
      issue: "PAN-2378",
      lane: "B",
      order: 2,
      prereqs: ["PAN-2377"],
      reVerify: false,
      planAtPickup: true,
      addedAt: "2026-07-17T12:01:00.000Z",
      addedBy: "operator",
    },
  ],
  runId: "RUN-65",
  createdAt: "2026-07-17T12:00:00.000Z",
  updatedAt: "2026-07-17T12:01:00.000Z",
} satisfies typeof OrderBook.Encoded

const validFlywheelStatus = {
  runId: "RUN-65",
  startedAt: "2026-07-17T12:05:00.000Z",
  elapsedMs: 60000,
  orchestrator: {
    harness: "claude-code",
    model: "gpt-5.6",
    effort: "high",
    ctxPercent: 20,
  },
  headline: {
    bugsFixed: 0,
    swarmItemsMerged: 0,
    swarmItemsTotal: 2,
    prsMerged: 0,
    awaitingUat: 0,
  },
  activePipeline: [],
  substrateBugs: [],
  agents: [],
  parked: [],
  suggestions: [],
  system: {
    mainHead: "abc1234",
    ramUsedMb: 32000,
    ramTotalMb: 64000,
    swapUsedMb: 0,
    swapTotalMb: 8000,
    agentsActive: 1,
    agentsCap: 8,
  },
  openQuestions: [],
  ticks: 1,
  lastTickAt: "2026-07-17T12:06:00.000Z",
} satisfies typeof FlywheelStatus.Encoded

describe("OrderBook", () => {
  it("roundtrips a valid order book", () => {
    const parsed = decodeOrderBook(validBook)
    const reparsed = decodeOrderBook(encodeOrderBook(parsed))

    expect(reparsed).toEqual(parsed)
  })

  it("exports item types through the contracts barrel", () => {
    const item: OrderBookItem = decodeOrderBook(validBook).items[0]!

    expect(item.issue).toBe("PAN-2377")
  })

  it("rejects unknown lanes", () => {
    const invalidBook = {
      ...validBook,
      items: [{ ...validBook.items[0], lane: "C" }],
    }

    expect(() => decodeOrderBook(invalidBook)).toThrow()
  })

  it("rejects items missing an issue", () => {
    const { issue: _issue, ...itemWithoutIssue } = validBook.items[0]
    const invalidBook = { ...validBook, items: [itemWithoutIssue] }

    expect(() => decodeOrderBook(invalidBook)).toThrow()
  })
})

describe("FlywheelStatus orders", () => {
  it("roundtrips with order progress", () => {
    const payload = {
      ...validFlywheelStatus,
      orders: {
        bookId: validBook.id,
        bookName: validBook.name,
        landed: 1,
        total: 2,
        laneAInFlight: ["PAN-2377"],
        laneBInFlight: "PAN-2378",
        drained: false,
      },
    }
    const parsed = decodeFlywheelStatus(payload)
    const reparsed = decodeFlywheelStatus(JSON.parse(JSON.stringify(parsed)))

    expect(reparsed).toEqual(parsed)
  })

  it("roundtrips status payloads without orders", () => {
    const parsed = decodeFlywheelStatus(validFlywheelStatus)
    const reparsed = decodeFlywheelStatus(JSON.parse(JSON.stringify(parsed)))

    expect(reparsed).toEqual(parsed)
    expect(reparsed.orders).toBeUndefined()
  })
})
