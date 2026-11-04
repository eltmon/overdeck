import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import viteConfig from '../../vite.config';

describe('phone app build config', () => {
  it('dedupes React and React Query so frontend source shares one copy', () => {
    expect(viteConfig.resolve?.dedupe).toEqual(
      expect.arrayContaining(['react', 'react-dom', '@tanstack/react-query']),
    );
  });

  it('aliases contracts, events and sodium-native to files that exist', () => {
    const aliases = viteConfig.resolve?.alias as Array<{ find: RegExp; replacement: string }>;
    expect(aliases.map((alias) => alias.find.source)).toEqual([
      '^@overdeck\\/contracts$',
      '^events$',
      '^sodium-native$',
    ]);
    for (const alias of aliases) expect(existsSync(alias.replacement), alias.replacement).toBe(true);
  });
});
