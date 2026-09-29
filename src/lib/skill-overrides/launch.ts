/**
 * Apply skill overrides to a managed launch (PAN-3942).
 *
 * The launcher runs `pan skills launch-settings` before the harness starts.
 * Claude Code gets `--settings '{"skillOverrides":{...:"off"}}'`; Codex gets
 * `[[skills.config]] enabled = false` blocks in the per-agent config.toml.
 * Both hide skills by name, so every copy of a skill hides.
 *
 * Skill packs (PAN-4334) are mounted, not hidden: the same step builds the
 * content-addressed mount for the enabled pack skills and points the Claude
 * plugin link or the Codex `overdeck-packs` block at it. It reads only the
 * pack cache; it never runs git or touches the network.
 *
 * The bash the launcher runs is built in `./launcher-lines.ts`, a leaf module,
 * so launcher-generator.ts never reaches this module or the store. The store
 * and project resolution load lazily inside resolveLaunchDisabledSkills.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MountSelection } from '../skill-packs/mount.js';

export interface LaunchSkillContext {
  cwd: string;
  issueId?: string;
}

export const CODEX_SKILL_BLOCK_BEGIN = '# overdeck:skill-overrides:begin';
export const CODEX_SKILL_BLOCK_END = '# overdeck:skill-overrides:end';

/** Issue from ctx or the workspace path, project from the cwd. */
async function resolveLaunchScope(ctx: LaunchSkillContext): Promise<{ projectKey?: string; issueId?: string }> {
  const [{ resolveProjectKeyForCwdAsync }, { issueIdFromWorkspacePath }] = await Promise.all([
    import('../projects.js'),
    import('../xbrief/io.js'),
  ]);
  const issueId = ctx.issueId ?? issueIdFromWorkspacePath(ctx.cwd) ?? undefined;
  const projectKey = (await resolveProjectKeyForCwdAsync(ctx.cwd)) ?? undefined;
  return { projectKey, issueId };
}

/** Skill names the launch should hide. */
export async function resolveLaunchDisabledSkills(ctx: LaunchSkillContext): Promise<string[]> {
  const [{ loadSkillOverrideLayers }, { disabledSkillNames }] = await Promise.all([
    import('./store.js'),
    import('./resolve.js'),
  ]);
  return disabledSkillNames(await loadSkillOverrideLayers(await resolveLaunchScope(ctx)));
}

/**
 * The pack skills enabled for this launch, from the cached extraction of each
 * pack's trusted commit. PD-4: a pack whose commit is not cached is skipped,
 * with a warning when anything in it would have been on.
 */
export async function resolveLaunchPackSelection(
  ctx: LaunchSkillContext,
): Promise<{ selection: MountSelection; warnings: string[] }> {
  const [{ loadSkillOverrideLayers }, { resolvePackSkill, resolvePackToggle }, { listPackCatalog }, { packExtractDir }] =
    await Promise.all([
      import('./store.js'),
      import('./resolve.js'),
      import('./catalog.js'),
      import('../skill-packs/sources.js'),
    ]);
  const [layers, packs] = await Promise.all([loadSkillOverrideLayers(await resolveLaunchScope(ctx)), listPackCatalog()]);
  const selection: MountSelection = { packs: [] };
  const warnings: string[] = [];
  for (const pack of packs) {
    if (!pack.manifest) {
      const perSkillOn = [layers.global, layers.project, layers.issue].some(map =>
        Object.entries(map ?? {}).some(([id, enabled]) => enabled && id.startsWith(`${pack.id}/`)));
      if (perSkillOn || resolvePackToggle(pack.id, layers).enabled) {
        warnings.push(`[launcher] WARNING: skill pack ${pack.id} not cached; run pan skills pack sync ${pack.id}`);
      }
      continue;
    }
    const skills = pack.manifest.skills
      .filter(skill => resolvePackSkill(`${pack.id}/${skill.name}`, skill.optIn, layers).enabled)
      .map(skill => ({ name: skill.name, dir: skill.dir }));
    if (skills.length > 0) {
      selection.packs.push({ id: pack.id, commit: pack.commit, root: packExtractDir(pack.id, pack.commit), skills });
    }
  }
  return { selection, warnings };
}

/** Build the mount and point the Claude plugin link at it (or remove the link). Returns warnings. */
export async function applyClaudePacks(ctx: LaunchSkillContext, link: string): Promise<string[]> {
  const { buildMount, linkClaudeMount } = await import('../skill-packs/mount.js');
  const { selection, warnings } = await resolveLaunchPackSelection(ctx);
  await linkClaudeMount(link, await buildMount(selection));
  return warnings;
}

/** Build the mount and write the Codex pack block and plugin cache (or remove them). Returns warnings. */
export async function applyCodexPacks(ctx: LaunchSkillContext, codexHome: string): Promise<string[]> {
  const { buildMount, writeCodexPackBlock } = await import('../skill-packs/mount.js');
  const { selection, warnings } = await resolveLaunchPackSelection(ctx);
  await writeCodexPackBlock(codexHome, await buildMount(selection));
  return warnings;
}

/** The `--settings` JSON for Claude Code, or '' when nothing is hidden. */
export function claudeSkillSettingsJson(disabled: readonly string[]): string {
  if (disabled.length === 0) return '';
  return JSON.stringify({ skillOverrides: Object.fromEntries(disabled.map(name => [name, 'off'])) });
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripSkillBlock(content: string): string {
  const begin = content.indexOf(CODEX_SKILL_BLOCK_BEGIN);
  if (begin === -1) return content;
  const end = content.indexOf(CODEX_SKILL_BLOCK_END, begin);
  const after = end === -1 ? content.length : end + CODEX_SKILL_BLOCK_END.length;
  return stripSkillBlock(content.slice(0, begin) + content.slice(after));
}

/** Replace the managed skill block in `<codexHome>/config.toml`. Idempotent. */
export async function writeCodexSkillOverrides(codexHome: string, disabled: readonly string[]): Promise<void> {
  const path = join(codexHome, 'config.toml');
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const base = stripSkillBlock(existing).trimEnd();
  const block = disabled.length === 0 ? '' : [
    CODEX_SKILL_BLOCK_BEGIN,
    ...disabled.flatMap(name => ['[[skills.config]]', `name = "${escapeTomlBasicString(name)}"`, 'enabled = false']),
    CODEX_SKILL_BLOCK_END,
  ].join('\n');
  const next = [base, block].filter(Boolean).join('\n\n');
  await mkdir(codexHome, { recursive: true });
  await writeFile(path, next ? `${next}\n` : '', { mode: 0o600 });
  await chmod(path, 0o600);
}
