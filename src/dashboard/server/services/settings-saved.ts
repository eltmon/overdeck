/**
 * Side effects a saved settings.yaml write should re-apply immediately,
 * kept out of settings.ts so that file stays under its line-count cap.
 */
import { refreshHostTools } from '../../../lib/host-tools.js';
import { refreshTtsRuntimeConfig } from './tts-runtime-config.js';
import { syncTtsPlaybackWithConfig } from './tts-playback.js';
import { syncConversationSearchWatcher } from './conversation-search-watcher.js';

export async function applySavedSettings(): Promise<void> {
  await refreshTtsRuntimeConfig();
  await syncTtsPlaybackWithConfig();
  await syncConversationSearchWatcher();
  refreshHostTools(); // PAN-5168: a settings save re-checks optional host tools
}
