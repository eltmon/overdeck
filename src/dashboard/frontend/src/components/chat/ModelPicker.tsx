/**
 * ModelPicker (PAN-451)
 *
 * Dropdown for selecting the Claude model to use in a conversation.
 * Selection is persisted to localStorage.
 */

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Model definitions ────────────────────────────────────────────────────────

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

/** Effort levels supported by each model. */
export const MODEL_EFFORT_SUPPORT: Record<ClaudeModelId, readonly string[]> = {
  'claude-opus-4-6': ['low', 'medium', 'high', 'max'],
  'claude-sonnet-4-6': ['low', 'medium', 'high'],
  'claude-haiku-4-5-20251001': [],
};

const MODEL_STORAGE_KEY = 'conv-composer-model';
const DEFAULT_MODEL: ClaudeModelId = 'claude-opus-4-6';

export function loadStoredModel(): ClaudeModelId {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored && CLAUDE_MODELS.some((m) => m.id === stored)) {
      return stored as ClaudeModelId;
    }
  } catch {
    // Ignore
  }
  return DEFAULT_MODEL;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ModelPickerProps {
  value: ClaudeModelId;
  onChange: (model: ClaudeModelId) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled = false }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = CLAUDE_MODELS.find((m) => m.id === value) ?? CLAUDE_MODELS[1]!;

  // Close dropdown on outside click
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

  function handleSelect(modelId: ClaudeModelId) {
    onChange(modelId);
    localStorage.setItem(MODEL_STORAGE_KEY, modelId);
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
          {CLAUDE_MODELS.map((model) => (
            <button
              key={model.id}
              className={`${styles.pickerOption} ${model.id === value ? styles.pickerOptionActive : ''}`}
              onClick={() => handleSelect(model.id)}
              type="button"
            >
              {model.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
