/**
 * PAN-2908 · C-SIMPLE — "Talk it through" composer.
 *
 * Retired (PAN-4280, D8): the composer that used to live here is now
 * HomeComposer (components/home/HomeComposer.tsx), mounted on both Homes.
 * This file only re-exports seedDiscussPrompt so existing imports keep
 * working; its logic lives in components/home/homeComposerIntents.ts.
 */
export { seedDiscussPrompt } from '../home/homeComposerIntents';
