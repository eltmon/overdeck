/**
 * The lane contract: the first message every gauntlet lane receives
 * (.pan/drafts/pan-4223.md WI-3 step 5, revised 2026-09-26 for D24 and FR-38).
 *
 * The text is fixed by the PRD. The critic/verifier block never names the
 * builder's conversation, so a judge stays blind (FR-38).
 */
import type { LaneRole } from '../overdeck/conversations.js';

/** The critic or verifier verdict a builder iteration answers (FR-38). */
export interface LaneAnswering {
  criticId: number;
  role: 'critic' | 'verifier';
  iteration: number;
  verdict: string;
  file: string | null;
}

export interface LaneContractInput {
  role: LaneRole;
  run: string;
  key: string;
  iteration: number;
  briefPath: string;
  cwd: string;
  /** The builder's lane branch; null for roles without one. */
  branch: string | null;
  /** The commit a critic or verifier judges; null for other roles. */
  at: string | null;
  /** Builder only: the verdict this iteration answers. */
  answering: LaneAnswering | null;
}

function roleBlock(input: LaneContractInput): string {
  switch (input.role) {
    case 'builder': {
      const block =
        `Your branch is ${input.branch}. Commit and push it as you go (pushing your own lane branch is always allowed). ` +
        'Never merge or push the default branch. Never judge your own work. A pan lane report --status done needs a clean, pushed tree.';
      const { answering } = input;
      if (!answering) return block;
      const prefix = answering.role === 'verifier' ? 'v' : 'c';
      return `${block}\nThis iteration answers ${answering.role} ${prefix}${answering.iteration} (conv #${answering.criticId}): ` +
        `${answering.verdict}. Verdict file: ${answering.file ?? 'none recorded'}.`;
    }
    case 'critic':
    case 'verifier':
      return (
        `You judge commit ${input.at}, checked out here. You are blind: you get the brief, the evidence and the reference bar, ` +
        "never the builder's reasoning. Run your own probes. Never edit, commit or push. " +
        'Your verdict is binary (WOWED / NOT_YET, or PASS / DEFECTS), never a score; every defect names a concrete fix. ' +
        'Write your verdict JSON to a file, then report once: ' +
        'pan lane report --file <report> --verdict <value> --verdict-file <verdict JSON> [--defects <n>]. ' +
        'You get one verdict; a second done report is refused.'
      );
    case 'play':
      return (
        'You are a cold player. You see only the running product named in the brief. ' +
        'Do not look for its source, docs or rules. File every point of confusion; never fix anything.'
      );
    case 'orchestrator':
      return (
        `You run a cluster. Launch builders with pan lane start (you inherit run ${input.run}); you may not launch critics. ` +
        'Keep a census in your reports; never merge the default branch.'
      );
  }
}

export function laneContract(input: LaneContractInput): string {
  return [
    `You are lane ${input.key} (${input.role}, iteration ${input.iteration}) of gauntlet run ${input.run}.`,
    `Read ${input.briefPath} FIRST and do exactly what it says. Work only in ${input.cwd}.`,
    'Rules for every lane:',
    '- Run to completion of the whole brief. Never end your turn waiting on a background task or a monitor; ' +
      'wait inside one foreground command with a timeout.',
    '- Never kill a process you did not start. Never touch the primary checkout.',
    '- When you finish, write your result as Markdown to a file and run: pan lane report --file <that file>',
    '  Use --status blocked when you need a decision (start the file with RULING, SPEND, ONE-WAY or BLOCKED), ' +
      '--status failed when the brief cannot be done.',
    roleBlock(input),
  ].join('\n');
}
