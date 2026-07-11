export type StackAction = 'start' | 'stop' | 'pause';
export type ServiceAction = 'start' | 'stop' | 'pause' | 'unpause' | 'restart';

interface ActionButtonProps {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'default' | 'danger';
}

export function ActionButton({ label, busy = false, disabled = false, onClick, tone = 'default' }: ActionButtonProps) {
  const toneClass = tone === 'danger'
    ? 'border-destructive text-destructive'
    : 'border-border text-foreground';
  return (
    <button
      type="button"
      className={`border px-2 py-1 font-['DM_Mono'] text-xs uppercase disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
      disabled={disabled || busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {busy ? 'Working' : label}
    </button>
  );
}
