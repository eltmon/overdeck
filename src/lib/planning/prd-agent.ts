import { spawnAgent } from '../agents.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * PRD Agent - Q&A-driven Product Requirement Document generation
 *
 * Uses work type ID: 'prd-agent'
 *
 * This agent guides users through a structured interview to create
 * comprehensive PRD documents before implementation begins.
 */

export interface PRDSection {
  heading: string;
  content: string;
}

export interface PRDGenerationOptions {
  issueId: string;
  workspace: string;
  title: string;
  description?: string;
  outputPath?: string;
}

export interface PRDDocument {
  issueId: string;
  title: string;
  created: string;
  sections: PRDSection[];
}

/**
 * Generate PRD document through Q&A workflow
 *
 * This spawns an agent with work type 'prd-agent' which will:
 * 1. Interview the user about requirements
 * 2. Ask clarifying questions about scope, approach, constraints
 * 3. Generate structured PRD document
 * 4. Save to .planning/PRD.md
 */
export async function generatePRD(options: PRDGenerationOptions): Promise<string> {
  const { issueId, workspace, title, description, outputPath } = options;

  // Determine output location
  const planningDir = join(workspace, '.planning');
  mkdirSync(planningDir, { recursive: true });

  const prdPath = outputPath || join(planningDir, 'PRD.md');

  // Create initial PRD structure
  const prdContent = generatePRDTemplate(issueId, title, description);

  // Write initial PRD
  writeFileSync(prdPath, prdContent);

  // Spawn PRD agent to expand and refine
  // Note: This is a library function - actual spawning would be done by CLI
  // For now, return the path where PRD should be created
  return prdPath;
}

/**
 * Generate PRD template with standard sections
 */
function generatePRDTemplate(issueId: string, title: string, description?: string): string {
  const sections: string[] = [
    `# Product Requirements Document: ${issueId}`,
    ``,
    `**Title:** ${title}`,
    `**Created:** ${new Date().toISOString()}`,
    `**Status:** Draft`,
    ``,
    `## Overview`,
    ``,
    description || '_To be filled in by PRD agent_',
    ``,
    `## Goals & Objectives`,
    ``,
    `### Primary Goals`,
    `- _What are we trying to achieve?_`,
    ``,
    `### Success Criteria`,
    `- _How do we measure success?_`,
    ``,
    `## Scope`,
    ``,
    `### In Scope`,
    `- _What's included in this work?_`,
    ``,
    `### Out of Scope`,
    `- _What's explicitly not included?_`,
    ``,
    `## User Stories / Use Cases`,
    ``,
    `### Primary Use Case`,
    `_As a [user type], I want to [action] so that [benefit]._`,
    ``,
    `## Technical Approach`,
    ``,
    `### Architecture`,
    `_High-level architecture decisions_`,
    ``,
    `### Technologies`,
    `_Key technologies and frameworks_`,
    ``,
    `### Dependencies`,
    `_External dependencies and integrations_`,
    ``,
    `## UI/UX Considerations`,
    ``,
    `_User interface requirements and design considerations_`,
    ``,
    `## Edge Cases & Error Handling`,
    ``,
    `- _What edge cases need handling?_`,
    `- _How should errors be handled?_`,
    ``,
    `## Testing Strategy`,
    ``,
    `### Unit Tests`,
    `_What needs unit test coverage?_`,
    ``,
    `### Integration Tests`,
    `_What integration testing is required?_`,
    ``,
    `### E2E Tests`,
    `_What end-to-end flows need testing?_`,
    ``,
    `## Security & Privacy`,
    ``,
    `_Security considerations, data privacy, access control_`,
    ``,
    `## Performance Requirements`,
    ``,
    `_Performance targets, scalability considerations_`,
    ``,
    `## Open Questions`,
    ``,
    `- _What questions remain unanswered?_`,
    ``,
    `## References`,
    ``,
    `- Linear Issue: [${issueId}](https://linear.app/issue/${issueId})`,
    ``,
  ];

  return sections.join('\n');
}

/**
 * Spawn PRD agent for interactive PRD generation
 *
 * This would be called by a CLI command like `pan prd <issue-id>`
 */
export async function spawnPRDAgent(issueId: string, workspace: string, prompt?: string) {
  const agentPrompt = prompt || `
You are a PRD (Product Requirements Document) generation agent. Your job is to:

1. Interview the user about their requirements
2. Ask clarifying questions about:
   - Goals and success criteria
   - Scope (in/out of scope)
   - Technical approach and architecture
   - UI/UX requirements
   - Edge cases and error handling
   - Testing strategy
   - Security and performance requirements

3. Generate a comprehensive PRD document at .planning/PRD.md

4. Use the PRD template as a starting point and fill in all sections

5. Be thorough but concise - focus on critical information

6. Flag any open questions or ambiguities for later resolution

Start by reading the issue description, then ask targeted questions to fill in gaps.
`.trim();

  return spawnAgent({
    issueId,
    workspace,
    workType: 'prd-agent',
    prompt: agentPrompt,
  });
}
