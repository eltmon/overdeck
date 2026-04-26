import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, XCircle, Clock } from 'lucide-react';
import { useConfirm } from './DialogProvider';

interface GracePeriodState {
  active: boolean;
  startedAt: string;
  duration: number;
  paused: boolean;
  pausedAt?: string;
  remainingTime?: number;
}

interface GraceCountdownProps {
  project: string;
  type: string;
  gracePeriod: GracePeriodState;
}

async function pauseGracePeriod(project: string, type: string): Promise<void> {
  const res = await fetch(`/api/specialists/${project}/${type}/grace/pause`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to pause grace period');
}

async function resumeGracePeriod(project: string, type: string): Promise<void> {
  const res = await fetch(`/api/specialists/${project}/${type}/grace/resume`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to resume grace period');
}

async function exitGracePeriod(project: string, type: string): Promise<void> {
  const res = await fetch(`/api/specialists/${project}/${type}/grace/exit`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to exit grace period');
}

export function GraceCountdown({ project, type, gracePeriod }: GraceCountdownProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  useEffect(() => {
    if (!gracePeriod.active) return;

    const calculateRemaining = () => {
      if (gracePeriod.paused && gracePeriod.remainingTime) {
        return Math.floor(gracePeriod.remainingTime / 1000);
      }

      const elapsed = Date.now() - new Date(gracePeriod.startedAt).getTime();
      const remaining = Math.max(0, Math.floor((gracePeriod.duration - elapsed) / 1000));
      return remaining;
    };

    setRemainingSeconds(calculateRemaining());

    if (gracePeriod.paused) return;

    const interval = setInterval(() => {
      const remaining = calculateRemaining();
      setRemainingSeconds(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        queryClient.invalidateQueries({ queryKey: ['project-specialists'] });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [gracePeriod, queryClient]);

  const pauseMutation = useMutation({
    mutationFn: () => pauseGracePeriod(project, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-specialists'] });
      queryClient.invalidateQueries({ queryKey: ['grace-period', project, type] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeGracePeriod(project, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-specialists'] });
      queryClient.invalidateQueries({ queryKey: ['grace-period', project, type] });
    },
  });

  const exitMutation = useMutation({
    mutationFn: () => exitGracePeriod(project, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-specialists'] });
    },
  });

  const handlePause = () => pauseMutation.mutate();
  const handleResume = () => resumeMutation.mutate();
  const handleExit = async () => {
    if (await confirm({ title: 'Terminate Specialist', message: 'Terminate specialist immediately?', variant: 'destructive', confirmLabel: 'Terminate' })) {
      exitMutation.mutate();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = (remainingSeconds / (gracePeriod.duration / 1000)) * 100;

  return (
    <div className="flex items-center gap-3 p-3 badge-bg-warning border badge-border-warning rounded-lg">
      <Clock className="w-5 h-5 text-warning" />

      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-warning">
            {gracePeriod.paused ? 'Paused' : 'Finishing in'}
          </span>
          <span className="text-lg font-mono text-foreground">{formatTime(remainingSeconds)}</span>
        </div>

        {!gracePeriod.paused && (
          <div className="w-full bg-popover rounded-full h-2">
            <div
              className="bg-warning h-2 rounded-full transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {gracePeriod.paused ? (
          <button
            onClick={handleResume}
            disabled={resumeMutation.isPending}
            className="p-2 text-warning hover:text-warning/80 hover:bg-warning/10 rounded disabled:opacity-50"
            title="Resume countdown"
          >
            <Play className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handlePause}
            disabled={pauseMutation.isPending}
            className="p-2 text-warning hover:text-warning/80 hover:bg-warning/10 rounded disabled:opacity-50"
            title="Pause countdown"
          >
            <Pause className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={handleExit}
          disabled={exitMutation.isPending}
          className="p-2 text-destructive hover:text-destructive/80 hover:bg-destructive/10 rounded disabled:opacity-50"
          title="Terminate now"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
