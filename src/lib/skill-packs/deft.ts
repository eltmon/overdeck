/**
 * Deft Directive skill map (PAN-3943 WI-1): the versioned classification of
 * every Deft skill, the read-only allowlist the `deft-readonly` adapter
 * mounts, and the host notice the mount inserts into each mounted SKILL.md.
 *
 * This replaces the PAN-791 mapping (Deft v0.20.0-rc.3). A skill name that is
 * not in the map (a newer pinned commit added it) is excluded as unreviewed
 * and never mounted.
 *
 * Nothing here imports `src/lib/skill-overrides/` or `src/lib/deft/`: the
 * adapter and the mount depend on this module (PAN-3943 NFR-7).
 */

export type DeftSkillClass = 'compatible' | 'translated' | 'conflicting' | 'runtime-dependent' | 'excluded';

export interface DeftSkillEntry {
  class: DeftSkillClass;
  reason: string;
  /** Overdeck skill that owns the same job; set for every `conflicting` entry. */
  overdeck?: string;
}

/** Deft skill directories are `content/skills/deft-directive-<name>/`. */
export const DEFT_SKILL_PREFIX = 'deft-directive-';
export const DEFT_SKILLS_DIR = 'content/skills';

export const DEFT_SKILL_MAP_VERIFIED_AT = {
  repo: 'eltmon/directive',
  commit: '48e8cbf0e7818a2b2ca60a070791e236ca088ac0',
  describe: 'v0.119.10-16',
} as const;

export const DEFT_SKILL_MAP: Readonly<Record<string, DeftSkillEntry>> = {
  glossary: {
    class: 'compatible',
    reason: 'Conversation-only glossary extraction; the host notice tells it not to write UBIQUITOUS_LANGUAGE.md unless asked.',
  },
  debug: {
    class: 'translated',
    reason: 'task verify:investigation is unavailable; report the investigation ledger in chat.',
  },
  'design-critique': {
    class: 'translated',
    reason: 'task issue:ingest is unavailable; the next step is pan issues or the operator.',
  },
  'gh-arch': {
    class: 'translated',
    reason: "task slice:record is unavailable; file follow-ups through Overdeck's tracker.",
  },
  'write-skill': {
    class: 'translated',
    reason: 'New skills go to <project>/.pan/skills/<name>/SKILL.md (Overdeck project skills), not the Deft tree.',
  },
  probe: {
    class: 'translated',
    reason: 'Never writes xbrief/proposed/; results go to chat; Overdeck owns xBRIEF in .pan/specs.',
  },
  cost: {
    class: 'translated',
    reason: 'Reads xbrief/PROJECT-DEFINITION.xbrief.json only when present; never creates it.',
  },
  xbrief: { class: 'conflicting', reason: 'Authors Deft xbrief/ plans; Overdeck owns the pipeline xBRIEF.', overdeck: 'write-xbrief' },
  swarm: { class: 'conflicting', reason: 'Runs Deft parallel agents; Overdeck owns swarms.', overdeck: 'pan-swarm' },
  release: { class: 'excluded', reason: 'Releases the deft framework itself.' },
  'pre-pr': { class: 'conflicting', reason: 'Deft pre-PR gate; Overdeck owns completion.', overdeck: 'work-complete' },
  'review-cycle': { class: 'conflicting', reason: 'Deft review loop; Overdeck owns review.', overdeck: 'pan-code-review' },
  refinement: { class: 'conflicting', reason: 'Deft refinement; Overdeck owns planning.', overdeck: 'pan-plan' },
  decompose: { class: 'conflicting', reason: 'Deft decomposition into xbrief/; Overdeck owns plan items.', overdeck: 'write-xbrief' },
  'gh-slice': { class: 'conflicting', reason: 'Deft issue slicing; Overdeck owns planning.', overdeck: 'pan-plan' },
  build: { class: 'conflicting', reason: 'Deft build loop; Overdeck owns work sessions.', overdeck: 'pan-start' },
  setup: { class: 'conflicting', reason: 'Runs directive init.', overdeck: 'pan-new-project' },
  sync: { class: 'conflicting', reason: 'Runs an npm refresh of the deposit.', overdeck: 'pan-sync' },
  triage: { class: 'excluded', reason: 'Withdrawn upstream (#4070).' },
  interview: { class: 'runtime-dependent', reason: 'Needs deft interview state.' },
  'issue-eval': { class: 'runtime-dependent', reason: 'Needs Deft Stage A tooling.' },
  'portfolio-priority': { class: 'runtime-dependent', reason: 'Needs Deft triage/RFC state.' },
  'product-signal': {
    class: 'runtime-dependent',
    reason: 'Consent and upload flow owned by Deft; also an upload surface.',
  },
  feedback: { class: 'runtime-dependent', reason: 'Escalates gaps through Deft tooling.' },
  'article-review': { class: 'runtime-dependent', reason: "Feeds Deft's improvement backlog." },
};

/** Skills the `deft-readonly` adapter mounts: classes `compatible` and `translated`, sorted. */
export const DEFT_READONLY_SKILLS: readonly string[] = Object.entries(DEFT_SKILL_MAP)
  .filter(([, entry]) => entry.class === 'compatible' || entry.class === 'translated')
  .map(([name]) => name)
  .sort();

const UNREVIEWED: DeftSkillEntry = { class: 'excluded', reason: 'unreviewed' };

export function classifyDeftSkill(name: string): DeftSkillEntry {
  return Object.hasOwn(DEFT_SKILL_MAP, name) ? DEFT_SKILL_MAP[name]! : UNREVIEWED;
}

export const DEFT_HOST_NOTICE_VERSION = 1;

const OVERDECK_EQUIVALENTS = Object.entries(DEFT_SKILL_MAP)
  .filter(([, entry]) => entry.class === 'conflicting')
  .map(([name, entry]) => `${name} → ${entry.overdeck}`)
  .join(', ');

export const DEFT_HOST_NOTICE = [
  '> **Overdeck host notice**',
  '>',
  "> This skill is loaded from Overdeck's read-only Deft pack.",
  '> Do not run directive init, directive update, directive bootstrap, or deft session:start.',
  '> Do not install packages, change git hooks or core.hooksPath, edit AGENTS.md, or write under xbrief/.',
  '> Overdeck owns planning (.pan/specs), worktrees, review, and merge.',
  '> When a step names a task or deft command that is not installed, skip it and report the result in chat.',
  '> Do not write files in the repository unless the operator asks for a file.',
  '>',
  `> Deft skills and their Overdeck equivalents: ${OVERDECK_EQUIVALENTS}.`,
].join('\n');

const HOST_NOTICE_MARKER = `<!-- overdeck:deft-host-notice v${DEFT_HOST_NOTICE_VERSION} -->`;

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /^---[ \t]*$/m;
const NAME_LINE = /^name:.*$/m;

/**
 * Rewrite a Deft SKILL.md for the mount: set the frontmatter `name:` to the
 * stripped name (so the harness registers `deft:<name>`) and insert the host
 * notice after the frontmatter. Idempotent: when the notice marker is already
 * present, only the `name:` fix is applied.
 */
export function applyDeftHostNotice(skillMd: string, name: string): string {
  const open = skillMd.match(FRONTMATTER_OPEN)?.[0];
  const rest = open === undefined ? '' : skillMd.slice(open.length);
  const close = open === undefined ? null : rest.match(FRONTMATTER_CLOSE);
  if (open === undefined || !close || close.index === undefined) {
    return applyDeftHostNotice(`---\nname: ${name}\n---\n${skillMd}`, name);
  }

  const frontmatter = rest.slice(0, close.index);
  const after = rest.slice(close.index + close[0].length);
  const renamed = NAME_LINE.test(frontmatter)
    ? frontmatter.replace(NAME_LINE, `name: ${name}`)
    : `name: ${name}\n${frontmatter}`;

  const body = after.includes(HOST_NOTICE_MARKER) ? after : `\n${HOST_NOTICE_MARKER}\n${DEFT_HOST_NOTICE}\n${after}`;
  return `${open}${renamed}${close[0]}${body}`;
}
