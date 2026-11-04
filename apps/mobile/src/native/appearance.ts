/** The `OverdeckAppearance` native plugin (PAN-5041): stores the appearance natively and applies it to native chrome. */
import { registerPlugin, WebPlugin } from '@capacitor/core';

import type { Appearance } from '../shell/appearance';

export interface OverdeckAppearancePlugin {
  set(options: { appearance: Appearance }): Promise<void>;
}

/** Browser stand-in (development only): nothing native to apply. */
class OverdeckAppearanceWeb extends WebPlugin {
  async set(): Promise<void> {}
}

export const OverdeckAppearance = registerPlugin<OverdeckAppearancePlugin>('OverdeckAppearance', {
  web: () => new OverdeckAppearanceWeb(),
});
