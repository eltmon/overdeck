/**
 * The composer's / menu lists installed skills as /<name> commands for
 * harnesses that run a typed /<skill> (PAN-5347, `skillSlashCommands`
 * capability). The list is scoped to the open conversation's own launch
 * context (cwd, issue) and per-conversation overrides, resolved server-side
 * by GET /api/skills/overrides?conversation=&cwd=&issue= (PAN-5347 WI-2).
 *
 * The composer's $ menu (PAN-5662) lists the same skills on harnesses that
 * declare `skillMention`; useSkillMentionCommands shares the fetch below.
 */
import { useEffect, useRef, useState } from 'react';
import { getHarnessBehavior, type HarnessName } from '@overdeck/contracts';
import type { SlashCommand } from './slashCommandTypes';

export const SKILLS_CATEGORY = 'Skills';

/**
 * Names the dashboard control plane intercepts before they ever reach a
 * composer insert: `/pan` and `/pan-handoff` are caught by ComposerFooter's
 * `isPortableCommand` test, and `/handoff` opens the dashboard's own handoff
 * dialog (see STATIC_SLASH_COMMANDS in slashCommands.ts). Listing a skill
 * under these names would shadow that handling, so they never appear here.
 */
export const COMPOSER_INTERCEPTED_SKILL_NAMES: ReadonlySet<string> = new Set(['pan', 'pan-handoff', 'handoff']);

export const EMPTY_SKILL_COMMANDS = Object.freeze([]) as readonly SlashCommand[];

export interface SkillSlashContext {
  conversationName?: string;
  cwd?: string;
  issueId?: string;
}

/**
 * Structural param (no `Conversation` import): a linked or vault-browse row
 * never launches, so it has no skill scope; otherwise a real conversation
 * (positive id) contributes its name, and any cwd/issue contribute theirs.
 * `undefined` when neither a conversation name nor a cwd apply.
 */
export function skillContextForConversation(conv: {
  id: number;
  name: string;
  cwd: string;
  issueId: string | null;
  origin?: string;
}): SkillSlashContext | undefined {
  if (conv.origin === 'linked' || conv.origin === 'vault') return undefined;
  const conversationName = conv.id > 0 ? conv.name : undefined;
  const cwd = conv.cwd || undefined;
  if (!conversationName && !cwd) return undefined;
  return { conversationName, cwd, issueId: conv.issueId ?? undefined };
}

/** Only the fields set on `context` become query params. */
export function skillContextQuery(context: SkillSlashContext): URLSearchParams {
  const params = new URLSearchParams();
  if (context.conversationName) params.set('conversation', context.conversationName);
  if (context.cwd) params.set('cwd', context.cwd);
  if (context.issueId) params.set('issue', context.issueId);
  return params;
}

interface SkillOverridesResponseLike {
  skills: ReadonlyArray<{ name: string; description?: string; enabled: boolean }>;
}

/** Every enabled, non-intercepted catalog skill (core included), sorted by name. */
export function toSkillSlashCommands(body: SkillOverridesResponseLike): SlashCommand[] {
  return body.skills
    .filter(skill => skill.enabled && !COMPOSER_INTERCEPTED_SKILL_NAMES.has(skill.name))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(skill => ({
      id: `skill-${skill.name}`,
      label: `/${skill.name}`,
      description: skill.description ?? '',
      insert: `/${skill.name} `,
      category: SKILLS_CATEGORY,
    }));
}

export async function fetchSkillSlashCommands(context: SkillSlashContext, signal?: AbortSignal): Promise<SlashCommand[]> {
  const query = skillContextQuery(context);
  const response = await fetch(`/api/skills/overrides?${query.toString()}`, { signal });
  if (!response.ok) throw new Error(`GET /api/skills/overrides failed: ${response.status}`);
  return toSkillSlashCommands(await response.json());
}

export interface UseSkillSlashCommandsOptions {
  harness: HarnessName;
  context: SkillSlashContext | undefined;
  /** The composer's / menu is open and showing this context's commands. */
  active: boolean;
}

/**
 * Plain fetch, not React Query: the / menu is a rare, user-driven open, not
 * a polled surface. Fetches once per false→true transition of `active`,
 * keeping the previous list (or EMPTY_SKILL_COMMANDS) on failure; resets to
 * EMPTY_SKILL_COMMANDS whenever the context's query key changes.
 */
function useSkillCommandsFetch(capable: boolean, context: SkillSlashContext | undefined, active: boolean): readonly SlashCommand[] {
  const key = context ? skillContextQuery(context).toString() : '';
  const enabled = key !== '' && capable;
  const [commands, setCommands] = useState<readonly SlashCommand[]>(EMPTY_SKILL_COMMANDS);
  const wasActiveRef = useRef(false);
  const warnedRef = useRef(false);

  useEffect(() => {
    setCommands(EMPTY_SKILL_COMMANDS);
  }, [key]);

  useEffect(() => {
    if (!enabled) {
      wasActiveRef.current = active;
      return;
    }
    const justActivated = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (!justActivated || !context) return;

    const controller = new AbortController();
    fetchSkillSlashCommands(context, controller.signal)
      .then(setCommands)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (warnedRef.current) return;
        warnedRef.current = true;
        console.warn('[skillSlashCommands] skills unavailable:', error);
      });
    return () => controller.abort();
    // `context` is intentionally omitted: `key` already encodes its value.
  }, [active, enabled, key]);

  return enabled ? commands : EMPTY_SKILL_COMMANDS;
}

export function useSkillSlashCommands({ harness, context, active }: UseSkillSlashCommandsOptions): readonly SlashCommand[] {
  return useSkillCommandsFetch(getHarnessBehavior(harness).capabilities.skillSlashCommands, context, active);
}

/**
 * The $ menu's skills (PAN-5662): the same `/`-shaped skill commands, fetched
 * only on harnesses that declare a `skillMention` form. The caller maps them
 * to the harness's insert form with toSkillMentionItems.
 */
export function useSkillMentionCommands({ harness, context, active }: UseSkillSlashCommandsOptions): readonly SlashCommand[] {
  return useSkillCommandsFetch(getHarnessBehavior(harness).capabilities.skillMention !== null, context, active);
}
