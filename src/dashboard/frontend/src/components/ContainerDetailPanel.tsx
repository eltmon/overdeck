/**
 * ContainerDetailPanel — slide-out panel showing container details.
 * Tabs: Overview, Logs, Ports/Env.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ContainerStats, ContainerHistory } from '../types';
import { ResourceBar } from './ResourceBar';
import { Sparkline } from './Sparkline';

interface ContainerDetails {
  id: string;
  name: string;
  image: string;
  status: string;
  created: string;
  uptime: string;
  ports: Array<{ host: string; container: string; protocol: string }>;
  env: string[];
  logs: string;
  networkIn: number;
  networkOut: number;
}

interface ContainerDetailPanelProps {
  container: ContainerStats;
  history: ContainerHistory;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KiB`;
  return `${bytes}B`;
}

async function fetchContainerDetails(containerId: string): Promise<ContainerDetails> {
  const res = await fetch(`/api/resources/${containerId}/details`);
  if (!res.ok) throw new Error('Failed to fetch container details');
  return res.json();
}

type DetailTab = 'overview' | 'logs' | 'ports-env';

export function ContainerDetailPanel({ container, history, onClose }: ContainerDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  const { data: details } = useQuery({
    queryKey: ['container-details', container.id],
    queryFn: () => fetchContainerDetails(container.id),
    refetchInterval: activeTab === 'logs' ? 5000 : 30000,
  });

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'logs', label: 'Logs' },
    { id: 'ports-env', label: 'Ports & Env' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-card border-l border-border flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            container.status === 'running' ? 'bg-success' :
            container.status === 'unhealthy' ? 'bg-warning' :
            container.status === 'restarting' ? 'bg-warning' :
            'bg-destructive'
          }`} />
          <h2 className="font-semibold text-foreground text-sm flex-1 truncate" title={container.name}>
            {container.name}
          </h2>
          {details?.image && (
            <span className="text-xs text-muted-foreground truncate max-w-[160px]" title={details.image}>
              {details.image}
            </span>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-popover text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs transition-colors ${
                activeTab === tab.id
                  ? 'text-primary border-b-2 border-primary -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Current stats */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Current Usage
                </h3>
                <div className="space-y-2">
                  <ResourceBar value={container.cpuPercent} label="CPU" />
                  <ResourceBar value={container.memoryPercent} label="Memory" />
                  {container.memoryLimit > 0 && (
                    <div className="text-xs text-muted-foreground text-right">
                      {formatBytes(container.memoryUsage)} / {formatBytes(container.memoryLimit)}
                    </div>
                  )}
                </div>
              </div>

              {/* Sparklines */}
              {history.cpuPercent.length > 1 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    5-Min History
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">CPU %</div>
                      <div className="w-full">
                        <Sparkline data={history.cpuPercent} color="rgba(59,130,246,0.8)" height={40} />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Memory %</div>
                      <div className="w-full">
                        <Sparkline data={history.memoryPercent} color="rgba(168,85,247,0.8)" height={40} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Network I/O */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Network I/O
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-card p-2 rounded">
                    <div className="text-xs text-muted-foreground">In</div>
                    <div className="text-sm font-medium text-foreground">{formatBytes(container.networkIn)}</div>
                  </div>
                  <div className="bg-card p-2 rounded">
                    <div className="text-xs text-muted-foreground">Out</div>
                    <div className="text-sm font-medium text-foreground">{formatBytes(container.networkOut)}</div>
                  </div>
                </div>
              </div>

              {/* Container info */}
              {details && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Container Info
                  </h3>
                  <dl className="space-y-1 text-xs">
                    {details.uptime && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Uptime</dt>
                        <dd className="text-foreground">{details.uptime}</dd>
                      </div>
                    )}
                    {details.created && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Created</dt>
                        <dd className="text-foreground">{new Date(details.created).toLocaleString()}</dd>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="text-foreground">{details.status}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Recent Logs (tail 100)
              </h3>
              {details?.logs ? (
                <pre className="text-xs text-foreground bg-card p-3 rounded overflow-auto max-h-[600px] font-mono whitespace-pre-wrap break-all">
                  {details.logs}
                </pre>
              ) : (
                <div className="text-xs text-muted-foreground text-center py-8">
                  Loading logs…
                </div>
              )}
            </div>
          )}

          {activeTab === 'ports-env' && (
            <div className="space-y-4">
              {/* Ports */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Port Mappings
                </h3>
                {details?.ports?.length ? (
                  <div className="space-y-1">
                    {details.ports.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-foreground font-mono">{p.host}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground font-mono">{p.container}/{p.protocol}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No port mappings</div>
                )}
              </div>

              {/* Env vars */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Environment Variables
                </h3>
                {details?.env?.length ? (
                  <div className="space-y-0.5 max-h-80 overflow-auto">
                    {details.env.map((e, i) => {
                      const [key, ...rest] = e.split('=');
                      const val = rest.join('=');
                      const isSensitive = /token|secret|key|pass|pwd|auth/i.test(key ?? '');
                      return (
                        <div key={i} className="text-xs font-mono flex gap-1 flex-wrap">
                          <span className="text-primary">{key}</span>
                          <span className="text-muted-foreground">=</span>
                          <span className="text-foreground break-all">
                            {isSensitive ? '***' : val}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No environment variables</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
