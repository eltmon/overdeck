import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  BEADS_PANEL_SECTIONS,
  ISSUE_VIEW_INVENTORY,
  SECTION_INVENTORY,
} from '../../../../src/dashboard/frontend/src/components/issue-view/inventory';
import { DENSITY_SECTIONS } from '../../../../src/dashboard/frontend/src/components/issue-view/densitySections';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/unit/dashboard/frontend/ → repo root (four directories up).
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const COCKPIT_COMPONENTS_ROOT = path.resolve(
  REPO_ROOT,
  'src/dashboard/frontend/src/components/Stage/cockpit',
);

function collectFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

interface CockpitSectionTag {
  file: string;
  tag: string;
  section: string;
  cssModuleClasses: string[];
}

function parseCockpitSectionTags(source: string, file: string): CockpitSectionTag[] {
  return [...source.matchAll(/<[^>]*data-section="[^"]+"[^>]*>/gs)].map((match) => {
    const tag = match[0];
    const section = tag.match(/data-section="([^"]+)"/)?.[1] ?? '';
    const cssModuleClasses = [...tag.matchAll(/styles\.([A-Za-z_][\w-]*)/g)]
      .map((classMatch) => classMatch[1]);
    return { file, tag, section, cssModuleClasses };
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findHiddenCockpitSectionRules(
  source: string,
  file: string,
  markers: CockpitSectionTag[],
): Array<{ file: string; selector: string; sections: string[] }> {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gs)].flatMap((match) => {
    const declarations = match[2];
    if (!/\bdisplay\s*:\s*none\b/.test(declarations)) return [];

    return match[1]
      .split(',')
      .map((candidate) => candidate.trim())
      .flatMap((selector) => {
        const sections = markers
          .filter((marker) => {
            const directMarker = new RegExp(
              `\\[data-section="${escapeRegExp(marker.section)}"\\][^\\s>+~]*$`,
            ).test(selector);
            const markerClass = marker.cssModuleClasses.some((className) => new RegExp(
              `\\.${escapeRegExp(className)}(?=[.#:\\[]|$)[^\\s>+~]*$`,
            ).test(selector));
            return directMarker || markerClass;
          })
          .map((marker) => marker.section);

        return sections.length > 0
          ? [{ file, selector, sections: [...new Set(sections)] }]
          : [];
      });
  });
}

const COCKPIT_SOURCE_FILES = [...new Set([
  ...collectFiles(COCKPIT_COMPONENTS_ROOT, '.tsx'),
  ...ISSUE_VIEW_INVENTORY
    .filter((entry) => entry.view === 'cockpit' && entry.home.endsWith('.tsx'))
    .map((entry) => path.resolve(REPO_ROOT, entry.home)),
])];

const COCKPIT_SOURCE_TAGS = COCKPIT_SOURCE_FILES
  .filter((file) => !file.endsWith('.test.tsx'))
  .flatMap((file) => parseCockpitSectionTags(
    readFileSync(file, 'utf8'),
    path.relative(REPO_ROOT, file),
  ));

const HIDDEN_COCKPIT_SECTION_RULES = collectFiles(COCKPIT_COMPONENTS_ROOT, '.css').flatMap((file) =>
  findHiddenCockpitSectionRules(
    readFileSync(file, 'utf8'),
    path.relative(REPO_ROOT, file),
    COCKPIT_SOURCE_TAGS,
  ));

/**
 * FR-0 surface-lock (PAN-2499): the complete no-loss checklist from
 * docs/design/mockups/three-issue-views-naming.html — every section the three
 * issue views render today, read straight from that mockup's "Complete
 * component inventory" refreshed after the Tasks migration and PAN-2696
 * (Console 17 + Cockpit 22 + Rail 15).
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
  'DrawerPlanPanel / XBriefViewer',
  'DrawerArtifactsPanel',
  'DrawerActivityRail / DrawerActivityPanel',
  'DrawerAgentSession',
  'StartAgentCta',
] as const;

const EXPECTED_COCKPIT_SECTIONS = [
  'Header bar',
  'NeedsYouSlot',
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
  'Session tab',
  'Changes tab',
  'Plan / Activity / Discussion tabs',
  'Cost / Artifacts / Ship homes',
  'TasksRail / TasksTab',
  'Awareness rail',
] as const;

const EXPECTED_RAIL_SECTIONS = [
  'Filter bar',
  'Feature (issue) row',
  'FeatureContextMenu (issue-row right-click)',
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

const EXPECTED_SHARED_REPLACEMENT_SECTIONS = ['beads-panel', 'beads-panel-compact'] as const;

describe('issue-view no-loss inventory (FR-0 surface-lock, PAN-2499)', () => {
  it('contains every section from the mockup no-loss checklist', () => {
    const present = new Set(ISSUE_VIEW_INVENTORY.map((entry) => entry.section));
    const missing = EXPECTED_SECTIONS.filter((name) => !present.has(name));
    expect(
      missing,
      `section(s) missing from ISSUE_VIEW_INVENTORY (surface lost): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('matches the current independent per-view counts: Console 17, Cockpit 22, Rail 15', () => {
    const byView = (view: string) => ISSUE_VIEW_INVENTORY.filter((entry) => entry.view === view).length;
    expect(byView('console')).toBe(17);
    expect(byView('cockpit')).toBe(22);
    expect(byView('rail')).toBe(15);
    expect(ISSUE_VIEW_INVENTORY.length).toBe(54);
  });

  it('keeps every cockpit density section unchanged and backed by a real visible marker', () => {
    expect(DENSITY_SECTIONS.cockpit).toEqual(EXPECTED_COCKPIT_SECTIONS);

    const missingOrHidden = DENSITY_SECTIONS.cockpit.flatMap((section) => {
      const matching = COCKPIT_SOURCE_TAGS.filter(({ tag }) => tag.includes(`data-section="${section}"`));
      const visible = matching.filter(({ tag }) => !/\bhidden(?:\s|=|>|"|')/.test(tag));
      return visible.length > 0
        ? []
        : [`${section} → ${matching.length === 0 ? 'no marker' : `hidden marker(s): ${matching.map(({ file }) => file).join(', ')}`}`];
    });

    expect(
      missingOrHidden,
      `cockpit section(s) without a real visible cockpit data-section home: ${missingOrHidden.join(', ')}`,
    ).toEqual([]);
  });

  it('does not hide cockpit section markers through direct selectors or their CSS-module classes', () => {
    expect(
      HIDDEN_COCKPIT_SECTION_RULES,
      `cockpit CSS hides required section marker(s): ${HIDDEN_COCKPIT_SECTION_RULES
        .map(({ file, selector, sections }) => `${sections.join(' / ')} via ${selector} in ${file}`)
        .join(', ')}`,
    ).toEqual([]);
  });

  it('detects class-based hiding of a marker-owning cockpit element', () => {
    const markers = parseCockpitSectionTags(
      '<div className={styles.resources} data-section="StackDrawer">',
      'AgentsLane.tsx',
    );

    expect(findHiddenCockpitSectionRules(
      ':global([data-spine-collapsed="true"]) .resources { display: none; }',
      'agentsLane.module.css',
      markers,
    )).toEqual([{
      file: 'agentsLane.module.css',
      selector: ':global([data-spine-collapsed="true"]) .resources',
      sections: ['StackDrawer'],
    }]);
  });

  it('records the physical homes and folded-surface relocations from PAN-3356', () => {
    const cockpit = ISSUE_VIEW_INVENTORY.filter((entry) => entry.view === 'cockpit');
    const homes = new Map(cockpit.map((entry) => [entry.section, entry.home]));
    const relocations = new Map(
      cockpit
        .filter((entry) => entry.actionRelocation)
        .map((entry) => [entry.section, entry.actionRelocation!.surface]),
    );
    const missionControl = 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx';

    expect(homes.get('Detail Tabs')).toBe(missionControl);
    expect(homes.get('Session tab')).toBe(missionControl);
    expect(homes.get('Changes tab')).toBe(missionControl);
    expect(homes.get('TasksRail / TasksTab')).toBe(missionControl);
    expect(homes.get('Stale-review warning')).toBe(
      'src/dashboard/frontend/src/components/Stage/cockpit/IssueTreeLane.tsx',
    );
    expect(relocations.get('Session tab')).toBe('Conversation / Files / Terminal tabs');
    expect(relocations.get('Changes tab')).toBe('Code / Files / Artifacts tabs');
    expect(relocations.get('Plan / Activity / Discussion tabs')).toBe('PRD / Timeline / Discussion tabs');
    expect(relocations.get('Cost / Artifacts / Ship homes')).toBe('Costs / Artifacts / Ship tabs');
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

  it('locks the legacy beads section family into the shared section inventory', () => {
    expect(BEADS_PANEL_SECTIONS).toEqual(EXPECTED_SHARED_REPLACEMENT_SECTIONS);
    expect(EXPECTED_SHARED_REPLACEMENT_SECTIONS.filter((section) => !SECTION_INVENTORY.includes(section))).toEqual([]);
  });
});
