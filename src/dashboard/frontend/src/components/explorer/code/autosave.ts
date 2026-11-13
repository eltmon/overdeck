/**
 * Code pane autosave controller (PAN-5187, FR-7, D-C19).
 *
 * Saves 1,000 ms after the last edit, at once when the editor loses focus
 * or the user presses Ctrl/Cmd+S, and once more when the pane closes with
 * the timer still armed. No method saves a clean draft. The caller maps the
 * reason to the write: 'explicit' creates a missing file (allowMissing),
 * every other reason does not.
 */

export const AUTOSAVE_DELAY_MS = 1000;

export type AutosaveReason = 'timer' | 'blur' | 'explicit' | 'close';

export interface Autosave {
  /** An edit happened: re-arm the timer. */
  changed(): void;
  /** The editor lost focus: save now if dirty. */
  blurred(): void;
  /** Ctrl/Cmd+S: cancel the timer and save now if dirty. */
  saveNow(): void;
  /** The pane is closing: save if the timer is armed, then stop. */
  dispose(): void;
}

export function createAutosave(opts: {
  delayMs?: number;
  save: (reason: AutosaveReason) => void;
  isDirty: () => boolean;
}): Autosave {
  const delayMs = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): boolean => {
    if (timer === null) return false;
    clearTimeout(timer);
    timer = null;
    return true;
  };
  const saveIfDirty = (reason: AutosaveReason) => {
    if (opts.isDirty()) opts.save(reason);
  };

  return {
    changed() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        saveIfDirty('timer');
      }, delayMs);
    },
    blurred() {
      cancel();
      saveIfDirty('blur');
    },
    saveNow() {
      cancel();
      saveIfDirty('explicit');
    },
    dispose() {
      if (cancel()) saveIfDirty('close');
    },
  };
}
