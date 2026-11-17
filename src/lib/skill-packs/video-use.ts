/**
 * The `video-use` mount transform (PAN-5464 D-9, D-10).
 *
 * video-use's main skill is a root SKILL.md whose helpers are Python scripts. The mount inserts a host
 * notice into that SKILL.md and writes `requirements.txt` from the skill's `pyproject.toml`, so an agent
 * runs the helpers through `uv run --no-project --with-requirements` and nothing writes into the
 * read-only mount. Only the skill named `video-use` is changed; other skills of the pack copy verbatim.
 */
import { parse as parseToml } from '@iarna/toml';

/** Bump when the notice or the generated files change, so mounts built with the old contract are rebuilt. */
export const VIDEO_USE_NOTICE_VERSION = 1;

export const VIDEO_USE_HOST_NOTICE = [
  '> **Overdeck host notice.** This skill directory is read-only. Never write `.env`, `.venv` or any file here.',
  '> - Read `ELEVENLABS_API_KEY` from the environment. If it is missing, ask the operator with the `request_secret` tool. Never write the key to a file.',
  '> - Run helpers with `uv run --no-project --with-requirements <this dir>/requirements.txt python <this dir>/helpers/<script>.py …`.',
  '> - Skip the `install.md` steps that clone the repo and register the skill: Overdeck already installed this skill. Still check that `ffmpeg` and `uv` are on `PATH`.',
].join('\n');

const HOST_NOTICE_MARKER = `<!-- overdeck:video-use-host-notice v${VIDEO_USE_NOTICE_VERSION} -->`;

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /^---[ \t]*$/m;

/**
 * Insert the host notice after the SKILL.md frontmatter (or at the top when there is none). Idempotent:
 * a SKILL.md that already holds the marker is returned unchanged. The frontmatter is never rewritten.
 */
export function applyVideoUseHostNotice(skillMd: string): string {
  if (skillMd.includes(HOST_NOTICE_MARKER)) return skillMd;
  const notice = `${HOST_NOTICE_MARKER}\n${VIDEO_USE_HOST_NOTICE}\n`;
  const open = skillMd.match(FRONTMATTER_OPEN)?.[0];
  const rest = open === undefined ? '' : skillMd.slice(open.length);
  const close = open === undefined ? null : rest.match(FRONTMATTER_CLOSE);
  if (open === undefined || !close || close.index === undefined) return `${notice}\n${skillMd}`;
  const frontmatter = rest.slice(0, close.index);
  const after = rest.slice(close.index + close[0].length);
  return `${open}${frontmatter}${close[0]}\n${notice}${after}`;
}

/** `[project].dependencies` of a pyproject.toml, one per line with a trailing newline; '' when absent. */
export function requirementsFromPyproject(toml: string): string {
  const project = parseToml(toml)['project'];
  if (!project || typeof project !== 'object' || Array.isArray(project)) return '';
  const dependencies = (project as Record<string, unknown>)['dependencies'];
  if (!Array.isArray(dependencies)) return '';
  const lines = dependencies.filter((dependency): dependency is string => typeof dependency === 'string');
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
