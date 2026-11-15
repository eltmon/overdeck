/**
 * newConversationDefaults — the model, harness and effort a quick-created
 * conversation uses (PAN-5293 F-D12, moved from CommandDeck's header picker
 * state). One store, so the deck's launchers and the New conversation button
 * agree on the values.
 */

import { create } from 'zustand';
import { loadStoredHarness, loadStoredModel, onKnownModelsSync } from '../../chat/ModelPicker';
import { loadStoredEffort, type EffortLevel } from '../../chat/EffortPicker';
import type { Harness } from '../../shared/ModelPicker';

export interface NewConversationDefaults {
  model: string;
  harness: Harness;
  effort: EffortLevel;
  setModel: (model: string) => void;
  setHarness: (harness: Harness) => void;
  setEffort: (effort: EffortLevel) => void;
}

export const useNewConversationDefaults = create<NewConversationDefaults>((set) => ({
  model: loadStoredModel(),
  harness: loadStoredHarness(),
  effort: loadStoredEffort(),
  setModel: (model) => set({ model }),
  setHarness: (harness) => set({ harness }),
  setEffort: (effort) => set({ effort }),
}));

// The initial loadStoredModel above runs before the picker's catalog fetch
// completes, when only FALLBACK ids are "known" — a stored catalog-only id
// (kimi-code/*, OpenRouter favorites) fails isKnownModel and the composer
// shows the default instead. Re-derive once the catalog syncs. Every explicit
// pick writes localStorage, so re-deriving always reflects the user's latest
// choice and can never clobber a manual pick.
onKnownModelsSync(() => {
  const restored = loadStoredModel();
  if (restored !== useNewConversationDefaults.getState().model) {
    useNewConversationDefaults.setState({ model: restored });
  }
});
