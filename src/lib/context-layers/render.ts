/** Harness-specific rendering of canonical Overdeck context layers. */

import type { Harness } from '@overdeck/contracts';
import { loadConfigSync } from '../config-yaml.js';
import { renderForHarness } from './harness.js';
import { disabledRuleNames, renderBundledRules } from './rules.js';
import { globalContextFile, readLayerContent, resolveProjectContextFile } from './layers.js';

/** Render machine context plus bundled rules for a managed harness launch. */
export function renderGlobalLayer(harness: Harness, includeDevRules: boolean): string {
  const layer = renderForHarness(readLayerContent(globalContextFile()), harness).trim();
  const rules = renderBundledRules(harness, includeDevRules, configDisabledRuleNames());
  return [layer, rules].filter((section) => section.length > 0).join('\n\n---\n\n');
}

/** Resolve config-disabled bundled rules; a broken config disables nothing. */
export function configDisabledRuleNames(): Set<string> {
  try {
    return disabledRuleNames(loadConfigSync().config.context);
  } catch {
    return new Set();
  }
}

/** Render one project's canonical source for a managed harness launch. */
export function renderProjectLayer(projectRoot: string, harness: Harness | readonly Harness[]): string {
  const raw = readLayerContent(resolveProjectContextFile(projectRoot));
  if (raw.trim().length === 0) return '';
  return renderForHarness(raw, harness).trim();
}
