import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ISSUE_VIEW_INVENTORY } from '../../../../src/dashboard/frontend/src/components/issue-view/inventory';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/unit/dashboard/frontend/ → repo root (four directories up).
const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * FR-0 surface-lock (PAN-2499): the complete no-loss checklist from
 * docs/design/mockups/three-issue-views-naming.html — every section the three
 * issue views render today, read straight from that mockup's "Complete
 * component inventory" refreshed after the Tasks migration and PAN-2696
 * (Console 17 + Cockpit 21 + Rail 14).
 *
 * These names are hardcoded INDEPENDENTLY of inventory.ts on purpose: the whole
 * point of the gate is that removing a manifest entry — silently dropping a
 * surface on the eve of the Issue View unification — turns the build red. If
 * the mockup grows a section, add it here AND in the manifest in the same
 * change; the two lists must agree.
 */
const EXPECTED_CONSOLE_SECTIONS = [
  'DrawerActionBar',
  'PhaseTimeline',
  'DrawerTabs',
  'DrawerPickupSection / PickupGateControls',
  'DrawerWorkspaceSection',
  'UatEnvironmentPanel',
  'IssuePolicyStrip / PoliciesControl',
  'DrawerActiveAgent',
  'DrawerPausedBanner',
  'DrawerVerificationGates',
  'DrawerReviewSpecialists',
  'DrawerTasksList',
  'DrawerPlanPanel / VBriefViewer',
  'DrawerArtifactsPanel',
  'DrawerActivityRail / DrawerActivityPanel',
  'DrawerAgentSession',
  'StartAgentCta',
] as const;

const EXPECTED_COCKPIT_SECTIONS = [
  'Header bar',
  'Stale-review warning',
  'StatusNarrative',
  'Pipeline Band',
  'AgentsLane',
  'SessionPanel',
  'StackDrawer',
  'Detail Tabs',
  'CrewStage',
  'UatEnvironmentPanel',
  'HappenedFeed',
  'NowPanel',
  'PickupGateCard',
  'PlanMapCard',
  'IssueBlockerSpotlight',
  'Code tab',
  'PRD / Timeline / Discussion tabs',
  'Costs / Artifacts / Ship tabs',
  'Conversation / Files / Terminal tabs',
  'TasksRail / TasksTab',
  'Awareness rail',
] as const;

const EXPECTED_RAIL_SECTIONS = [
  'Filter bar',
  'Feature (issue) row',
  'Badges',
  'MergeButton',
  'Pipeline pips',
  'ResourceStrip',
  'SessionNode',
  'SessionNode context menu',
  'ReviewGroup',
  'ShipDoorTreeRow',
  'Conversation rows',
  'StackDrawer / UatStackTreeGroup',
  'ResourcesGroup',
  'ModelResolutionCard',
] as const;

const EXPECTED_SECTIONS = [
  ...EXPECTED_CONSOLE_SECTIONS,
  ...EXPECTED_COCKPIT_SECTIONS,
  ...EXPECTED_RAIL_SECTIONS,
] as const;

describe('issue-view no-loss inventory (FR-0 surface-lock, PAN-2499)', () => {
  it('contains every section from the mockup no-loss checklist', () => {
    const present = new Set(ISSUE_VIEW_INVENTORY.map((entry) => entry.section));
    const missing = EXPECTED_SECTIONS.filter((name) => !present.has(name));
    expect(
      missing,
      `section(s) missing from ISSUE_VIEW_INVENTORY (surface lost): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('matches the current independent per-view counts: Console 17, Cockpit 21, Rail 14', () => {
    const byView = (view: string) => ISSUE_VIEW_INVENTORY.filter((entry) => entry.view === view).length;
    expect(byView('console')).toBe(17);
    expect(byView('cockpit')).toBe(21);
    expect(byView('rail')).toBe(14);
    expect(ISSUE_VIEW_INVENTORY.length).toBe(52);
  });

  it('has no duplicate section names within a density', () => {
    const names = ISSUE_VIEW_INVENTORY.map((entry) => `${entry.view}:${entry.section}`);
    expect(new Set(names).size, `duplicate density sections: ${names.join(', ')}`).toBe(names.length);
  });

  it('every manifest home path exists on disk (deleting a home without re-homing turns the build red)', () => {
    const missing = ISSUE_VIEW_INVENTORY
      .filter((entry) => !existsSync(path.resolve(REPO_ROOT, entry.home)))
      .map((entry) => `${entry.section} → ${entry.home}`);
    expect(
      missing,
      `home path(s) that do not exist on disk (re-home the section before removing its component): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every home path is repo-relative and points inside the frontend components tree', () => {
    const outOfTree = ISSUE_VIEW_INVENTORY
      .filter((entry) => !entry.home.startsWith('src/dashboard/frontend/src/components/'))
      .map((entry) => `${entry.section} → ${entry.home}`);
    expect(outOfTree, `home path(s) outside the frontend components tree: ${outOfTree.join(', ')}`).toEqual([]);
  });

  it('every inventory section has a real rendered JSX marker', () => {
    const componentsRoot = path.resolve(REPO_ROOT, 'src/dashboard/frontend/src/components');
    const sources = readdirSync(componentsRoot, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
      .map((file) => readFileSync(path.join(componentsRoot, file), 'utf8'))
      .join('\n');
    const renderedSectionAttributes = [...sources.matchAll(/data-section=(?:"[^"]*"|\{[^}]*\})/gs)]
      .map(([attribute]) => attribute)
      .join('\n');
    const missing = EXPECTED_SECTIONS.filter(
      (section) => !renderedSectionAttributes.includes(`"${section}"`) &&
        !renderedSectionAttributes.includes(`'${section}'`),
    );
    expect(
      missing,
      `section(s) declared but not rendered with a data-section marker under ${componentsRoot}: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
