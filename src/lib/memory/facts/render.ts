/**
 * Launch-time index for curated memory facts (PAN-3957). Nothing here is
 * stored: the index is rendered from frontmatter at every launch (store.ts
 * holds the files). Memory never breaks a launch (D9): every reader error is
 * caught and reported with console.warn, and rendering returns ''.
 */
import {
  isActiveFact,
  type MemoryFact,
  type MemoryFactScope,
  type MemoryFactType,
  projectMemoryDir,
  readMemoryFactsSync,
  userMemoryDir,
} from './store.js';

export const PROJECT_MEMORY_CHAR_BUDGET = 12_000;
export const OPERATOR_MEMORY_CHAR_BUDGET = 4_000;

const TYPE_RANK: Record<MemoryFactType, number> = { feedback: 0, project: 1, reference: 2, user: 3 };

function compareFacts(a: MemoryFact, b: MemoryFact): number {
  if (TYPE_RANK[a.type] !== TYPE_RANK[b.type]) return TYPE_RANK[a.type] - TYPE_RANK[b.type];
  if (a.updated !== b.updated) {
    if (a.updated === null) return 1;
    if (b.updated === null) return -1;
    return b.updated.localeCompare(a.updated);
  }
  return a.id.localeCompare(b.id);
}

export function renderMemoryIndexSection(input: {
  scope: MemoryFactScope;
  dir: string;
  facts: readonly MemoryFact[];
  budget: number;
}): string {
  const active = input.facts.filter(isActiveFact);
  if (active.length === 0) return '';

  const sorted = [...active].sort(compareFacts);
  const listHint = input.scope === 'user' ? 'pan memory list --user' : 'pan memory list';
  const showHint = input.scope === 'user' ? 'pan memory show --user <id>' : 'pan memory show <id>';
  const heading = input.scope === 'user' ? '## Operator memory' : '## Project memory';
  const sourceSuffix = input.scope === 'user' ? 'this machine only' : 'curated and committed with this repository';

  const header = [
    heading,
    '',
    `Source: ${input.dir} (${active.length} active facts, ${sourceSuffix})`,
    `One line per fact. Open the fact (\`${showHint}\`) before relying on its details.`,
    'Record a new durable fact with `pan memory add`; never write harness-native memory.',
    '',
  ];

  const lines: string[] = [];
  let used = header.join('\n').length + 1;
  let stopIndex = sorted.length;
  for (let i = 0; i < sorted.length; i += 1) {
    const fact = sorted[i];
    const line = `- ${fact.type}/${fact.id}: ${fact.description}`;
    if (used + line.length + 1 > input.budget - 80) {
      stopIndex = i;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const omitted = sorted.length - stopIndex;
  if (omitted > 0) lines.push(`- … ${omitted} more facts: run \`${listHint}\``);

  return [...header, ...lines].join('\n');
}

export function renderManagedMemorySections(
  projectRoot: string | null,
  opts?: { userDir?: string },
): string {
  try {
    const sections: string[] = [];

    if (projectRoot !== null) {
      const dir = projectMemoryDir(projectRoot);
      const { facts } = readMemoryFactsSync(dir, 'project');
      const section = renderMemoryIndexSection({ scope: 'project', dir, facts, budget: PROJECT_MEMORY_CHAR_BUDGET });
      if (section) sections.push(section);
    }

    const userDir = opts?.userDir ?? userMemoryDir();
    const { facts: userFacts } = readMemoryFactsSync(userDir, 'user');
    const userSection = renderMemoryIndexSection({
      scope: 'user',
      dir: userDir,
      facts: userFacts,
      budget: OPERATOR_MEMORY_CHAR_BUDGET,
    });
    if (userSection) sections.push(userSection);

    return sections.join('\n\n---\n\n');
  } catch (error) {
    console.warn(`[memory] facts unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}
