import {
  COMPOSER_COMMAND_MANIFEST,
  type ComposerCommandManifestEntry,
  type ComposerCommandPolicy,
} from '@overdeck/contracts';

export const COMPOSER_COMMAND_POLICIES: Readonly<Record<string, ComposerCommandPolicy>> = {
  start: { mode: 'detached', safety: 'safe' },
  plan: { mode: 'detached', safety: 'safe' },
  show: { mode: 'captured', safety: 'safe' },
  status: { mode: 'captured', safety: 'safe' },
  tell: { mode: 'captured', safety: 'safe' },
  handoff: { mode: 'ui', safety: 'dialog', uiAction: 'handoff' },
  fork: { mode: 'ui', safety: 'dialog', uiAction: 'fork' },
};

const DEFAULT_POLICY: ComposerCommandPolicy = {
  mode: 'terminal-only',
  safety: 'safe',
};

export function assertPolicyOverlayIntegrity(
  policies: Readonly<Record<string, ComposerCommandPolicy>> = COMPOSER_COMMAND_POLICIES,
  manifest: readonly ComposerCommandManifestEntry[] = COMPOSER_COMMAND_MANIFEST,
): void {
  for (const path of Object.keys(policies)) {
    const matches = manifest.filter(entry => entry.path.join(' ') === path);
    if (matches.length !== 1) {
      throw new Error(
        `Composer command policy path "${path}" must match exactly one manifest entry; found ${matches.length}.`,
      );
    }
  }
}

export function resolvePolicy(path: readonly string[]): ComposerCommandPolicy {
  return COMPOSER_COMMAND_POLICIES[path.join(' ')] ?? DEFAULT_POLICY;
}

assertPolicyOverlayIntegrity();
