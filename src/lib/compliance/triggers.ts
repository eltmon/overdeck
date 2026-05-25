export interface MemoryFirstTrigger {
  id: string;
  pattern: RegExp;
}

export interface MemoryFirstTriggerMatch {
  triggerId: string;
  phrase: string;
  index: number;
}

export const MEMORY_FIRST_TRIGGERS: readonly MemoryFirstTrigger[] = [
  { id: 'we-recently', pattern: /\bwe\s+recently\b/gi },
  { id: 'last-session', pattern: /\blast\s+session\b/gi },
  { id: 'we-decided', pattern: /\bwe\s+decided\b/gi },
  { id: 'remember-when', pattern: /\bremember\s+when\b/gi },
  { id: 'the-fix', pattern: /\bthe\s+[a-z0-9][a-z0-9_-]*(?:\s+[a-z0-9][a-z0-9_-]*){0,4}\s+fix\b/gi },
];

export function matchMemoryFirstTriggers(prompt: string): MemoryFirstTriggerMatch[] {
  const matches: MemoryFirstTriggerMatch[] = [];

  for (const trigger of MEMORY_FIRST_TRIGGERS) {
    const pattern = new RegExp(trigger.pattern.source, trigger.pattern.flags);
    for (const match of prompt.matchAll(pattern)) {
      if (match.index === undefined) continue;
      matches.push({
        triggerId: trigger.id,
        phrase: match[0],
        index: match.index,
      });
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

export function matchMemoryFirstTriggerPhrases(prompt: string): string[] {
  return matchMemoryFirstTriggers(prompt).map((match) => match.phrase);
}
