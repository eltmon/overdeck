import { Square, Loader2 } from 'lucide-react';
import { useKillAgent } from '../hooks/useKillAgent';

interface StopAgentButtonProps {
  agentId: string | undefined;
  onSuccess?: () => void;
  variant: 'card' | 'inspector';
  className?: string;
}

export function StopAgentButton({ agentId, onSuccess, variant, className }: StopAgentButtonProps) {
  const { confirmAndKill, isPending } = useKillAgent(agentId, { onSuccess });

  const handleClick = async (e: React.MouseEvent) => {
    if (variant === 'card') {
      e.stopPropagation();
    }
    await confirmAndKill();
  };

  if (variant === 'inspector') {
    return (
      <button
        onClick={handleClick}
        disabled={isPending}
        className={className ?? 'flex items-center gap-1 px-2 py-1 text-xs text-destructive rounded badge-bg-destructive hover:bg-destructive/20'}
      >
        <Square className="w-3 h-3" />
        {isPending ? 'Stopping...' : 'Stop'}
      </button>
    );
  }

  // card variant
  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={className ?? 'flex items-center text-xs text-destructive-foreground hover:text-destructive-foreground/80 transition-colors disabled:opacity-50'}
      title="Stop"
    >
      {isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Square className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
