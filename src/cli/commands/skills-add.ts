/**
 * PAN-5465 WI-6 (FR-9): `pan skills add <conversation> [--pack <id>]… [--skill <id>]… [--off <id>]… [--restart]`.
 *
 * Posts to `POST /api/conversations/:name/skills` and prints the outcome in
 * one plain sentence, then each warning on its own line. `self` names the
 * conversation this command runs in; `self --restart` is refused before any
 * request, because restarting would kill the caller's own turn.
 */

export interface SkillsAddOptions {
  pack?: string[];
  skill?: string[];
  off?: string[];
  restart?: boolean;
}

type SkillApplyOutcome = 'hot' | 'sent' | 'queued' | 'needs-restart' | 'restarted' | 'next-launch';

interface SkillApplyAnswer {
  outcome: SkillApplyOutcome;
  added: string[];
  warnings: string[];
}

export const SELF_RESTART_REFUSAL = 'A conversation cannot restart itself; run this from another conversation or a terminal';

function countSkills(n: number): string {
  return `${n} ${n === 1 ? 'skill' : 'skills'}`;
}

/** The request's flags, for the `--restart` hint. */
function flagsOf(options: SkillsAddOptions): string {
  return [
    ...(options.pack ?? []).map((id) => `--pack ${id}`),
    ...(options.skill ?? []).map((id) => `--skill ${id}`),
    ...(options.off ?? []).map((id) => `--off ${id}`),
  ].join(' ');
}

/** The one-sentence answer for each outcome. */
export function skillsAddSentence(outcome: SkillApplyOutcome, added: number, conv: string, flags: string): string {
  const n = countSkills(added);
  switch (outcome) {
    case 'hot':
      return `Added ${n} to ${conv}. They are available now.`;
    case 'sent':
      return `Added ${n} to ${conv} and sent /reload-plugins; the reload was not confirmed. Check the conversation.`;
    case 'queued':
      return `Added ${n} to ${conv}. The reload runs when its current turn ends.`;
    case 'needs-restart':
      return `Saved ${n} on ${conv}. This conversation must restart to load them: pan skills add ${conv} --restart ${flags} (it resumes with its history).`;
    case 'restarted':
      return `Added ${n} to ${conv} and resumed it.`;
    case 'next-launch':
      return `Saved ${n} on ${conv}. They load when it resumes.`;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export async function skillsAddCommand(conversation: string, options: SkillsAddOptions): Promise<void> {
  let name = conversation;
  if (conversation === 'self') {
    if (options.restart) fail(SELF_RESTART_REFUSAL);
    const { resolveCurrentConversation } = await import('../../lib/conversations/current.js');
    const current = await resolveCurrentConversation();
    if (!current) fail('Not inside a conversation; name one');
    name = current.name;
  }

  const { dashboardBaseUrl } = await import('./fork-client.js');
  const base = dashboardBaseUrl();
  const body = {
    ...(options.pack?.length ? { packs: options.pack } : {}),
    ...(options.skill?.length ? { skills: options.skill } : {}),
    ...(options.off?.length ? { off: options.off } : {}),
    ...(options.restart ? { restart: true } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${base}/api/conversations/${encodeURIComponent(name)}/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
  } catch {
    fail(`Could not reach the Overdeck dashboard at ${base}. Start it with pan up.`);
  }
  const data = (await res.json().catch(() => null)) as (SkillApplyAnswer & { error?: string }) | null;
  if (!res.ok || !data) fail(data?.error ?? `The dashboard answered ${res.status}`);

  console.log(skillsAddSentence(data.outcome, data.added.length, name, flagsOf(options)));
  for (const warning of data.warnings) console.log(warning);
}
