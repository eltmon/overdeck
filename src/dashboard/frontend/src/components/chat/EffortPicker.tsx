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
  { id: 'medium', label: 'Medium (default)' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' },
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
  /** Effort level IDs available for the current model. Empty = not supported. */
  availableLevels?: readonly string[];
}

export function EffortPicker({ value, onChange, disabled = false, availableLevels }: EffortPickerProps) {
  const [open, setOpen] = useState(false);
  const [dropdownAlign, setDropdownAlign] = useState<'left' | 'right'>('left');
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // If model doesn't support effort, show a hint instead
  const noEffort = availableLevels !== undefined && availableLevels.length === 0;
  const filteredLevels = availableLevels && availableLevels.length > 0
    ? EFFORT_LEVELS.filter((e) => availableLevels.includes(e.id))
    : EFFORT_LEVELS;

  const selected = filteredLevels.find((e) => e.id === value) ?? filteredLevels[0] ?? EFFORT_LEVELS[1]!;

  // Adjust dropdown alignment if it would overflow the viewport
  useEffect(() => {
    if (!open || !dropdownRef.current || !ref.current) return;

    const dropdownRect = dropdownRef.current.getBoundingClientRect();

    // If dropdown extends past right edge of viewport, align to right
    if (dropdownRect.right > window.innerWidth - 8) {
      setDropdownAlign('right');
    } else {
      setDropdownAlign('left');
    }

    // If dropdown extends past bottom edge of viewport, open upward
    if (dropdownRect.bottom > window.innerHeight - 8) {
      setOpenUp(true);
    } else {
      setOpenUp(false);
    }
  }, [open]);

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

  if (noEffort) {
    return (
      <div className={styles.pickerContainer}>
        <span className={styles.pickerHint}>effort n/a for this model</span>
      </div>
    );
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
        <div
          ref={dropdownRef}
          className={`${styles.pickerDropdown} ${openUp ? styles.pickerDropdownUp : ''}`}
          style={dropdownAlign === 'right' ? { left: 'auto', right: 0 } : {}}
        >
          {filteredLevels.map((level) => (
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
