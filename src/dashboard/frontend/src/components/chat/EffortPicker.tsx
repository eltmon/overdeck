/**
 * EffortPicker (PAN-451)
 *
 * Selector for effort level (low/medium/high/max) to pass as --effort flag.
 * Selection is persisted to localStorage.
 */

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Effort definitions ───────────────────────────────────────────────────────

const EFFORT_LEVELS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number]['id'];

const EFFORT_STORAGE_KEY = 'conv-composer-effort';
const DEFAULT_EFFORT: EffortLevel = 'medium';

export function loadStoredEffort(): EffortLevel {
  try {
    const stored = localStorage.getItem(EFFORT_STORAGE_KEY);
    if (stored && EFFORT_LEVELS.some((e) => e.id === stored)) {
      return stored as EffortLevel;
    }
  } catch {
    // Ignore
  }
  return DEFAULT_EFFORT;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface EffortPickerProps {
  value: EffortLevel;
  onChange: (effort: EffortLevel) => void;
  disabled?: boolean;
}

export function EffortPicker({ value, onChange, disabled = false }: EffortPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = EFFORT_LEVELS.find((e) => e.id === value) ?? EFFORT_LEVELS[1]!;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSelect(effort: EffortLevel) {
    onChange(effort);
    localStorage.setItem(EFFORT_STORAGE_KEY, effort);
    setOpen(false);
  }

  return (
    <div ref={ref} className={styles.pickerContainer}>
      <button
        className={styles.pickerBtn}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        type="button"
      >
        <span className={styles.pickerLabel}>{selected.label}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div className={styles.pickerDropdown}>
          {EFFORT_LEVELS.map((level) => (
            <button
              key={level.id}
              className={`${styles.pickerOption} ${level.id === value ? styles.pickerOptionActive : ''}`}
              onClick={() => handleSelect(level.id)}
              type="button"
            >
              {level.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
