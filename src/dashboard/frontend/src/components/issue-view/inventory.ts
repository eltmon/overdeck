/**
 * Issue-view no-loss inventory (PAN-2499).
 *
 * The FR-0 surface-lock gate asserts that every named section in this manifest
 * appears as a `data-section` attribute on at least one rendered element across
 * the three issue-view densities. Add a section here BEFORE rendering it.
 */

export const AGENT_ROW_SECTIONS = [
  'agent-row-caret',
  'agent-row-icon',
  'agent-row-label',
  'agent-row-model',
  'agent-row-status',
  'agent-row-duration',
  'agent-row-cost',
  'agent-row-verdict',
  'agent-row-context-menu',
  'agent-row-paused-reason',
] as const;

export type AgentRowSection = (typeof AGENT_ROW_SECTIONS)[number];

/** Full inventory of all issue-view sections that participate in the no-loss gate. */
export const SECTION_INVENTORY: readonly string[] = [
  ...AGENT_ROW_SECTIONS,
  // placeholder for future wave-1/wave-2 sections; add here as they land
];
