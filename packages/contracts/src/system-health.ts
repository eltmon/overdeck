import { Schema, SchemaGetter } from "effect"

const HealthStateValue = Schema.Literals([
  "measuring",
  "healthy",
  "warning",
  "critical",
  "unavailable",
])

export const HealthState = Schema.String.pipe(
  Schema.decodeTo(HealthStateValue, {
    decode: SchemaGetter.transform((value) =>
      HealthStateValue.literals.includes(value as HealthState) ? value as HealthState : "unavailable"
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
)
export type HealthState = typeof HealthStateValue.Type

export const HealthReason = Schema.Struct({
  code: Schema.String,
  domain: Schema.Literals(["host", "admission", "agent", "service"]),
  severity: Schema.Literals(["info", "warning", "critical"]),
  message: Schema.String,
  metric: Schema.optional(Schema.String),
  observed: Schema.optional(Schema.Number),
  threshold: Schema.optional(Schema.Number),
})
export type HealthReason = typeof HealthReason.Type

export const HostPlatform = Schema.String.pipe(
  Schema.decodeTo(Schema.Literals(["linux", "darwin", "unsupported"]), {
    decode: SchemaGetter.transform((value) =>
      value === "linux" || value === "darwin" || value === "unsupported" ? value : "unsupported"
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
)
export type HostPlatform = typeof HostPlatform.Type

/**
 * Accepted host metrics. Null means that the platform collector could not
 * produce that signal; it must never be interpreted as a measured zero.
 */
export const HostHealthMetrics = Schema.Struct({
  cpuPercent: Schema.NullOr(Schema.Number),
  loadAverage1m: Schema.NullOr(Schema.Number),
  loadPerCore1m: Schema.NullOr(Schema.Number),
  totalMemoryBytes: Schema.NullOr(Schema.Number),
  usedMemoryBytes: Schema.NullOr(Schema.Number),
  availableMemoryBytes: Schema.NullOr(Schema.Number),
  memoryUsedPercent: Schema.NullOr(Schema.Number),
  memoryPressureSomeAvg10: Schema.NullOr(Schema.Number),
  memoryPressureFullAvg10: Schema.NullOr(Schema.Number),
  memoryPressureFreePercent: Schema.NullOr(Schema.Number),
  swapTotalBytes: Schema.NullOr(Schema.Number),
  swapUsedBytes: Schema.NullOr(Schema.Number),
  swapUsedPercent: Schema.NullOr(Schema.Number),
  swapActivityBytesPerMinute: Schema.NullOr(Schema.Number),
  committedMemoryBytes: Schema.NullOr(Schema.Number),
  commitLimitBytes: Schema.NullOr(Schema.Number),
  virtualCommitmentPercent: Schema.NullOr(Schema.Number),
})
export type HostHealthMetrics = typeof HostHealthMetrics.Type

export const AdmissionState = Schema.String.pipe(
  Schema.decodeTo(Schema.Literals(["open", "soft", "blocked", "unavailable"]), {
    decode: SchemaGetter.transform((value) =>
      value === "open" || value === "soft" || value === "blocked" || value === "unavailable"
        ? value
        : "unavailable"
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
)
export type AdmissionState = typeof AdmissionState.Type

export const AgentHealthStatus = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Literals([
      "healthy",
      "idle",
      "waiting",
      "warning",
      "stalled",
      "wedged",
      "dead",
      "unavailable",
    ]),
    {
      decode: SchemaGetter.transform((value) =>
        value === "healthy" ||
          value === "idle" ||
          value === "waiting" ||
          value === "warning" ||
          value === "stalled" ||
          value === "wedged" ||
          value === "dead" ||
          value === "unavailable"
          ? value
          : "unavailable"
      ),
      encode: SchemaGetter.transform((value) => value),
    },
  ),
)
export type AgentHealthStatus = typeof AgentHealthStatus.Type

export const AgentHealthKind = Schema.String.pipe(
  Schema.decodeTo(Schema.Literals(["work", "planning", "specialist", "conversation", "other"]), {
    decode: SchemaGetter.transform((value) =>
      value === "work" ||
        value === "planning" ||
        value === "specialist" ||
        value === "conversation" ||
        value === "other"
        ? value
        : "other"
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
)
export type AgentHealthKind = typeof AgentHealthKind.Type

export const SpecialistLifecycle = Schema.String.pipe(
  Schema.decodeTo(Schema.Literals(["active", "warm", "orphaned", "unknown"]), {
    decode: SchemaGetter.transform((value) =>
      value === "active" || value === "warm" || value === "orphaned" || value === "unknown"
        ? value
        : "unknown"
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
)
export type SpecialistLifecycle = typeof SpecialistLifecycle.Type

export const AgentHealthSnapshot = Schema.Struct({
  id: Schema.String,
  issueId: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  kind: Schema.optional(AgentHealthKind),
  status: AgentHealthStatus,
  lifecycle: Schema.optional(SpecialistLifecycle),
  tmuxActive: Schema.optional(Schema.Boolean),
  memoryBytes: Schema.optional(Schema.Number),
  memoryGb: Schema.optional(Schema.Number),
  cpuPercent: Schema.optional(Schema.Number),
  currentIssue: Schema.optional(Schema.String),
  lastActivityAt: Schema.optional(Schema.String),
  consecutiveFailures: Schema.optional(Schema.Number),
  killCount: Schema.optional(Schema.Number),
  contextPercent: Schema.optional(Schema.NullOr(Schema.Number)),
  reasons: Schema.Array(HealthReason),
})
export type AgentHealthSnapshot = typeof AgentHealthSnapshot.Type

export const ServiceHealthStatus = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Literals(["running", "not_configured", "degraded", "stopped", "unavailable"]),
    {
      decode: SchemaGetter.transform((value) =>
        value === "running" ||
          value === "not_configured" ||
          value === "degraded" ||
          value === "stopped" ||
          value === "unavailable"
          ? value
          : "unavailable"
      ),
      encode: SchemaGetter.transform((value) => value),
    },
  ),
)
export type ServiceHealthStatus = typeof ServiceHealthStatus.Type

export const ServiceHealthSnapshot = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
  status: ServiceHealthStatus,
  message: Schema.String,
  reasons: Schema.Array(HealthReason),
})
export type ServiceHealthSnapshot = typeof ServiceHealthSnapshot.Type

export const SystemHealthConsumer = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  type: Schema.Literals(["agent", "specialist", "container"]),
  memoryBytes: Schema.Number,
  memoryGb: Schema.Number,
  cpuPercent: Schema.optional(Schema.Number),
  issueId: Schema.optional(Schema.String),
  currentIssue: Schema.optional(Schema.String),
  leaked: Schema.optional(Schema.Boolean),
  killTarget: Schema.optional(Schema.Struct({
    kind: Schema.Literals(["agent", "specialist", "container"]),
    agentId: Schema.optional(Schema.String),
    containerId: Schema.optional(Schema.String),
    projectKey: Schema.optional(Schema.String),
    issueId: Schema.optional(Schema.String),
    specialistType: Schema.optional(Schema.String),
  })),
})
export type SystemHealthConsumer = typeof SystemHealthConsumer.Type

export const LegacyWebhookRelaySummary = Schema.Struct({
  configured: Schema.Boolean,
  running: Schema.Boolean,
  status: Schema.Literals(["not_configured", "running", "stopped", "unknown"]),
  message: Schema.String,
})
export type LegacyWebhookRelaySummary = typeof LegacyWebhookRelaySummary.Type

/** Compatibility fields retained for one release cycle. */
export const LegacySystemHealthSummary = Schema.Struct({
  cpuPercent: Schema.Number,
  loadAverage1m: Schema.Number,
  loadPerCore1m: Schema.Number,
  totalMemoryBytes: Schema.Number,
  usedMemoryBytes: Schema.Number,
  availableMemoryBytes: Schema.Number,
  memoryUsedPercent: Schema.Number,
  swapTotalBytes: Schema.Number,
  swapUsedBytes: Schema.Number,
  swapUsedPercent: Schema.Number,
  committedMemoryBytes: Schema.Number,
  commitLimitBytes: Schema.Number,
  overcommitPercent: Schema.Number,
  agentCount: Schema.Number,
  workAgentCount: Schema.Number,
  planningAgentCount: Schema.Number,
  specialistSessionCount: Schema.Number,
  leakedSpecialistCount: Schema.Number,
  containerCount: Schema.Number,
  containerMemoryBytes: Schema.Number,
  overdeckMemoryBytes: Schema.Number,
  overdeckMemoryPercent: Schema.Number,
  smeeRelay: LegacyWebhookRelaySummary,
})
export type LegacySystemHealthSummary = typeof LegacySystemHealthSummary.Type

export const SystemHealthSnapshot = Schema.Struct({
  version: Schema.Literal(2),
  state: HealthState,
  updatedAt: Schema.String,
  nextPollMs: Schema.Number,
  host: Schema.Struct({
    state: HealthState,
    platform: HostPlatform,
    reasons: Schema.Array(HealthReason),
    metrics: HostHealthMetrics,
  }),
  admission: Schema.Struct({
    state: AdmissionState,
    availableMemoryBytes: Schema.NullOr(Schema.Number),
    admittedWorkAgentCount: Schema.Number,
    reasons: Schema.Array(HealthReason),
  }),
  agents: Schema.Array(AgentHealthSnapshot),
  services: Schema.Array(ServiceHealthSnapshot),
  // The producer supplies every memory-bearing consumer in descending order.
  // Presentation clients may slice this array; the compatibility projector
  // needs the exhaustive source to preserve aggregate container totals.
  topConsumers: Schema.Array(SystemHealthConsumer),
  summary: LegacySystemHealthSummary,
})
export type SystemHealthSnapshot = typeof SystemHealthSnapshot.Type

function isWorkAgent(agent: AgentHealthSnapshot): boolean {
  return agent.kind === "work" || agent.role === "work"
}

function isPlanningAgent(agent: AgentHealthSnapshot): boolean {
  return agent.kind === "planning" || agent.role === "plan" || agent.role === "planning"
}

function isSpecialistAgent(agent: AgentHealthSnapshot): boolean {
  return agent.kind === "specialist" ||
    agent.role === "review" ||
    agent.role?.startsWith("review-") === true ||
    agent.role === "test" ||
    agent.role === "ship"
}

function projectWebhookRelay(services: ReadonlyArray<ServiceHealthSnapshot>): LegacyWebhookRelaySummary {
  const relay = services.find((service) => service.id === "smee-relay" || service.id === "webhook-relay")
  if (!relay) {
    return {
      configured: false,
      running: false,
      status: "unknown",
      message: "Webhook relay health is unavailable.",
    }
  }

  const status = relay.status === "running" || relay.status === "not_configured" || relay.status === "stopped"
    ? relay.status
    : "unknown"

  return {
    configured: relay.status !== "not_configured",
    running: relay.status === "running",
    status,
    message: relay.message,
  }
}

/**
 * Projects the V2 domains into the legacy summary without recollecting state.
 * Diagnostic-only swap and virtual-commitment values remain visible here but
 * do not participate in V2 health-state evaluation.
 */
export function projectLegacySystemHealthSummary(
  snapshot: Omit<SystemHealthSnapshot, "summary">,
): LegacySystemHealthSummary {
  const metrics = snapshot.host.metrics
  const agentMemoryBytes = snapshot.agents.reduce((total, agent) => total + (agent.memoryBytes ?? 0), 0)
  const containers = snapshot.topConsumers.filter((consumer) => consumer.type === "container")
  const containerMemoryBytes = containers.reduce((total, consumer) => total + consumer.memoryBytes, 0)
  const overdeckMemoryBytes = agentMemoryBytes + containerMemoryBytes
  const totalMemoryBytes = metrics.totalMemoryBytes ?? 0

  return {
    cpuPercent: metrics.cpuPercent ?? 0,
    loadAverage1m: metrics.loadAverage1m ?? 0,
    loadPerCore1m: metrics.loadPerCore1m ?? 0,
    totalMemoryBytes,
    usedMemoryBytes: metrics.usedMemoryBytes ?? 0,
    availableMemoryBytes: metrics.availableMemoryBytes ?? 0,
    memoryUsedPercent: metrics.memoryUsedPercent ?? 0,
    swapTotalBytes: metrics.swapTotalBytes ?? 0,
    swapUsedBytes: metrics.swapUsedBytes ?? 0,
    swapUsedPercent: metrics.swapUsedPercent ?? 0,
    committedMemoryBytes: metrics.committedMemoryBytes ?? 0,
    commitLimitBytes: metrics.commitLimitBytes ?? 0,
    overcommitPercent: metrics.virtualCommitmentPercent ?? 0,
    agentCount: snapshot.agents.length,
    workAgentCount: snapshot.agents.filter(isWorkAgent).length,
    planningAgentCount: snapshot.agents.filter(isPlanningAgent).length,
    specialistSessionCount: snapshot.agents.filter(isSpecialistAgent).length,
    leakedSpecialistCount: snapshot.agents.filter((agent) =>
      isSpecialistAgent(agent) && agent.lifecycle === "orphaned"
    ).length,
    containerCount: containers.length,
    containerMemoryBytes,
    overdeckMemoryBytes,
    overdeckMemoryPercent: totalMemoryBytes > 0 ? Math.round((overdeckMemoryBytes / totalMemoryBytes) * 1000) / 10 : 0,
    smeeRelay: projectWebhookRelay(snapshot.services),
  }
}
