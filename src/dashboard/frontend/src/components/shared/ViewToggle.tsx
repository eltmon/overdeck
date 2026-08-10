import styles from '../CommandDeck/styles/command-deck.module.css';

export interface ViewToggleOption<T extends string = string> {
  id: T;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface ViewToggleProps<T extends string> {
  options: ViewToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: ViewToggleProps<T>) {
  return (
    <div className={styles.viewToggle} role="tablist" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          aria-label={option.disabled && option.disabledReason
            ? `${option.label} — ${option.disabledReason}`
            : undefined}
          className={`${styles.viewToggleBtn} ${value === option.id ? styles.viewToggleBtnActive : ''}`}
          disabled={option.disabled}
          title={option.disabledReason}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
