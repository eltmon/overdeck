/**
 * PAN-4242: Claude Code 2.1.330's folder-trust dialog, captured verbatim at 120
 * columns from an isolated tmux socket. The 20 blank lines in front mimic the
 * filler of a 40-row capture. PLAIN is the dialog for an untrusted folder;
 * BACKSTOP is the one shown for a trusted worktree whose project settings
 * pre-approve tool permissions while the repository root is untrusted.
 */
const BLANK_FILLER: string[] = Array.from({ length: 20 }, () => '');

export const CLAUDE_TRUST_DIALOG_PLAIN = [
  ...BLANK_FILLER,
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  ' Accessing workspace:',
  '',
  ' /dev/shm/pan4242-plain',
  '',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  '',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n');

export const CLAUDE_TRUST_DIALOG_BACKSTOP = [
  ...BLANK_FILLER,
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  ' Accessing workspace:',
  '',
  ' /dev/shm/pan4242-wt',
  '',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  '',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  '',
  ' ⚠ This folder pre-approves 1 tool permission in .claude/settings.json:',
  '   Bash(gh issue create:*)',
  ' These will apply without asking. Only proceed if you trust this configuration.',
  '',
  ' Security guide',
  '',
  ' ❯ No, continue without these permissions',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n');
