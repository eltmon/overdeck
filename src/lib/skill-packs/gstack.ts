/**
 * gstack skill map (PAN-4727 WI-O1, PAN-4730): the versioned classification
 * of every gstack skill, the skills the `gstack-runtime` adapter mounts, and
 * the constants of the fork's pack-mode and pack-browser contracts
 * (docs/pack-mode.md in eltmon/gstack).
 *
 * `browser` and `browser-opt-in` skills call gstack's browse, design or
 * make-pdf binaries ($B/$D/$P); they mount only once the operator consented to
 * the browser runtime and it is built. `browser-opt-in` ones also need a
 * per-skill `on`.
 *
 * A skill name that is not in the map (a newer trusted commit added it) is
 * excluded as unreviewed and never mounted, so a pack update mounts nothing
 * new until the map is reviewed.
 *
 * Leaf module: nothing here imports from `src/lib/`.
 */

export type GstackSkillClass = 'default' | 'opt-in' | 'browser' | 'browser-opt-in' | 'excluded';

export interface GstackSkillEntry {
  class: GstackSkillClass;
  reason: string;
}

export const GSTACK_SKILL_MAP_VERIFIED_AT = {
  repo: 'eltmon/gstack',
  commit: '1b778f78602ae4793f426164a9ff49fafbd83157',
  version: '1.92.33.0',
} as const;

const READS_CODE = 'Reads code, writes reports to the state root or chat.';
const READS_CODE_HOOKS = `${READS_CODE} Its frontmatter hooks allow by default.`;
const BROWSER = "Calls gstack's browser or PDF binaries; mounted once the browser runtime is built.";
const PAID_IMAGE_APIS = 'Calls paid image APIs (OpenAI or Gemini).';
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

  'open-gstack-browser': { class: 'excluded', reason: 'Opens a visible browser and writes ~/.gstack/.auth.json.' },
  'pair-agent': { class: 'excluded', reason: 'Exposes the browser through an ngrok tunnel and writes ~/.codex.' },
  'setup-browser-cookies': { class: 'excluded', reason: 'Reads your real browser cookies and keychain.' },

  benchmark: { class: 'browser', reason: BROWSER },
  browse: { class: 'browser', reason: BROWSER },
  'devex-review': { class: 'browser', reason: BROWSER },
  'make-pdf': { class: 'browser', reason: BROWSER },
  qa: { class: 'browser', reason: BROWSER },
  'qa-only': { class: 'browser', reason: BROWSER },
  scrape: { class: 'browser', reason: BROWSER },
  skillify: { class: 'browser', reason: BROWSER },
  spec: { class: 'browser', reason: BROWSER },

  canary: { class: 'browser-opt-in', reason: 'Post-deploy monitoring; opt-in like the deploy skills.' },
  'design-consultation': { class: 'browser-opt-in', reason: PAID_IMAGE_APIS },
  'design-html': { class: 'browser-opt-in', reason: PAID_IMAGE_APIS },
  'design-review': { class: 'browser-opt-in', reason: PAID_IMAGE_APIS },
  'design-shotgun': { class: 'browser-opt-in', reason: PAID_IMAGE_APIS },
  'land-and-deploy': { class: 'browser-opt-in', reason: 'Merges PRs and deploys.' },
  'office-hours': { class: 'browser-opt-in', reason: 'Calls paid image APIs and Codex.' },
  'plan-design-review': { class: 'browser-opt-in', reason: PAID_IMAGE_APIS },
  ship: { class: 'browser-opt-in', reason: 'Pushes branches and cuts releases.' },
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

/** Skills mounted only with the built browser runtime: classes `browser` and `browser-opt-in`, sorted. */
export const GSTACK_BROWSER_SKILLS: readonly string[] = namesOf('browser', 'browser-opt-in');

/** Browser skills the pack toggle never turns on; each needs its own per-skill `on`. */
export const GSTACK_BROWSER_OPT_IN_SKILLS: readonly string[] = namesOf('browser-opt-in');

/** Excluded reason for a browser skill while the browser runtime is not on. */
export const GSTACK_BROWSER_NEEDED = 'Needs the browser runtime: pan skills pack browser gstack on';

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
export const GSTACK_RENDER_VERSION = 3;

/** Written last by the fork's pack-browser step; the browser runtime is ready only when it holds `packBrowser: 1`. */
export const GSTACK_BROWSER_MARKER = '.gstack-pack-browser.json';
export const GSTACK_PACK_BROWSER_VERSION = 1;

export const GSTACK_DISCLOSURE =
  "Runs gstack's bash and bun scripts from ~/.overdeck/packs/gstack; telemetry and update checks are off. Opt-in skills can send code to OpenAI (codex) or call paid or cloud APIs. The optional browser runtime downloads npm packages and Chromium into ~/.overdeck/packs/gstack/browser.";
