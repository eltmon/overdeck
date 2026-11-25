// Derived flywheel status (PAN-3964 FR-1, FR-2).
//
// The flywheel is a conversation running the `pan-flywheel` loop skill. It has
// no run record: every field here is computed on read from the flywheel
// conversation's row and transcript, the pipeline journals of the project's
// feature workspaces, the control settings, and the running order book. The
// derivation lives in `src/lib/flywheel/derive-status.ts`; `pan flywheel
// status`, `GET /api/flywheel/status`, and the Flywheel page all consume it.

import { Schema } from "effect"

import { DerivedPrState, IssueAttention, IssueState } from "./derived-issue-state"

/** The loop's phases, as the skill reports them in its tick marker. */
export const TickMarkerPhase = Schema.Literals([
  "orient",
  "pick",
  "launch",
  "watch",
  "park",
  "idle",
  "stopping",
])
export type TickMarkerPhase = typeof TickMarkerPhase.Type

/**
 * One parsed tick marker line:
 * `flywheel-tick: tick=<n> pick=<ID|none> phase=<phase> in-flight=<ID,…|none> needs-you=<text|none>`.
 */
export const TickMarker = Schema.Struct({
  tick: Schema.Number,
  pick: Schema.NullOr(Schema.String),
  phase: TickMarkerPhase,
  inFlight: Schema.Array(Schema.String),
  needsYou: Schema.NullOr(Schema.String),
})
export type TickMarker = typeof TickMarker.Type

/** `running` = row + live session; `paused` = row, no live session; `idle` = no row. */
export const FlywheelRunState = Schema.Literals(["running", "paused", "idle"])
export type FlywheelRunState = typeof FlywheelRunState.Type

/** Age of the last tick: ≤ 60 s live, ≤ 20 min breathing, older stalled. */
export const FlywheelFreshness = Schema.Literals(["live", "breathing", "stalled"])
export type FlywheelFreshness = typeof FlywheelFreshness.Type

export const FlywheelConversationSummary = Schema.Struct({
  name: Schema.String,
  id: Schema.Number,
  title: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  harness: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  /** When the conversation row was created — the page's elapsed run time. */
  createdAt: Schema.String,
  sessionAlive: Schema.Boolean,
})
export type FlywheelConversationSummary = typeof FlywheelConversationSummary.Type

/**
 * One `;`-separated item of the newest tick's needs-you line (PAN-5198), with
 * the oldest tick of the item's current unbroken run: the message that raised
 * it, which is where the loop explained it.
 */
export const FlywheelNeedsYouItem = Schema.Struct({
  text: Schema.String,
  firstRaisedTick: Schema.Number,
  /** The first-raised tick message's `createdAt`. */
  firstRaisedAt: Schema.String,
  /** The first-raised tick message's id, when the harness records one. */
  firstRaisedMessageId: Schema.optional(Schema.String),
  /** The first-raised message's prose without its tick line (PAN-5283 D18). */
  context: Schema.optional(Schema.String),
})
export type FlywheelNeedsYouItem = typeof FlywheelNeedsYouItem.Type

const NEEDS_YOU_TARGET_RE = /^(.*?)\s*<(https?:\/\/[^\s<>]+)>\s*$/i

/**
 * An item's trailing `<https://…>` is its target (PAN-5239). Anything else in
 * angle brackets is plain text. The label is the item without its target.
 */
export function parseNeedsYouTarget(text: string): { label: string; target?: string } {
  const trimmed = text.trim()
  const match = NEEDS_YOU_TARGET_RE.exec(trimmed)
  const label = match?.[1]?.trim() ?? ""
  if (!match || !label) return { label: trimmed }
  return { label, target: match[2]! }
}

/** Two items are the same item when their keys match; the target is not part of it. */
export function needsYouItemKey(text: string): string {
  return parseNeedsYouTarget(text).label.toLowerCase()
}

/** Split a needs-you line on `;`: trimmed, empty pieces dropped, one per key. */
export function splitNeedsYouItems(needsYou: string | null | undefined): string[] {
  if (!needsYou) return []
  const seen = new Set<string>()
  const items: string[] = []
  for (const piece of needsYou.split(";")) {
    const text = piece.trim()
    const key = needsYouItemKey(text)
    if (!text || seen.has(key)) continue
    seen.add(key)
    items.push(text)
  }
  return items
}

export const FlywheelLastTick = Schema.Struct({
  tick: Schema.Number,
  pick: Schema.NullOr(Schema.String),
  phase: TickMarkerPhase,
  inFlight: Schema.Array(Schema.String),
  needsYou: Schema.NullOr(Schema.String),
  /** The assistant message's `createdAt`. */
  at: Schema.String,
  /** The assistant message's id, when the harness records one. */
  messageId: Schema.optional(Schema.String),
  /** The needs-you line split into items, each with its first-raised tick (PAN-5198). */
  needsYouItems: Schema.optional(Schema.Array(FlywheelNeedsYouItem)),
})
export type FlywheelLastTick = typeof FlywheelLastTick.Type

/**
 * The run before this one (PAN-5666): the newest retired `conv-flywheel~…`
 * conversation that wrote a tick marker. `pan flywheel start` retires the
 * previous row instead of deleting it, so its last tick, in-flight list and
 * open needs-you items survive a fresh start, a crash or a reboot.
 */
export const FlywheelPreviousRun = Schema.Struct({
  conversation: Schema.Struct({
    /** The retired name, `conv-flywheel~<id8>`. */
    name: Schema.String,
    id: Schema.Number,
    createdAt: Schema.String,
    endedAt: Schema.NullOr(Schema.String),
  }),
  lastTick: FlywheelLastTick,
  /** The last tick was `phase=stopping`: the run wrote its report and ended. */
  stoppedCleanly: Schema.Boolean,
})
export type FlywheelPreviousRun = typeof FlywheelPreviousRun.Type

export const FlywheelPolicies = Schema.Struct({
  auto_pickup_backlog: Schema.Boolean,
  require_uat_before_merge: Schema.Boolean,
  merge_train_enabled: Schema.Boolean,
})
export type FlywheelPolicies = typeof FlywheelPolicies.Type

export const FlywheelJournalSummary = Schema.Struct({
  at: Schema.String,
  type: Schema.String,
  source: Schema.optional(Schema.String),
})
export type FlywheelJournalSummary = typeof FlywheelJournalSummary.Type

/** One live agent pane in the flywheel's project, as the backend inventory reports it. */
export const FlywheelAgentSummary = Schema.Struct({
  issueId: Schema.String,
  role: Schema.String,
  harness: Schema.String,
  model: Schema.String,
  state: Schema.String,
  agentId: Schema.optional(Schema.String),
})
export type FlywheelAgentSummary = typeof FlywheelAgentSummary.Type

/** The lane an in-flight card sits in (PAN-5283 D1). */
export const FlywheelStage = Schema.Literals(["plan", "build", "checks", "review", "merge"])
export type FlywheelStage = typeof FlywheelStage.Type

/** Who drives an issue (PAN-5283 D3). */
export const FlywheelOwner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("flywheel") }),
  Schema.Struct({
    kind: Schema.Literal("conversation"),
    name: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("operator") }),
])
export type FlywheelOwner = typeof FlywheelOwner.Type

/** The agent a card shows (PAN-5283 D4): a live pane, or a handoff conversation. */
export const FlywheelCardAgent = Schema.Struct({
  /** The pane role, or `handoff` for a handoff conversation. */
  role: Schema.String,
  model: Schema.NullOr(Schema.String),
  harness: Schema.NullOr(Schema.String),
  state: Schema.Literals(["working", "blocked", "idle", "waiting", "unknown"]),
  agentId: Schema.optional(Schema.String),
  conversationName: Schema.optional(Schema.String),
})
export type FlywheelCardAgent = typeof FlywheelCardAgent.Type

export const FlywheelBlockerKind = Schema.Literals([
  "gate-queue",
  "agent-question",
  "agent-error",
  "start-failed",
  "pr-outside-pipeline",
  "agent-stuck",
  "test-removal-waiver",
  "verification-failed",
  "ci-failed",
  "feedback-undelivered",
  "merge-failed",
  "auto-merge-scheduled",
  "auto-merge-blocked",
  "train-batch",
  "train-paused",
  "ci-red",
  "merge-conflict",
  "declared-blocked",
  "review-stalled",
  "no-agent",
])
export type FlywheelBlockerKind = typeof FlywheelBlockerKind.Type

/** One plain-language sentence on why a card is not moving (PAN-5283 D11). */
export const FlywheelBlocker = Schema.Struct({
  kind: FlywheelBlockerKind,
  severity: Schema.Literals(["waiting", "stuck", "needs-you"]),
  text: Schema.String,
  action: Schema.optional(Schema.Literals(["waive-test-removal", "start-issue", "answer-agent"])),
})
export type FlywheelBlocker = typeof FlywheelBlocker.Type

/** The newest journal entry, as a plain-text label. */
export const FlywheelActivity = Schema.Struct({ at: Schema.String, label: Schema.String })
export type FlywheelActivity = typeof FlywheelActivity.Type

export const FlywheelInFlightRow = Schema.Struct({
  issueId: Schema.String,
  /** The tracker's title, or `null` when no tracker answered for this issue. */
  title: Schema.NullOr(Schema.String),
  state: IssueState,
  attention: Schema.optional(IssueAttention),
  pr: Schema.optional(DerivedPrState),
  /** Set when no configured tracker answered: the state is a guess, not a fact. */
  trackerUnknown: Schema.optional(Schema.Literal(true)),
  /** The row folds a feature-<id>-strike workspace onto its base issue (PAN-4752). */
  strike: Schema.optional(Schema.Literal(true)),
  /** Live agent panes on this issue. `working` with 0 means nobody is driving it. */
  liveAgents: Schema.Number,
  /** The loop named this id in its newest tick marker's in-flight list. */
  inTick: Schema.Boolean,
  lastJournal: Schema.NullOr(FlywheelJournalSummary),
  // Board fields (PAN-5283 FR-1): derived on read, optional so older payloads decode.
  stage: Schema.optional(FlywheelStage),
  stageSince: Schema.optional(Schema.NullOr(Schema.String)),
  owner: Schema.optional(FlywheelOwner),
  agent: Schema.optional(Schema.NullOr(FlywheelCardAgent)),
  blocker: Schema.optional(Schema.NullOr(FlywheelBlocker)),
  /** USD spent on the issue, or `null` when unknown. */
  cost: Schema.optional(Schema.NullOr(Schema.Number)),
  lastActivity: Schema.optional(Schema.NullOr(FlywheelActivity)),
})
export type FlywheelInFlightRow = typeof FlywheelInFlightRow.Type

export const FlywheelOrderBookSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  landed: Schema.Number,
  total: Schema.Number,
})
export type FlywheelOrderBookSummary = typeof FlywheelOrderBookSummary.Type

/** One PR merge on the default branch since local midnight (PAN-5283 D12). */
export const FlywheelShippedMerge = Schema.Struct({
  sha: Schema.String,
  at: Schema.String,
  subject: Schema.String,
  prNumber: Schema.Number,
  prUrl: Schema.NullOr(Schema.String),
  issueId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  /** `null` when deploy does not apply to this project (PAN-5283 D13). */
  deployed: Schema.NullOr(Schema.Boolean),
})
export type FlywheelShippedMerge = typeof FlywheelShippedMerge.Type

export const FlywheelShippedEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("merge"), at: Schema.String, merge: FlywheelShippedMerge }),
  Schema.Struct({
    kind: Schema.Literal("deploy"),
    at: Schema.String,
    trigger: Schema.String,
    issueId: Schema.NullOr(Schema.String),
    initiator: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("release"),
    at: Schema.String,
    tag: Schema.String,
    url: Schema.NullOr(Schema.String),
  }),
])
export type FlywheelShippedEvent = typeof FlywheelShippedEvent.Type

export const FlywheelShipped = Schema.Struct({
  merges: Schema.Array(FlywheelShippedMerge),
  events: Schema.Array(FlywheelShippedEvent),
})
export type FlywheelShipped = typeof FlywheelShipped.Type

/** Facts the global header does not show (PAN-5283 FR-9). Server route only. */
export const FlywheelHealth = Schema.Struct({
  mainCi: Schema.NullOr(
    Schema.Struct({
      conclusion: Schema.String,
      sha: Schema.String,
      url: Schema.NullOr(Schema.String),
      at: Schema.String,
    }),
  ),
  deployed: Schema.NullOr(
    Schema.Struct({ buildCommit: Schema.String, behindVerdict: Schema.NullOr(Schema.Number) }),
  ),
  gateQueue: Schema.Struct({
    running: Schema.Number,
    queued: Schema.Number,
    slots: Schema.Number,
    oldestWaitSince: Schema.NullOr(Schema.String),
  }),
  nextBatch: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      members: Schema.Array(Schema.String),
      createdAt: Schema.String,
    }),
  ),
  batchingPausedUntil: Schema.NullOr(Schema.String),
  lastRelease: Schema.NullOr(
    Schema.Struct({ tag: Schema.String, at: Schema.String, url: Schema.NullOr(Schema.String) }),
  ),
})
export type FlywheelHealth = typeof FlywheelHealth.Type

export const FlywheelDerivedStatus = Schema.Struct({
  run: FlywheelRunState,
  conversation: Schema.NullOr(FlywheelConversationSummary),
  lastTick: Schema.NullOr(FlywheelLastTick),
  /** The previous run's last tick (PAN-5666); absent from payloads older than it. */
  previousRun: Schema.optional(Schema.NullOr(FlywheelPreviousRun)),
  freshness: Schema.NullOr(FlywheelFreshness),
  policies: FlywheelPolicies,
  inFlight: Schema.Array(FlywheelInFlightRow),
  /** Every live agent on an in-flight issue, by issue then role. */
  agents: Schema.Array(FlywheelAgentSummary),
  /**
   * Which list the header counts: `tick` when a running loop named its own
   * in-flight ids, `census` when the rows are just the feature workspaces.
   */
  inFlightSource: Schema.Literals(["tick", "census"]),
  orderBook: Schema.NullOr(FlywheelOrderBookSummary),
  projectRoot: Schema.String,
  generatedAt: Schema.String,
  /** Added by the status route, never by `pan flywheel status` (PAN-5283 D7). */
  health: Schema.optional(FlywheelHealth),
  shipped: Schema.optional(FlywheelShipped),
})
export type FlywheelDerivedStatus = typeof FlywheelDerivedStatus.Type

/**
 * The tick whose needs-you items the page and `pan flywheel status` show
 * (PAN-5666). The current run's newest tick is the authority once it exists:
 * the loop carries every open item forward verbatim, and an item it drops is
 * resolved. Before that first tick, the previous run's items stay open. Their
 * message ids are dropped because they point into the previous transcript.
 */
export function needsYouTick(
  status: Pick<FlywheelDerivedStatus, "lastTick" | "previousRun">,
): FlywheelLastTick | null {
  if (status.lastTick) return status.lastTick
  const previous = status.previousRun?.lastTick
  if (!previous) return null
  return {
    tick: previous.tick,
    pick: previous.pick,
    phase: previous.phase,
    inFlight: previous.inFlight,
    needsYou: previous.needsYou,
    at: previous.at,
    ...(previous.needsYouItems
      ? {
          needsYouItems: previous.needsYouItems.map((item) => ({
            text: item.text,
            firstRaisedTick: item.firstRaisedTick,
            firstRaisedAt: item.firstRaisedAt,
            ...(item.context ? { context: item.context } : {}),
          })),
        }
      : {}),
  }
}

/** Cards on the Deploy and Done-today lanes. */
export function shippedCardCount(status: Pick<FlywheelDerivedStatus, "shipped">): number {
  return status.shipped?.merges.length ?? 0
}

export const decodeFlywheelDerivedStatus = Schema.decodeUnknownSync(FlywheelDerivedStatus)
