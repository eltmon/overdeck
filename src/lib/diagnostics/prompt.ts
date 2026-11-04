/**
 * Prompt builder for `pan diagnose`'s launched harness session
 * (PAN-4643 FR-13, D5, D11).
 */

export function buildDiagnosePrompt(options: { bundleDir: string; issueStep: boolean }): string {
  const lines = [
    'Overdeck diagnostic session.',
    '',
    `A redacted diagnostic bundle has been collected at ${options.bundleDir}.`,
    '',
    'Do this:',
    `1. Read ${options.bundleDir}/MANIFEST.md to see what the bundle holds, what was redacted, and what collection failed.`,
    `2. Read ${options.bundleDir}/description.md for the operator's description of what went wrong.`,
    '3. Read the files MANIFEST.md lists, in the order that matters for the problem at hand.',
    `4. Follow ${options.bundleDir}/TROUBLESHOOTING.md for how Overdeck expects this kind of problem to be diagnosed.`,
    '5. Find the cause.',
    '6. If the fix is local to this machine (a config value, a missing install, a stale process), explain the change you are about to make, then make it.',
    '7. State plainly whether this is a local setup issue or an Overdeck bug.',
  ];

  if (options.issueStep) {
    lines.push(
      '8. If this looks like an Overdeck bug, draft an issue for eltmon/overdeck: a title, steps to reproduce, your findings, and short redacted excerpts from the bundle as evidence. Show the operator the full draft.',
      '9. Only after explicit confirmation from the operator in this session, run:',
      '   gh issue create --repo eltmon/overdeck --title <title> --body-file <file>',
      '   If the operator declines, do not create the issue.',
      '   If `gh` is not signed in, give the operator the draft and https://github.com/eltmon/overdeck/issues/new instead.',
    );
  } else {
    lines.push('8. Do not draft or create an upstream issue. Report your findings to the operator only.');
  }

  return `${lines.join('\n')}\n`;
}
