import { useEffect, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import type { FlywheelStatus } from '@overdeck/contracts';
import { requestRevealOpenQuestions } from '../lib/flywheelReveal';
import { subscribeFlywheelStatus } from '../lib/wsTransport';

interface OpenQuestionsIndicatorProps {
  onActivate: () => void;
}

async function fetchCurrentFlywheelStatus(signal: AbortSignal): Promise<FlywheelStatus | null> {
  const response = await fetch('/api/flywheel/current', { signal });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<FlywheelStatus | null>;
}

export function OpenQuestionsIndicator({ onActivate }: OpenQuestionsIndicatorProps) {
  const [status, setStatus] = useState<FlywheelStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    let activeController: AbortController | null = null;
    const refreshCurrentStatus = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const requestRevision = revision;
      try {
        const current = await fetchCurrentFlywheelStatus(controller.signal);
        if (!cancelled && activeController === controller && revision === requestRevision) setStatus(current);
      } catch {
        // The RPC subscription remains authoritative while the dashboard restarts.
      }
    };
    void refreshCurrentStatus();
    const interval = window.setInterval(() => {
      void refreshCurrentStatus();
    }, 5000);
    const unsubscribe = subscribeFlywheelStatus((next) => {
      revision += 1;
      activeController?.abort();
      activeController = null;
      setStatus(next);
    });
    return () => {
      cancelled = true;
      revision += 1;
      activeController?.abort();
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const count = status?.openQuestions?.length ?? 0;
  if (count === 0) return null;

  const label = `${count} open Flywheel question${count === 1 ? '' : 's'} — click to view`;
  return (
    <button
      type="button"
      onClick={() => {
        requestRevealOpenQuestions();
        onActivate();
      }}
      title={label}
      aria-label={label}
      className="inline-flex h-5 items-center gap-1.5 rounded-sm border px-1.5 text-[10px] font-medium badge-bg-warning badge-border-warning text-warning-foreground tabular-nums"
    >
      <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />
      {count}
    </button>
  );
}
