import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * roles/plan.md is the single home of "how to plan"; the planning session
 * message (src/lib/cloister/prompts/planning.md) carries only issue inputs and
 * the two JSON formats. These tests keep the two files from drifting back into
 * duplication.
 */

const planning = readFileSync(join(process.cwd(), 'src/lib/cloister/prompts/planning.md'), 'utf-8');
const role = readFileSync(join(process.cwd(), 'roles/plan.md'), 'utf-8');

function headingTexts(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => /^#{2,3}\s/.test(line))
    .map((line) => line.replace(/^#{2,3}\s+/, '').trim().toLowerCase());
}

function linesOutsideCodeFences(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

describe('planner context: planning.md and roles/plan.md do not duplicate', () => {
  it('shares no ## or ### heading text', () => {
    const planningHeadings = new Set(headingTexts(planning));
    const duplicates = headingTexts(role).filter((heading) => planningHeadings.has(heading));
    expect(duplicates).toEqual([]);
  });

  it('documents the TLDR PreToolUse hook in exactly one of the two files', () => {
    const needle = 'TLDR is wired in as a PreToolUse hook';
    expect([planning, role].filter((text) => text.includes(needle))).toHaveLength(1);
  });

  it('contains no legacy .pan planner spec/continue paths', () => {
    for (const text of [planning, role]) {
      expect(text).not.toContain('.pan/spec.vbrief.json');
      expect(text).not.toContain('.pan/continue.json');
    }
  });

  it('names no model tiers outside code fences', () => {
    for (const text of [planning, role]) {
      const hits = linesOutsideCodeFences(text).filter((line) => /\b(haiku|sonnet|opus)\b/i.test(line));
      expect(hits).toEqual([]);
    }
  });
});
