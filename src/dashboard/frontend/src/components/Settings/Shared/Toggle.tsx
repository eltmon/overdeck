import { cn } from '../../../lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
}

export function Toggle({ checked, onChange, disabled = false, locked = false }: ToggleProps) {
  const handleClick = () => {
    if (!disabled && !locked) {
      onChange(!checked);
    }
  };

  return (
    <div
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        checked ? 'bg-[#a078f7]' : 'bg-slate-700',
        locked ? 'bg-[#a078f7]/40 cursor-not-allowed' : 'cursor-pointer',
        disabled && !locked && 'opacity-50 cursor-not-allowed'
      )}
      onClick={handleClick}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
          locked && 'bg-[#a078f7]'
        )}
      />
    </div>
  );
}
