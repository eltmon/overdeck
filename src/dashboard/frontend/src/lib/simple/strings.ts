/**
 * PAN-2908 · C-SIMPLE §3.1.6 — simple-mode string catalog + banned-words lint.
 *
 * Simple-mode UI copy must live in this catalog (or in userFacingState.ts) and
 * must not contain internal jargon. The lint test
 * (src/lib/__tests__/simple-copy-lint.test.ts) scans both this catalog and the
 * simple components' source. Internal terms belong to Advanced mode only.
 */

/** Internal jargon that must never appear in simple-mode user-facing strings. */
export const BANNED_WORDS: RegExp[] = [
  /\bconvoy\b/i,
  /\bspecialists?\b/i,
  /\bcloister\b/i,
  /\bdeacon\b/i,
  /\bxbrief\b/i,
  /\bvbrief\b/i,
  /\bbeads?\b/i,
  /\bgates?\b/i,
  /\bUAT\b/,
  /\bflywheel\b/i,
  /\bverb badge\b/i,
  /\bpipeline phase\b/i,
  /\bdanger zone\b/i,
  /\bharness\b/i,
  /\bworkspace\b/i,
  /\btmux\b/i,
  /\bworktree\b/i,
  /\bvBRIEF\b/i,
];

export function findBannedWords(text: string): string[] {
  return BANNED_WORDS.filter((re) => re.test(text)).map((re) => re.source);
}

/**
 * Simple-mode chrome strings (section titles, hints, empty states).
 * State-specific labels live in ./userFacingState.ts and are linted too.
 */
export const SIMPLE_STRINGS = {
  home: {
    greetingFallback: 'Hello.',
    needsYouTitle: 'Needs you',
    needsYouSub: 'Work pauses until you answer. Everything else keeps going.',
    workingTitle: 'Working now',
    workingSub: "Nothing for you to do on these — you'll be told when they're ready.",
    readyTitle: 'Ready to merge',
    doneTitle: 'Finished',
    composerPlaceholder: 'Describe what you want built or fixed, in plain words…',
    composerButton: 'Hand it off',
    nothingNeedsYou: 'Nothing needs you right now. Nice.',
    quietEmpty: 'Nothing here yet.',
  },
  issue: {
    backToMyWork: '← My work',
    conversationTitle: "What it's saying and doing",
    composerPlaceholder: 'Say something to the agent… (steer it, correct it, ask why)',
    composerHint: 'Talking to it never interrupts the work — it reads you between tasks.',
    answerPlaceholder: 'Type your answer…',
    answerHint: 'One sentence is enough. It continues immediately after you answer.',
    whatHappened: 'What happened',
    advancedDisclosure: 'Advanced — the machinery behind this task',
    getHelp: 'Get help',
    steps: ['Started', 'Writing code', 'Checking', 'Ready'] as const,
  },
  mode: {
    simple: 'Simple',
    advanced: 'Advanced',
  },
} as const;
