import { useState } from 'react';
import type { CoreServiceResource } from '../../types';

interface CoreServicesSectionProps {
  services: CoreServiceResource[];
  filter: string;
  onFocusRow: (id: string) => void;
}

export function CoreServicesSection({ services, filter, onFocusRow }: CoreServicesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const rows = services.filter((service) => matches(service, filter));
  if (rows.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Core services">
      <h2 className="mb-2 font-['DM_Mono'] text-xs uppercase text-muted-foreground">Core services · {rows.length}</h2>
      <div className="divide-y divide-border border border-border">
        {rows.map((service) => (
          <div key={service.id}>
            <button
              type="button"
              className="grid w-full grid-cols-[1fr_140px_140px_120px_140px] items-center gap-3 bg-background px-4 py-3 text-left text-sm hover:bg-muted/40 focus:bg-muted focus:outline-none"
              onClick={() => service.id === 'support-fleet' && setExpanded((value) => !value)}
              onFocus={() => onFocusRow(`core:${service.id}`)}
            >
              <span>
                <span className="block font-medium text-foreground">{service.label}</span>
                <span className="block text-xs text-muted-foreground">{service.id === 'dashboard' ? `event-loop p99 ${service.eventLoopP99Ms ?? 0}ms` : service.id === 'deacon' ? `tick age ${service.lastTickAgeSeconds ?? 0}s` : `${service.memberCount} members`}</span>
              </span>
              <span className="text-xs text-muted-foreground">{service.status}</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{service.cpuPercent}% CPU</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{formatBytes(service.memoryBytes)}</span>
              <span className="text-right text-xs text-muted-foreground">{actionsFor(service.id, expanded)}</span>
            </button>
            {service.id === 'support-fleet' && expanded && service.members && (
              <div className="bg-muted/30 px-4 py-2 font-['DM_Mono'] text-xs text-muted-foreground">
                {service.members.map((member) => <div key={member}>{member}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function matches(service: CoreServiceResource, filter: string) {
  const query = filter.trim().toLowerCase();
  if (!query) return true;
  return [service.id, service.label, service.status, ...(service.members ?? [])]
    .some((value) => value.toLowerCase().includes(query));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}

function actionsFor(id: CoreServiceResource['id'], expanded: boolean) {
  if (id === 'dashboard') return 'Restart · Logs';
  if (id === 'deacon') return 'Freeze';
  return expanded ? 'Collapse' : 'Expand';
}
