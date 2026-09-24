/** Harness-specific rendering of canonical Overdeck context layers. */

import type { Harness } from '@overdeck/contracts';
import { loadConfigSync } from '../config-yaml.js';
import { renderForHarness } from './harness.js';
import { disabledRuleNames, renderBundledRules } from './rules.js';
import { globalContextFile, readLayerContent, resolveProjectContextFile } from './layers.js';

/** Render machine context plus bundled rules for a managed harness launch. */
export function renderGlobalLayer(harness: Harness, includeDevRules: boolean): string {
  const source = globalContextFile();
  const body = renderForHarness(readLayerContent(source), harness).trim();
  const layer = body ? `## Machine context\n\nSource: ${source}\n\n${body}` : '';
  const rules = renderBundledRules(harness, includeDevRules, configDisabledRuleNames());
  const sections = [layer, rules].filter((section) => section.length > 0);
  return sections.length > 0
    ? `# Overdeck managed instructions\n\nThis is a generated composition. Each section identifies its own source; the machine-context file is only one input.\n\n${sections.join('\n\n---\n\n')}`
    : '';
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
  const source = resolveProjectContextFile(projectRoot);
  const raw = readLayerContent(source);
  if (raw.trim().length === 0) return '';
  const body = renderForHarness(raw, harness).trim();
  return body ? `## Project context\n\nSource: ${source}\n\n${body}` : '';
}
