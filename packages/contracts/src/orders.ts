import { Schema } from "effect"

export const OrderBookLane = Schema.Literals(["A", "B"])
export type OrderBookLane = typeof OrderBookLane.Type

export const OrderBookStatus = Schema.Literals([
  "draft",
  "ready",
  "running",
  "drained",
  "complete",
])
export type OrderBookStatus = typeof OrderBookStatus.Type

export const OrderBookPosture = Schema.Literals(["open", "drain"])
export type OrderBookPosture = typeof OrderBookPosture.Type

export interface OrderBookItem {
  issue: string
  lane: OrderBookLane
  order: number
  prereqs: ReadonlyArray<string>
  reVerify: boolean
  planAtPickup?: boolean | undefined
  addedAt: string
  addedBy: string
}

export const OrderBookItem = Schema.Struct({
  issue: Schema.String,
  lane: OrderBookLane,
  order: Schema.Number,
  prereqs: Schema.Array(Schema.String),
  reVerify: Schema.Boolean,
  planAtPickup: Schema.optional(Schema.Boolean),
  addedAt: Schema.String,
  addedBy: Schema.String,
})

export interface OrderBookSettings {
  laneAConcurrency: number
  briefOverlay?: string | undefined
  posture: OrderBookPosture
  postureSetAt?: string | undefined
  postureSetBy?: string | undefined
  postureReason?: string | undefined
}

export const OrderBookSettings = Schema.Struct({
  laneAConcurrency: Schema.Number,
  briefOverlay: Schema.optional(Schema.String),
  posture: OrderBookPosture,
  postureSetAt: Schema.optional(Schema.String),
  postureSetBy: Schema.optional(Schema.String),
  postureReason: Schema.optional(Schema.String),
})

export interface OrderBook {
  id: string
  name: string
  status: OrderBookStatus
  settings: OrderBookSettings
  items: ReadonlyArray<OrderBookItem>
  runId?: string | undefined
  createdAt: string
  updatedAt: string
}

export const OrderBook = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: OrderBookStatus,
  settings: OrderBookSettings,
  items: Schema.Array(OrderBookItem),
  runId: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export interface OrderBookIndexEntry {
  id: string
  name: string
  status: OrderBookStatus
  runId?: string | undefined
  updatedAt: string
}

export const OrderBookIndexEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: OrderBookStatus,
  runId: Schema.optional(Schema.String),
  updatedAt: Schema.String,
})
