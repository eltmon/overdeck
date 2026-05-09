import { useState, useEffect } from 'react';
import { Container } from 'lucide-react';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
import { InlineSparkline } from '../InlineSparkline';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '../../shared/ContextMenu';
import styles from '../styles/command-deck.module.css';

export interface ContainerNodeProps {
  name: string;
  serviceName: string;
  status: 'running' | 'stopped' | 'unhealthy' | 'restarting';
  cpuPercent: number;
  memoryUsage: number;
  id?: string;
  cpuHistory?: number[];
  onViewLogs?: (name: string) => void;
  onRestart?: (name: string) => void;
  onStop?: (name: string) => void;
  onStart?: (name: string) => void;
  onInspect?: (name: string) => void;
}

function containerStatusToDot(status: ContainerNodeProps['status']): StatusDotStatus {
  switch (status) {
    case 'running': return 'active';
    case 'unhealthy': return 'waiting';
    case 'restarting': return 'thinking';
    case 'stopped': return 'ended';
    default: return 'ended';
  }
}

function containerStatusColor(status: ContainerNodeProps['status']): string {
  switch (status) {
    case 'running': return 'var(--success)';
    case 'unhealthy': return 'var(--warning)';
    case 'restarting': return 'var(--primary)';
    case 'stopped': return 'var(--muted-foreground)';
    default: return 'var(--muted-foreground)';
  }
}

function formatMemory(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}

export function ContainerNode({
  name,
  serviceName,
  status,
  cpuPercent,
  memoryUsage,
  id,
  cpuHistory: initialCpuHistory,
  onViewLogs,
  onRestart,
  onStop,
  onStart,
  onInspect,
}: ContainerNodeProps) {
  const [cpuHistory, setCpuHistory] = useState<number[]>(initialCpuHistory ?? []);
  const dotStatus = containerStatusToDot(status);
  const iconColor = containerStatusColor(status);

  useEffect(() => {
    if (!id || (initialCpuHistory && initialCpuHistory.length > 0)) return;
    let cancelled = false;
    void fetch(`/api/resources/${encodeURIComponent(id)}/history`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ cpuPercent: number[] }>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setCpuHistory(data.cpuPercent ?? []);
      })
      .catch(() => {
        // ignore
      });
    return () => { cancelled = true; };
  }, [id, initialCpuHistory]);

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <div className={styles.containerNode} title={name}>
          <Container size={12} style={{ color: iconColor, flexShrink: 0 }} />
          <span className={styles.containerName}>{serviceName}</span>
          <StatusDot status={dotStatus} size="sm" />
          <span className={styles.containerMetric}>{Math.round(cpuPercent)}%</span>
          <span className={styles.containerMetric}>{formatMemory(memoryUsage)}</span>
          {cpuHistory && cpuHistory.length > 0 && (
            <InlineSparkline data={cpuHistory} width={60} height={12} />
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {onViewLogs && (
          <ContextMenuItem onSelect={() => onViewLogs(name)}>
            View Logs
          </ContextMenuItem>
        )}
        {onInspect && (
          <ContextMenuItem onSelect={() => onInspect(name)}>
            Inspect
          </ContextMenuItem>
        )}
        {status === 'running' && onRestart && (
          <ContextMenuItem onSelect={() => onRestart(name)}>
            Restart
          </ContextMenuItem>
        )}
        {status === 'running' && onStop && (
          <ContextMenuItem onSelect={() => onStop(name)}>
            Stop
          </ContextMenuItem>
        )}
        {status === 'stopped' && onStart && (
          <ContextMenuItem onSelect={() => onStart(name)}>
            Start
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
