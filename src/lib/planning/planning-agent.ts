import { spawnAgent } from '../agents.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Planning Agent - Architecture and approach planning
 *
 * Uses work type ID: 'planning-agent'
 *
 * This agent focuses on HIGH-LEVEL planning:
 * - How should we build this?
 * - What architecture patterns to use?
 * - What technology choices are appropriate?
 * - What are the key design decisions?
 * - What are the tradeoffs?
 *
 * It does NOT break down work into tasks - that's the decomposition agent's job.
 */

export interface PlanningOptions {
  issueId: string;
  workspace: string;
  title: string;
  description?: string;
  prdPath?: string; // Path to PRD if it exists
  outputPath?: string; // Where to write STATE.md
}

export interface ArchitectureDecision {
  decision: string;
  rationale: string;
  alternatives: string[];
  tradeoffs: string;
}

export interface PlanningDocument {
  issueId: string;
  title: string;
  created: string;
  approach: string;
  architecture: string;
  technologies: string[];
  decisions: ArchitectureDecision[];
  risks: string[];
  openQuestions: string[];
}

/**
 * Generate architecture-focused planning document
 *
 * This creates a STATE.md focused on architectural approach,
 * NOT on task breakdown (that's for decomposition agent).
 */
export function generatePlanningDocument(options: PlanningOptions): string {
  const { issueId, title, description } = options;

  const sections: string[] = [
    `# Planning: ${issueId}`,
    ``,
    `**Title:** ${title}`,
    `**Created:** ${new Date().toISOString()}`,
    `**Status:** Planning`,
    ``,
    `## Issue Summary`,
    ``,
    description || '_To be filled in_',
    ``,
    `## Approach`,
    ``,
    `### High-Level Strategy`,
    `_What's the overall approach to solving this?_`,
    ``,
    `### Why This Approach`,
    `_Rationale for chosen approach_`,
    ``,
    `## Architecture`,
    ``,
    `### System Components`,
    `_What are the main components/modules involved?_`,
    ``,
    `### Data Flow`,
    `_How does data flow through the system?_`,
    ``,
    `### Integration Points`,
    `_What external systems or APIs are involved?_`,
    ``,
    `## Technology Decisions`,
    ``,
    `### Languages & Frameworks`,
    `_What technologies are we using and why?_`,
    ``,
    `### Libraries & Tools`,
    `_Key dependencies and tools_`,
    ``,
    `## Key Design Decisions`,
    ``,
    `### Decision 1: [Title]`,
    `- **Decision:** _What did we decide?_`,
    `- **Rationale:** _Why this decision?_`,
    `- **Alternatives:** _What else did we consider?_`,
    `- **Tradeoffs:** _What are we gaining/losing?_`,
    ``,
    `## Risks & Mitigations`,
    ``,
    `### Risk 1`,
    `- **Risk:** _What could go wrong?_`,
    `- **Impact:** _How bad would it be?_`,
    `- **Mitigation:** _How do we reduce/handle this?_`,
    ``,
    `## Open Questions`,
    ``,
    `- _What questions need answering before implementation?_`,
    ``,
    `## Success Criteria`,
    ``,
    `- _How do we know when this is done?_`,
    `- _What are the acceptance criteria?_`,
    ``,
    `## Next Steps`,
    ``,
    `1. Resolve open questions`,
    `2. Run decomposition agent to create task breakdown`,
    `3. Begin implementation`,
    ``,
  ];

  return sections.join('\n');
}

/**
 * Create planning document file
 */
export function createPlanningDocument(options: PlanningOptions): string {
  const { workspace, outputPath } = options;

  const planningDir = join(workspace, '.planning');
  mkdirSync(planningDir, { recursive: true });

  const docPath = outputPath || join(planningDir, 'STATE.md');

  const content = generatePlanningDocument(options);
  writeFileSync(docPath, content);

  return docPath;
}

/**
 * Spawn planning agent for interactive architecture planning
 *
 * This agent will:
 * 1. Explore the codebase to understand current architecture
 * 2. Ask clarifying questions about requirements
 * 3. Research technology options
 * 4. Make architectural decisions
 * 5. Document the approach in STATE.md
 *
 * It will NOT create task breakdowns - that's for decomposition agent.
 */
export async function spawnPlanningAgent(
  issueId: string,
  workspace: string,
  prompt?: string
) {
  const agentPrompt = prompt || `
You are a planning agent focused on ARCHITECTURE and APPROACH.

Your job is to determine HOW to build something, not WHAT tasks to create.

1. Explore the codebase:
   - Understand current architecture
   - Identify patterns and conventions
   - Find relevant files and components

2. Understand requirements:
   - Read issue description
   - Read PRD if it exists (.planning/PRD.md)
   - Ask clarifying questions if needed

3. Make architectural decisions:
   - What's the high-level approach?
   - What architecture patterns should we use?
   - What technologies/libraries are appropriate?
   - What are the key design decisions?
   - What are the tradeoffs?

4. Document in STATE.md:
   - Approach and rationale
   - Architecture overview
   - Technology decisions
   - Key design decisions with alternatives and tradeoffs
   - Risks and mitigations
   - Open questions

5. DO NOT create task breakdowns
   - That's the decomposition agent's job
   - Focus on the "how" not the "what tasks"

6. Exit plan mode when architecture is clear

Guidelines:
- Be thorough in exploration - understand before deciding
- Consider multiple approaches and document why you chose one
- Flag risks and unknowns clearly
- Make decisions that align with existing codebase patterns
- Document tradeoffs honestly
`.trim();

  return spawnAgent({
    issueId,
    workspace,
    workType: 'planning-agent',
    prompt: agentPrompt,
  });
}

/**
 * Validate planning document completeness
 *
 * Checks if key sections are filled in
 */
export function validatePlanningDocument(content: string): {
  complete: boolean;
  missingSections: string[];
  openQuestions: number;
} {
  const missingSections: string[] = [];
  let openQuestions = 0;

  // Check for required sections
  const requiredSections = [
    'Approach',
    'Architecture',
    'Technology Decisions',
    'Key Design Decisions',
  ];

  for (const section of requiredSections) {
    if (!content.includes(`## ${section}`)) {
      missingSections.push(section);
    }
  }

  // Count "To be filled in" placeholders
  const placeholderCount = (content.match(/_To be filled in/g) || []).length;
  if (placeholderCount > 2) {
    missingSections.push(`${placeholderCount} unfilled sections`);
  }

  // Count open questions
  const openQuestionsSection = content.match(/## Open Questions\s+([\s\S]*?)(?=\n##|$)/);
  if (openQuestionsSection) {
    const questionLines = openQuestionsSection[1].split('\n').filter(l => l.trim().startsWith('-'));
    openQuestions = questionLines.length;
  }

  return {
    complete: missingSections.length === 0 && openQuestions === 0,
    missingSections,
    openQuestions,
  };
}
