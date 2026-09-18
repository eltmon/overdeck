/** Protect native instruction paths while allowing ordinary workspace assets. */
import { basename, isAbsolute, normalize } from 'node:path';

export function isHarnessNativeTarget(target: string): boolean {
  const slash = target.replace(/\\/g, '/');
  const path = normalize(slash).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (isAbsolute(slash) || path === '..' || path.startsWith('../')) return true;
  if (new Set([
    'claude.md', 'claude.local.md', 'agents.md', 'agents.override.md',
    'gemini.md', 'conventions.md', '.cursorrules', '.windsurfrules', '.clinerules',
    'copilot-instructions.md',
  ]).has(basename(path))) return true;
  return /(?:^|\/)(?:\.claude\/rules|\.cursor\/rules|\.windsurf\/rules|\.clinerules|\.github\/instructions)(?:\/|$)/.test(path);
}
