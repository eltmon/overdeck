import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * PAN-4455 D-15: which conversations this browser handed off, and when. A
 * hand-off is an operator act, not derivable state, so it lives per browser.
 * The composer notice shows only while the session is alive; seeing the
 * conversation stopped clears its entry.
 */

interface HandoffNoticeStore {
  notices: Record<string, { at: string }>;
  record: (name: string, at: string) => void;
  clear: (name: string) => void;
}

export const useHandoffNoticeStore = create<HandoffNoticeStore>()(
  persist(
    (set) => ({
      notices: {},
      record: (name, at) => set((state) => ({ notices: { ...state.notices, [name]: { at } } })),
      clear: (name) => set((state) => {
        if (!(name in state.notices)) return state;
        const { [name]: _removed, ...rest } = state.notices;
        return { notices: rest };
      }),
    }),
    { name: 'overdeck:handoff-notices', storage: createJSONStorage(() => localStorage) },
  ),
);

export function useHandoffNotice(conversation: { name: string; sessionAlive: boolean }): { at: string } | null {
  const notice = useHandoffNoticeStore((state) => state.notices[conversation.name] ?? null);
  const clear = useHandoffNoticeStore((state) => state.clear);
  const stopped = notice !== null && !conversation.sessionAlive;
  useEffect(() => {
    if (stopped) clear(conversation.name);
  }, [stopped, clear, conversation.name]);
  return conversation.sessionAlive ? notice : null;
}
