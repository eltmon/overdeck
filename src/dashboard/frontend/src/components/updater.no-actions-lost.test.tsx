import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PAN-1223 dashboard no-loss audit', () => {
  const sidebar = readFileSync(resolve('src/components/Sidebar.tsx'), 'utf8');
  const deck = readFileSync(resolve('src/components/CommandDeck/index.tsx'), 'utf8');
  const app = readFileSync(resolve('src/App.tsx'), 'utf8');

  it.each([
    ['expanded Home navigation', sidebar, "onTabChange('home')"],
    ['collapsed Home navigation', sidebar, 'collapsed &&'],
    ['interactive expanded version', sidebar, 'VersionUpdateButton'],
    ['passive Command Deck version', deck, 'versionLabel'],
    ['desktop Help menu opens shared dialog', app, "action === 'open-updater'"],
  ])('preserves %s', (_name, source, marker) => expect(source).toContain(marker));
});
