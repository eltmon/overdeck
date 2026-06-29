import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SettingsConfig, VoiceSettings } from '../types';
import { invalidateAvailableModelsCache } from '../../shared/ModelPicker';

/**
 * Debounce window for autosaves driven by high-frequency inputs (text fields,
 * sliders). Click-style controls (toggles, selects, radios) save immediately.
 */
export const AUTOSAVE_DEBOUNCE_MS = 600;

/** One pending autosave: the full settings + voice payload, latest-wins. */
export interface AutosavePayload {
  settings: SettingsConfig;
  voiceSettings: VoiceSettings;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutosavePipelineArgs {
  queryClient: QueryClient;
  saveSettings: (settings: SettingsConfig) => Promise<{ warnings?: string[] }>;
  saveVoiceSettings: (settings: VoiceSettings) => Promise<VoiceSettings>;
}

export function useAutosavePipeline({
  queryClient,
  saveSettings,
  saveVoiceSettings,
}: UseAutosavePipelineArgs) {
  // Every control persists on change through one serialized latest-wins queue:
  // rapid edits collapse into the newest snapshot, saves never overlap, and
  // text inputs debounce so half-typed values don't hit the server.
  const pendingSaveRef = useRef<AutosavePayload | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloisterSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveOkRef = useRef(true);
  const savedStatusResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const markSaved = useCallback(() => {
    lastSaveOkRef.current = true;
    setSaveStatus('saved');
    if (savedStatusResetRef.current) clearTimeout(savedStatusResetRef.current);
    savedStatusResetRef.current = setTimeout(() => {
      savedStatusResetRef.current = null;
      setSaveStatus((s) => (s === 'saved' ? 'idle' : s));
    }, 2500);
  }, []);

  const markSaveError = useCallback(() => {
    lastSaveOkRef.current = false;
    setSaveStatus('error');
  }, []);

  // Drain the autosave queue: one save in flight at a time, always taking the
  // newest pending snapshot. Returns the in-flight drain so callers can await
  // a flush (e.g. before triggering a paid reindex).
  const drainSaveQueue = useCallback((): Promise<void> => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const run = (async () => {
      while (pendingSaveRef.current) {
        const snapshot = pendingSaveRef.current;
        pendingSaveRef.current = null;
        setSaveStatus('saving');
        try {
          const [response, savedVoiceSettings] = await Promise.all([
            saveSettings(snapshot.settings),
            saveVoiceSettings(snapshot.voiceSettings),
          ]);
          invalidateAvailableModelsCache();
          queryClient.invalidateQueries({ queryKey: ['settings'] });
          queryClient.invalidateQueries({ queryKey: ['conversation-search-status'] });
          queryClient.setQueryData(['voice-settings'], savedVoiceSettings);
          queryClient.invalidateQueries({ queryKey: ['tracker-status'] });
          if (response.warnings && response.warnings.length > 0) {
            response.warnings.forEach((warning) => {
              toast.warning(warning, { duration: 8000 });
            });
          }
          markSaved();
        } catch (error) {
          markSaveError();
          toast.error(`Failed to save settings: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
    saveInFlightRef.current = run.finally(() => {
      saveInFlightRef.current = null;
    });
    return saveInFlightRef.current;
  }, [markSaveError, markSaved, queryClient, saveSettings, saveVoiceSettings]);

  // Schedule an autosave of the given snapshot. Click-style controls save
  // immediately; text inputs and sliders pass debounce to wait for typing to
  // pause. A newer schedule always supersedes the pending snapshot.
  const scheduleAutosave = useCallback((payload: AutosavePayload, opts: { debounce?: boolean } = {}) => {
    pendingSaveRef.current = payload;
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }
    if (opts.debounce) {
      saveDebounceRef.current = setTimeout(() => {
        saveDebounceRef.current = null;
        void drainSaveQueue();
      }, AUTOSAVE_DEBOUNCE_MS);
    } else {
      void drainSaveQueue();
    }
  }, [drainSaveQueue]);

  // Force any pending (possibly debounced) save through and report whether the
  // final save succeeded. Used by flows that must persist before acting.
  const flushAutosave = useCallback(async (): Promise<boolean> => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }
    await drainSaveQueue();
    return lastSaveOkRef.current;
  }, [drainSaveQueue]);

  // On unmount, flush any debounced edit immediately so navigating away
  // doesn't drop the last change (the fetch survives SPA navigation).
  useEffect(() => () => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
      void drainSaveQueue();
    }
    if (cloisterSaveDebounceRef.current) clearTimeout(cloisterSaveDebounceRef.current);
    if (savedStatusResetRef.current) clearTimeout(savedStatusResetRef.current);
  }, [drainSaveQueue]);

  return {
    cloisterSaveDebounceRef,
    flushAutosave,
    markSaveError,
    markSaved,
    saveStatus,
    scheduleAutosave,
    setSaveStatus,
  };
}
