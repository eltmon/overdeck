/**
 * gstack skill map (PAN-4727 WI-O1): the versioned classification of every
 * gstack skill, the skills the `gstack-runtime` adapter mounts, and the
 * constants of the fork's pack-mode contract (docs/pack-mode.md in
 * eltmon/gstack).
 *
 * A skill name that is not in the map (a newer trusted commit added it) is
 * excluded as unreviewed and never mounted, so a pack update mounts nothing
 * new until the map is reviewed.
 *
 * Leaf module: nothing here imports from `src/lib/`.
 */

export type GstackSkillClass = 'default' | 'opt-in' | 'excluded' | 'needs-binary';

export interface GstackSkillEntry {
  class: GstackSkillClass;
  reason: string;
}

export const GSTACK_SKILL_MAP_VERIFIED_AT = {
  repo: 'eltmon/gstack',
  commit: '1cac25cb8eb1b394136e98ab76ecd2b8fcec458e',
  version: '1.92.33.0',
} as const;

const READS_CODE = 'Reads code, writes reports to the state root or chat.';
const READS_CODE_HOOKS = `${READS_CODE} Its frontmatter hooks allow by default.`;
const NEEDS_BINARY = 'Calls $B, $D or $P, which pack mode does not build (PAN-4730).';
const BLOCKING_HOOKS = 'Skill hooks that block tool calls.';
const PAID_APIS = 'Calls paid model APIs.';

export const GSTACK_SKILL_MAP: Readonly<Record<string, GstackSkillEntry>> = {
  'context-restore': { class: 'default', reason: READS_CODE },
  'context-save': { class: 'default', reason: READS_CODE },
  'deslop-shared-libs': { class: 'default', reason: READS_CODE },
  'design-motion': { class: 'default', reason: READS_CODE },
  diagram: { class: 'default', reason: READS_CODE },
  health: { class: 'default', reason: READS_CODE },
  investigate: { class: 'default', reason: READS_CODE_HOOKS },
  'ios-clean': { class: 'default', reason: READS_CODE },
  'ios-design-review': { class: 'default', reason: READS_CODE },
  'ios-fix': { class: 'default', reason: READS_CODE },
  'ios-qa': { class: 'default', reason: READS_CODE },
  'ios-sync': { class: 'default', reason: READS_CODE },
  'landing-report': { class: 'default', reason: READS_CODE },
  learn: { class: 'default', reason: READS_CODE },
  'plan-ceo-review': { class: 'default', reason: READS_CODE_HOOKS },
  'plan-devex-review': { class: 'default', reason: READS_CODE },
  'plan-eng-review': { class: 'default', reason: READS_CODE },
  retro: { class: 'default', reason: READS_CODE },
  review: { class: 'default', reason: READS_CODE },
  'test-audit': { class: 'default', reason: READS_CODE },
  verify: { class: 'default', reason: READS_CODE },
  'write-skill': { class: 'default', reason: READS_CODE },

  autoplan: { class: 'opt-in', reason: 'Its hooks deny Read and Agent, and it runs Codex outside voices.' },
  'benchmark-models': { class: 'opt-in', reason: PAID_APIS },
  captain: { class: 'opt-in', reason: 'Runs merge trains.' },
  careful: { class: 'opt-in', reason: BLOCKING_HOOKS },
  codex: { class: 'opt-in', reason: 'Sends code to OpenAI.' },
  cso: { class: 'opt-in', reason: 'Pulls Docker images.' },
  'document-generate': { class: 'opt-in', reason: 'Runs git push.' },
  'document-release': { class: 'opt-in', reason: 'Publishes docs after ship.' },
  'eval-plan': { class: 'opt-in', reason: PAID_APIS },
  freeze: { class: 'opt-in', reason: BLOCKING_HOOKS },
  guard: { class: 'opt-in', reason: BLOCKING_HOOKS },
  modernize: { class: 'opt-in', reason: 'Pushes branches and opens PRs.' },
  ubicloud: { class: 'opt-in', reason: 'Creates cloud VMs.' },
  unfreeze: { class: 'opt-in', reason: BLOCKING_HOOKS },

  'connect-chrome': { class: 'excluded', reason: 'Symlink alias; symlinked skills are never mounted.' },
  'gstack-upgrade': { class: 'excluded', reason: 'Runs git reset --hard on the install; Overdeck pins commits.' },
  'plan-tune': { class: 'excluded', reason: "Needs setup's PreToolUse/PostToolUse hooks, which pack mode does not install." },
  'setup-deploy': { class: 'excluded', reason: 'Edits CLAUDE.md and needs $B.' },
  'setup-gbrain': { class: 'excluded', reason: 'Runs claude mcp add and edits CLAUDE.md.' },
  'sync-gbrain': { class: 'excluded', reason: 'Edits CLAUDE.md and pushes the brain repo.' },

  benchmark: { class: 'needs-binary', reason: NEEDS_BINARY },
  browse: { class: 'needs-binary', reason: NEEDS_BINARY },
  canary: { class: 'needs-binary', reason: NEEDS_BINARY },
  'design-consultation': { class: 'needs-binary', reason: NEEDS_BINARY },
  'design-html': { class: 'needs-binary', reason: NEEDS_BINARY },
  'design-review': { class: 'needs-binary', reason: NEEDS_BINARY },
  'design-shotgun': { class: 'needs-binary', reason: NEEDS_BINARY },
  'devex-review': { class: 'needs-binary', reason: NEEDS_BINARY },
  'land-and-deploy': { class: 'needs-binary', reason: NEEDS_BINARY },
  'make-pdf': { class: 'needs-binary', reason: NEEDS_BINARY },
  'office-hours': { class: 'needs-binary', reason: NEEDS_BINARY },
  'open-gstack-browser': { class: 'needs-binary', reason: NEEDS_BINARY },
  'pair-agent': { class: 'needs-binary', reason: NEEDS_BINARY },
  'plan-design-review': { class: 'needs-binary', reason: NEEDS_BINARY },
  qa: { class: 'needs-binary', reason: NEEDS_BINARY },
  'qa-only': { class: 'needs-binary', reason: NEEDS_BINARY },
  scrape: { class: 'needs-binary', reason: NEEDS_BINARY },
  'setup-browser-cookies': { class: 'needs-binary', reason: NEEDS_BINARY },
  ship: { class: 'needs-binary', reason: NEEDS_BINARY },
  skillify: { class: 'needs-binary', reason: NEEDS_BINARY },
  spec: { class: 'needs-binary', reason: NEEDS_BINARY },
};

function namesOf(...classes: GstackSkillClass[]): readonly string[] {
  return Object.entries(GSTACK_SKILL_MAP)
    .filter(([, entry]) => classes.includes(entry.class))
    .map(([name]) => name)
    .sort();
}

/** Skills the `gstack-runtime` adapter mounts: classes `default` and `opt-in`, sorted. */
export const GSTACK_MOUNTED_SKILLS: readonly string[] = namesOf('default', 'opt-in');

/** Mounted skills the pack toggle never turns on; each needs its own per-skill `on`. */
export const GSTACK_OPT_IN_SKILLS: readonly string[] = namesOf('opt-in');

const UNREVIEWED: GstackSkillEntry = { class: 'excluded', reason: 'unreviewed' };

export function classifyGstackSkill(name: string): GstackSkillEntry {
  return Object.hasOwn(GSTACK_SKILL_MAP, name) ? GSTACK_SKILL_MAP[name]! : UNREVIEWED;
}

/** At the fork's repo root; a commit without `{"packMode": 1}` cannot be added. */
export const GSTACK_PACK_MODE_FILE = 'pack-mode.json';
/** Written last by pack mode; a render is ready only when it holds `packMode: 1`. */
export const GSTACK_RENDER_MARKER = '.gstack-pack.json';
export const GSTACK_PACK_MODE_VERSION = 1;
/** Covered by the mount hash; bump when the render contract or the map's mounted set changes meaning. */
export const GSTACK_RENDER_VERSION = 1;

export const GSTACK_DISCLOSURE =
  "Runs gstack's bash and bun scripts from ~/.overdeck/packs/gstack; telemetry and update checks are off. Opt-in skills can send code to OpenAI (codex) or call paid or cloud APIs.";
