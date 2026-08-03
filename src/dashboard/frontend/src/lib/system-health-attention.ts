import type { SystemHealthSnapshot, HealthReason } from '@overdeck/contracts';

export interface AttentionItem {
  severity: 'critical' | 'warning';
  code: string;
  title: string;
  sub: string;
  agents: string[];
  agentId?: string;
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
function reasonLabel(snapshot: SystemHealthSnapshot, reason: HealthReason): string | null {
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
  const allReasons: Array<{
    reason: HealthReason;
    agentId?: string;
    agentIssueId?: string;
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
  snapshot.agents.forEach((agent, agentIndex) => {
    agent.reasons
      .filter(r => r.severity !== 'info')
      .forEach(reason => {
        allReasons.push({
          reason,
          agentId: snapshot.agents[agentIndex]?.id,
          agentIssueId: snapshot.agents[agentIndex]?.issueId,
        });
      });
  });

  // Group by reason code
  const grouped = new Map<string, Array<{
    reason: HealthReason;
    agentId?: string;
    agentIssueId?: string;
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
      const agentIds = entries
        .map(e => e.agentId)
        .filter((id): id is string => id !== undefined);

      const subLine = agentIds.slice(0, 2).join(', ') + (agentIds.length > 2 ? ` +${agentIds.length - 2} more` : '');

      items.push({
        severity: mapPresentationSeverity(reason.code, reason.severity),
        code,
        title: reasonLabel(snapshot, reason) ?? code,
        sub: `${agentIds.length}× agents: ${subLine}`,
        agents: agentIds,
      });
    } else {
      // Singleton row
      const agentId = firstEntry.agentId;
      const issueId = firstEntry.agentIssueId;
      let sub = reason.message;
      if (agentId && issueId) {
        sub = `${agentId} · ${issueId}`;
      } else if (agentId) {
        sub = agentId;
      }

      items.push({
        severity: mapPresentationSeverity(reason.code, reason.severity),
        code,
        title: reasonLabel(snapshot, reason) ?? code,
        sub,
        agents: agentId ? [agentId] : [],
        agentId,
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
  if (items.length === 0) {
    // Healthy: name spawn headroom, relay state, zero stalled agents
    const headroomGib = (snapshot.admission.availableMemoryBytes ?? 0) / (1024 ** 3);
    const relayStatus = snapshot.services.find(s => s.id === 'smee-relay' || s.id === 'webhook-relay');
    const relayRunning = relayStatus?.status === 'running';

    const headroomStr = headroomGib >= 1 ? `${headroomGib.toFixed(1)} GiB spawn headroom` : 'Limited spawn headroom';
    const relayStr = relayRunning ? 'relay running' : 'relay stopped';

    return `All clear · ${headroomStr} · ${relayStr} · 0 stalled agents`;
  }

  const stalledItems = items.filter(i => i.code === 'agent.runtime.inactive.stalled');
  const stalledAgentCount = stalledItems.reduce((sum, item) => sum + item.agents.length, 0);
  const warningCount = items.filter(i => i.severity === 'warning').length;
  const criticalCount = items.filter(i => i.severity === 'critical').length;

  if (criticalCount > 0) {
    return `Action required: ${criticalCount} critical issue${criticalCount !== 1 ? 's' : ''} (${stalledAgentCount} stalled agent${stalledAgentCount !== 1 ? 's' : ''})`;
  }

  return `Attention needed: ${warningCount} warning${warningCount !== 1 ? 's' : ''}`;
}
