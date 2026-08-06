import type { HealthReason, SystemHealthConsumer, SystemHealthSnapshot } from '@overdeck/contracts';

export interface AttentionAgentTarget {
  agentId: string;
  issueId?: string;
  killConsumer?: SystemHealthConsumer;
}

export interface AttentionItem {
  severity: 'critical' | 'warning';
  code: string;
  title: string;
  sub: string;
  agents: string[];
  targets: AttentionAgentTarget[];
  agentId?: string;
  issueId?: string;
  killConsumer?: SystemHealthConsumer;
}

/**
 * Extracts only severity:'info' reasons to be shown in a collapsed "context notes" section.
 */
export function contextNotes(snapshot: SystemHealthSnapshot): HealthReason[] {
  return [
    ...snapshot.host.reasons.filter(r => r.severity === 'info'),
    ...snapshot.admission.reasons.filter(r => r.severity === 'info'),
    ...snapshot.agents.flatMap(a => a.reasons).filter(r => r.severity === 'info'),
    ...snapshot.services.flatMap(s => s.reasons).filter(r => r.severity === 'info'),
  ];
}

/**
 * Mapping from reason code to user-visible label, extracted from SystemHealthPill.
 */
export function reasonLabel(snapshot: SystemHealthSnapshot, reason: HealthReason): string | null {
  switch (reason.code) {
    case 'admission.memory_available.soft':
      return 'spawn headroom tight';
    case 'admission.memory_available.blocked':
      return snapshot.admission.availableMemoryBytes == null
        ? 'spawn admission blocked'
        : `${formatBytes(snapshot.admission.availableMemoryBytes)} available`;
    case 'host.linux.psi_some.warning':
    case 'host.linux.psi_full.critical':
    case 'host.darwin.memory_pressure.warning':
    case 'host.darwin.memory_pressure.critical':
      return 'memory pressure detected';
    case 'host.linux.swap_activity.warning':
    case 'host.linux.swap_activity.critical':
      return reason.observed == null
        ? 'swap activity detected'
        : `${formatBytes(reason.observed)} swap activity/min`;
    case 'host.linux.inotify_watches.warning':
      return 'file-watcher budget low';
    case 'host.linux.inotify_watches.critical':
      return 'file-watcher budget exhausted';
    case 'agent.context.saturated':
      return 'agent context exhausted';
    case 'agent.tmux.missing':
      return 'agent session missing';
    case 'agent.kickoff.not_delivered':
      return 'agent kickoff stalled';
    case 'agent.runtime.inactive.warning':
    case 'agent.runtime.inactive.stalled':
      return 'agent activity stalled';
    case 'service.smee_relay.stopped':
      return 'webhook relay stopped';
    case 'service.smee_relay.unavailable':
      return 'webhook relay unavailable';
    case 'system.health_snapshot.unavailable':
    case 'host.current_pressure.unavailable':
    case 'host.sampler.collection_failed':
    case 'agent.persisted_state.unavailable':
      return 'Retry';
    default:
      return null;
  }
}

function formatBytes(bytes: number): string {
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) {
    return `${Number.isInteger(gib) ? gib.toFixed(0) : gib.toFixed(1)} GB`;
  }
  const mib = bytes / (1024 ** 2);
  return `${mib.toFixed(0)} MB`;
}

/**
 * Builds attention items from snapshot, excluding severity:'info' reasons.
 * Groups identical reason codes across agents with a xN badge.
 * Maps server severity to presentation severity (e.g., stalled → critical).
 * Sorts by severity (critical first), then by code (stalled before idle).
 */
export function buildAttentionItems(snapshot: SystemHealthSnapshot): AttentionItem[] {
  const agentConsumers = new Map<string, SystemHealthConsumer>();
  for (const consumer of snapshot.topConsumers) {
    if (consumer.type === 'container') continue;
    const agentId = consumer.killTarget?.kind === 'agent'
      ? consumer.killTarget.agentId ?? consumer.id
      : consumer.id;
    if (!agentConsumers.has(agentId)) {
      agentConsumers.set(agentId, consumer);
    }
  }

  const allReasons: Array<{
    reason: HealthReason;
    target?: AttentionAgentTarget;
  }> = [];

  // Collect host reasons
  snapshot.host.reasons
    .filter(r => r.severity !== 'info')
    .forEach(reason => {
      allReasons.push({ reason });
    });

  // Collect admission reasons
  snapshot.admission.reasons
    .filter(r => r.severity !== 'info')
    .forEach(reason => {
      allReasons.push({ reason });
    });

  // Collect service reasons
  snapshot.services.flatMap(service =>
    service.reasons
      .filter(r => r.severity !== 'info')
      .map(reason => ({ reason }))
  ).forEach(item => {
    allReasons.push(item);
  });

  // Collect agent reasons
  snapshot.agents.forEach((agent) => {
    agent.reasons
      .filter(r => r.severity !== 'info')
      .forEach(reason => {
        allReasons.push({
          reason,
          target: {
            agentId: agent.id,
            issueId: agent.issueId,
            killConsumer: agentConsumers.get(agent.id),
          },
        });
      });
  });

  // Group by reason code
  const grouped = new Map<string, Array<{
    reason: HealthReason;
    target?: AttentionAgentTarget;
  }>>();
  for (const item of allReasons) {
    const key = item.reason.code;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(item);
  }

  // Build items
  const items: AttentionItem[] = [];
  for (const [code, entries] of grouped) {
    const firstEntry = entries[0]!;
    const reason = firstEntry.reason;

    // Filter: only agent-domain reasons group; others are singletons
    const isAgentDomain = code.startsWith('agent.');
    const isGroupable = isAgentDomain && entries.length > 1;

    if (isGroupable) {
      // Grouped row
      const targets = entries
        .map(e => e.target)
        .filter((target): target is AttentionAgentTarget => target !== undefined);
      const agentIds = targets.map(target => target.agentId);
      const subLine = agentIds.slice(0, 2).join(', ') + (agentIds.length > 2 ? ` +${agentIds.length - 2} more` : '');

      items.push({
        severity: mapPresentationSeverity(reason.code, reason.severity),
        code,
        title: reasonLabel(snapshot, reason) ?? code,
        sub: `${agentIds.length}× agents: ${subLine}`,
        agents: agentIds,
        targets,
      });
    } else {
      // Singleton row
      const target = firstEntry.target;
      const agentId = target?.agentId;
      const issueId = target?.issueId;
      const title = agentId
        ? issueId ? `${agentId} · ${issueId}` : agentId
        : reasonLabel(snapshot, reason) ?? code;
      const agentMessagePrefix = agentId ? `${agentId} has produced ` : undefined;
      const sub = agentMessagePrefix && reason.message.startsWith(agentMessagePrefix)
        ? reason.message.slice(agentMessagePrefix.length)
        : reason.message;

      items.push({
        severity: mapPresentationSeverity(reason.code, reason.severity),
        code,
        title,
        sub,
        agents: agentId ? [agentId] : [],
        targets: target ? [target] : [],
        agentId,
        issueId,
        killConsumer: target?.killConsumer,
      });
    }
  }

  // Sort: critical first, then warning; within severity, stalled before idle
  items.sort((a, b) => {
    // Critical first
    if (a.severity !== b.severity) {
      return a.severity === 'critical' ? -1 : 1;
    }
    // Within same severity: stalled before idle
    const aIsStalled = a.code === 'agent.runtime.inactive.stalled';
    const bIsStalled = b.code === 'agent.runtime.inactive.stalled';
    if (aIsStalled !== bIsStalled) {
      return aIsStalled ? -1 : 1;
    }
    return 0;
  });

  return items;
}

/**
 * Map server severity to presentation severity.
 * Agent inactivity.stalled is presented as critical (red dot).
 */
function mapPresentationSeverity(code: string, serverSeverity: string): 'critical' | 'warning' {
  if (code === 'agent.runtime.inactive.stalled') {
    return 'critical';
  }
  return serverSeverity === 'critical' ? 'critical' : 'warning';
}

/**
 * Generates the summary line for the popover header.
 * Returns a one-sentence answer to "do I need to do anything right now?"
 */
export function summaryLine(snapshot: SystemHealthSnapshot, items: AttentionItem[]): string {
  const stalledAgentCount = items
    .filter(item => item.code === 'agent.runtime.inactive.stalled')
    .reduce((sum, item) => sum + item.agents.length, 0);
  const idleAgentCount = items
    .filter(item => item.code === 'agent.runtime.inactive.warning')
    .reduce((sum, item) => sum + item.agents.length, 0);
  const warningCount = items.filter(item => item.severity === 'warning').length;
  const criticalCount = items.filter(item => item.severity === 'critical').length;
  const contextNoteCount = contextNotes(snapshot).length;
  const memory = snapshot.host.metrics.memoryUsedPercent == null
    ? 'memory unavailable'
    : `memory at ${snapshot.host.metrics.memoryUsedPercent.toFixed(1)}%`;
  const headroom = snapshot.admission.availableMemoryBytes == null
    ? 'spawn headroom unavailable'
    : `${formatBytes(snapshot.admission.availableMemoryBytes)} spawn headroom`;
  const relay = !snapshot.summary.smeeRelay.configured
    ? 'relay not configured'
    : snapshot.summary.smeeRelay.running ? 'relay running' : 'relay stopped';
  const operationalContext = [
    `${stalledAgentCount} stalled agent${stalledAgentCount === 1 ? '' : 's'}`,
    `${idleAgentCount} idle agent${idleAgentCount === 1 ? '' : 's'}`,
    memory,
    headroom,
    `${contextNoteCount} context note${contextNoteCount === 1 ? '' : 's'}`,
  ].join(' · ');

  if (items.length === 0) {
    return `All clear · ${memory} · ${headroom} · ${relay} · ${stalledAgentCount} stalled agents · ${idleAgentCount} idle agents · ${contextNoteCount} context note${contextNoteCount === 1 ? '' : 's'}`;
  }

  if (criticalCount > 0) {
    return `Action required: ${criticalCount} critical issue${criticalCount === 1 ? '' : 's'} · ${operationalContext}`;
  }

  return `Attention needed: ${warningCount} warning${warningCount === 1 ? '' : 's'} · ${operationalContext}`;
}
